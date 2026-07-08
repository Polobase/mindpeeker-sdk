import { normSf } from '@mindpeeker/negentropy/numerics'
import { type ByteReader, byteReader, uniformInt } from '@mindpeeker/oracle'
import { type BetaPrior, binomialBayesFactor } from '@mindpeeker/psi'
import type {
  ByteSource,
  Catalog,
  DeviationOptions,
  DeviationReport,
  DeviationResult,
  ScanResult,
} from '../types.js'

/**
 * The known chance rate $p_0$ of the honest null model: a fair per-item coin.
 *
 * Under a fair byte source each item scores in a round with probability
 * exactly $\tfrac12$, so $p_0 = \tfrac12$ is **exact** — not an empirical
 * estimate. This is the statistical baseline AetherOne never had.
 */
export const P0 = 0.5

/**
 * Accumulate per-item success counts under the fair-coin null.
 *
 * For each of `rounds` rounds and each of `itemCount` items **in order**, draw
 * one fair bit with `uniformInt(reader, 2)` (a single byte, its low bit; no
 * modulo bias — the draw is exactly uniform on $\{0,1\}$). An item "scores" on
 * a `1`. The item at index $j$ therefore consumes the bytes at global
 * positions $\{rM + j\}$ — so a source biased to make those bytes odd biases
 * exactly item $j$, which is how the biased-item test injects a signal.
 *
 * Returns the success count $k_j \in [0, N]$ per item. Under a fair source
 * each $k_j \sim \mathrm{Binomial}(N, \tfrac12)$, independent across items.
 */
export async function accumulateDeviation(
  reader: ByteReader,
  itemCount: number,
  rounds: number,
): Promise<number[]> {
  const counts = new Array<number>(itemCount).fill(0)
  for (let r = 0; r < rounds; r++) {
    for (let j = 0; j < itemCount; j++) {
      if ((await uniformInt(reader, 2)) === 1) counts[j] = (counts[j] as number) + 1
    }
  }
  return counts
}

/**
 * Turn a success count into the per-item deviation statistics.
 *
 * $$z = \frac{k - N p_0}{\sqrt{N p_0 (1 - p_0)}}
 *     = \frac{k - N/2}{\sqrt{N/4}}, \qquad
 *   p = 2\,\Phi(-|z|), \qquad
 *   BF_{10} = \frac{B(k+a,\,N-k+b)}{B(a,b)}\,2^{N}.$$
 *
 * $z$ is standard normal under $H_0: p_0 = \tfrac12$; $p$ is its two-sided
 * normal tail (via negentropy's scipy-validated `normSf`); $BF_{10}$ is
 * `binomialBayesFactor`, whose null is exactly this $p_0 = \tfrac12$, so the
 * Bayes factor and the $z$ agree on the same hypothesis.
 */
export function deviationStat(k: number, rounds: number, prior: BetaPrior = {}): DeviationResult {
  const z = (k - rounds * P0) / Math.sqrt(rounds * P0 * (1 - P0))
  const p = Math.min(1, 2 * normSf(Math.abs(z)))
  const bayesFactor = binomialBayesFactor(k, rounds, prior)
  return { successes: k, rounds, z, p, bayesFactor }
}

/**
 * FNV-1a 32-bit hash of a string, used purely as an order-independent tie-break
 * key (see {@link byBayesFactor}). Deterministic and well-mixed, so it induces
 * no systematic ordering over human-readable item names — unlike catalog
 * position, which correlates with nothing about the data.
 */
export function tieBreakKey(name: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < name.length; i++) {
    h = Math.imul(h ^ name.charCodeAt(i), 0x01000193)
  }
  return h >>> 0
}

/**
 * Rank comparator: Bayes factor **descending**, ties broken by a stable hash of
 * the item name — never by catalog position.
 *
 * The closed-form $BF_{10}$ is symmetric in $k \leftrightarrow N-k$ and monotone
 * in $|k - N/2|$, so every pair of items with equal $|k - N/2|$ has a
 * *bit-identical* Bayes factor. Under a fair source such ties are common
 * (roughly one run in ten has one at the very top), and a plain stable sort
 * would then keep the lowest-indexed catalog item at rank 1 — so a fair source
 * would systematically surface early-catalog items as the "top hit". Breaking
 * ties by {@link tieBreakKey} makes the surfaced winner a function of item
 * identity, not insertion order: the ranking stays fully deterministic (same
 * bytes and same catalog give the same order) yet is invariant under permuting
 * the catalog. A genuinely biased item is the strict maximum, so a real
 * detection is never affected. Note that $|z|$ cannot serve as the tie-break —
 * a $BF_{10}$ tie is exactly a $|z|$ tie — hence the name hash.
 */
export function byBayesFactor(
  a: { readonly name: string; readonly deviation?: { readonly bayesFactor: number } },
  b: { readonly name: string; readonly deviation?: { readonly bayesFactor: number } },
): number {
  const d = (b.deviation?.bayesFactor ?? 0) - (a.deviation?.bayesFactor ?? 0)
  if (d !== 0) return d
  const h = tieBreakKey(a.name) - tieBreakKey(b.name)
  if (h !== 0) return h
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

/**
 * The honest chance-deviation scan — the primitive AetherOne lacks.
 *
 * Each catalog item is treated as an independent Bernoulli process with the
 * **known, exact** chance rate $p_0 = \tfrac12$ (a fair per-item coin, one bit
 * per round via unbiased `uniformInt`). Over $N$ = `rounds` rounds it counts
 * successes $k_i$ and reports, per item, $\{z, p, BF_{10}\}$ against that null
 * (see {@link deviationStat}). Results are ranked by Bayes factor descending,
 * with equal-evidence ties broken by a stable name hash rather than catalog
 * order (see {@link byBayesFactor}).
 *
 * **Interpretation — read this before quoting a number.** Under a fair source
 * every item is null: $BF_{10} \approx 1$, $z \approx 0$, and the $p$-values
 * are $\sim \mathrm{Uniform}(0,1)$. A source biased toward one item raises
 * *that* item's $BF_{10}$ and $|z|$. That is all this measures: **deviation
 * from chance**. A high score is a chance-deviation *flag*, **not** evidence
 * of mind–matter interaction; RF pickup, a warm oscillator, or a biased ADC
 * produce "significant" deviations too. And because $M$ items are each tested,
 * some will look significant by luck alone — with $M$ items expect on the
 * order of $M/20$ to cross $p < 0.05$ under the null, so apply a
 * multiple-comparisons correction (Bonferroni $\alpha/M$, or the Bayes
 * factors, which are calibrated to *support* the null) before claiming
 * anything. Register the hypothesis before looking.
 *
 * Deterministic: identical bytes give identical statistics.
 */
export async function scanDeviation(
  catalog: Catalog,
  source: ByteSource,
  opts: DeviationOptions = {},
): Promise<DeviationReport> {
  const rounds = opts.rounds ?? 256
  const reader = byteReader(source, opts.signal ? { signal: opts.signal } : {})
  const start = reader.bytesConsumed
  const counts = await accumulateDeviation(reader, catalog.items.length, rounds)
  const scored: (ScanResult & { deviation: DeviationResult })[] = catalog.items.map((item, i) => {
    const deviation = deviationStat(counts[i] as number, rounds, opts.prior)
    return {
      name: item.name,
      ...(item.category !== undefined && { category: item.category }),
      trials: rounds,
      deviation,
      rank: 0,
    }
  })
  scored.sort(byBayesFactor)
  const results = scored.map((r, i) => Object.freeze({ ...r, rank: i + 1 }))
  const bytesConsumed = reader.bytesConsumed - start
  return Object.freeze({
    catalog: catalog.id,
    results: Object.freeze(results),
    p0: P0,
    source: source.name,
    accounting: Object.freeze({ bytesConsumed, bitsUsed: bytesConsumed * 8 }),
  })
}
