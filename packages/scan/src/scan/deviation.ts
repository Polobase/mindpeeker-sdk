import { binomialCdf, binomialSf } from '@mindpeeker/negentropy/numerics'
import { type BitReader, bitReader } from '@mindpeeker/oracle'
import { type BetaPrior, binomialLogBayesFactor } from '@mindpeeker/psi'
import { openReader } from '../internal/reader.js'
import { toScanError } from '../internal/rethrow.js'
import {
  abortSignal,
  alphaLevel,
  betaPrior,
  byteSource,
  integerIn,
  optionsObject,
  scannableCatalog,
} from '../internal/validate.js'
import type {
  AdjustedDeviationResult,
  ByteSource,
  Catalog,
  DeviationOptions,
  DeviationReport,
  DeviationResult,
  ScanResult,
} from '../types.js'
import { adjustFamily } from './multiplicity.js'

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
 * For each of `rounds` rounds and each of `itemCount` items **in order**, take
 * one bit from `bits` (MSB-first, eight coins per byte — oracle's `bitReader`,
 * so no bit is wasted and none is reused). An item "scores" on a `1`. Coin
 * $c = rM + j$ (round $r$, item $j$) is bit $c$ of the stream, so a source
 * biased on exactly those bit positions biases exactly item $j$.
 *
 * Adds into `counts` (default a fresh zero array) and returns it. Under a fair
 * source each $k_j \sim \mathrm{Binomial}(N, \tfrac12)$, independent across
 * items.
 */
export async function accumulateDeviation(
  bits: BitReader,
  itemCount: number,
  rounds: number,
  counts: number[] = new Array<number>(itemCount).fill(0),
): Promise<number[]> {
  for (let r = 0; r < rounds; r++) {
    for (let j = 0; j < itemCount; j++) {
      if ((await bits.nextBit()) === 1) counts[j] = (counts[j] as number) + 1
    }
  }
  return counts
}

/**
 * Exact two-sided p-value of $k$ successes in $N$ fair coins:
 * $$p = P\big(|K - N/2| \ge |k - N/2|\big)
 *     = P(K \le m) + P(K \ge N - m), \qquad m = \min(k, N - k),$$
 * $K \sim \mathrm{Binomial}(N, \tfrac12)$, via negentropy's exact incomplete-beta
 * binomial tails (`binomialCdf`, and `binomialSf` = $P(K > x)$). The two tails
 * overlap only when $k = N/2$, where the sum exceeds 1 and is clamped to 1 —
 * the correct value. For the symmetric null this equals scipy's
 * `binomtest(k, N, 0.5).pvalue`.
 */
export function binomialTwoSidedP(k: number, n: number): number {
  const m = Math.min(k, n - k)
  return Math.min(1, binomialCdf(m, n, P0) + binomialSf(n - m - 1, n, P0))
}

/**
 * Turn a success count into the per-item deviation statistics.
 *
 * $$z = \frac{k - N/2}{\sqrt{N/4}}, \qquad
 *   p = P\big(|K - \tfrac N2| \ge |k - \tfrac N2|\big), \qquad
 *   BF_{10} = \frac{B(k+a,\,N-k+b)}{B(a,b)}\,2^{N}.$$
 *
 * $z$ is descriptive (asymptotically normal); $p$ is the **exact** two-sided
 * binomial p ({@link binomialTwoSidedP}) — the plain normal tail it replaces
 * rejected a fair coin with probability 0.077 at nominal 0.05 for $N = 16$;
 * $\ln BF_{10}$ is psi's overflow-free `binomialLogBayesFactor` with the null
 * $p_0 = \tfrac12$, so every number here tests the same hypothesis.
 *
 * `k` and `rounds` must be integers with $0 \le k \le N$, $N \ge 1$, and
 * `prior` a valid Beta prior (the public entry points validate these).
 */
export function deviationStat(k: number, rounds: number, prior: BetaPrior = {}): DeviationResult {
  const z = (k - rounds * P0) / Math.sqrt(rounds * P0 * (1 - P0))
  const lnBayesFactor = binomialLogBayesFactor(k, rounds, prior)
  return Object.freeze({
    successes: k,
    rounds,
    z,
    p: binomialTwoSidedP(k, rounds),
    lnBayesFactor,
    bayesFactor: Math.exp(lnBayesFactor),
  })
}

/**
 * FNV-1a 32-bit hash of a string, used purely as an order-independent tie-break
 * key (see {@link byBayesFactor}). Deterministic and well-mixed, so it induces
 * no systematic ordering over item ids — unlike catalog position, which
 * correlates with nothing about the data.
 */
export function tieBreakKey(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 0x01000193)
  }
  return h >>> 0
}

/**
 * Rank comparator: $\ln BF_{10}$ **descending**, ties broken by a stable hash
 * of the item id (then the id itself) — never by catalog position.
 *
 * The comparison is on the log Bayes factor and never subtracts: $BF_{10}$
 * itself overflows to `Infinity` for a stuck source at $N \gtrsim 1030$, and
 * `Infinity − Infinity` is `NaN`, which a sort silently treats as a tie —
 * catalog order again. The closed-form factor is symmetric in
 * $k \leftrightarrow N-k$, so items with equal $|k - N/2|$ tie exactly; under a
 * fair source that happens often at the very top, and the id hash makes the
 * surfaced winner a function of item identity: deterministic for the same
 * bytes and catalog, invariant under permuting the catalog. Ids are unique
 * within a catalog, so the order is total. A genuinely biased item is the
 * strict maximum and is never affected.
 */
export function byBayesFactor(
  a: { readonly id: string; readonly deviation?: { readonly lnBayesFactor: number } },
  b: { readonly id: string; readonly deviation?: { readonly lnBayesFactor: number } },
): number {
  const x = a.deviation?.lnBayesFactor ?? Number.NEGATIVE_INFINITY
  const y = b.deviation?.lnBayesFactor ?? Number.NEGATIVE_INFINITY
  if (x !== y) return y > x ? 1 : -1
  const ha = tieBreakKey(a.id)
  const hb = tieBreakKey(b.id)
  if (ha !== hb) return ha < hb ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Score `counts` for a catalog's items into frozen, ranked deviation rows. */
export function rankedDeviationRows(
  catalog: Catalog,
  counts: readonly number[],
  rounds: number,
  prior: BetaPrior | undefined,
  alpha: number,
): {
  readonly results: readonly (ScanResult & { readonly deviation: AdjustedDeviationResult })[]
  readonly multiplicity: DeviationReport['multiplicity']
} {
  const stats = catalog.items.map((_, i) => deviationStat(counts[i] as number, rounds, prior))
  const { adjusted, summary } = adjustFamily(stats, alpha)
  const rows = catalog.items.map((item, i) => ({
    id: item.id ?? item.name,
    name: item.name,
    ...(item.category !== undefined && { category: item.category }),
    trials: rounds,
    deviation: adjusted[i] as AdjustedDeviationResult,
  }))
  rows.sort(byBayesFactor)
  const results = rows.map((r, i) => Object.freeze({ ...r, rank: i + 1 }))
  return { results: Object.freeze(results), multiplicity: summary }
}

/**
 * The honest chance-deviation scan — the primitive AetherOne lacks.
 *
 * Each catalog item is treated as an independent Bernoulli process with the
 * **known, exact** chance rate $p_0 = \tfrac12$: one fair coin per item per
 * round, eight coins per source byte. Over $N$ = `rounds` rounds it counts
 * successes $k_i$ and reports, per item, $\{z, p, \ln BF_{10}, BF_{10}\}$
 * against that null (see {@link deviationStat}) plus Bonferroni, Holm, and
 * Benjamini–Hochberg adjusted p-values over the $M$ items, and a
 * report-level {@link MultiplicitySummary} with the omnibus $\sum z^2$ test.
 * Results are ranked by $\ln BF_{10}$ descending, ties broken by an id hash
 * (see {@link byBayesFactor}).
 *
 * **Interpretation — read this before quoting a number.** Under a fair source
 * every item is null: $z \approx 0$, the exact $p$-values satisfy
 * $P(p \le \alpha) \le \alpha$ at every level, and $BF_{10}$ is typically
 * *below* 1 — median ≈ 0.095 at the default $N = 256$, i.e. evidence **for**
 * chance — while $E[BF_{10}] = 1$ exactly. A
 * source biased toward one item raises *that* item's $BF_{10}$ and $|z|$.
 * That is all this measures: **deviation from chance**. A high score is a
 * chance-deviation *flag*, **not** evidence of mind–matter interaction; RF
 * pickup, a warm oscillator, or a biased ADC produce "significant" deviations
 * too. With $M$ items, $M\alpha$ unadjusted hits are expected by luck alone
 * (`multiplicity.expectedFalsePositives`) — read `pHolm`/`qBH`, not `p`, and
 * register the hypothesis before looking.
 *
 * The source stream is opened once and closed when the scan ends, fails, or
 * is aborted. Deterministic: identical bytes give identical statistics.
 *
 * @throws {ScanError} `invalid_catalog`; `invalid_options` (rounds, prior,
 *   alpha, signal, source shape); `insufficient_entropy`; `source_error`;
 *   `aborted`.
 */
export async function scanDeviation(
  catalog: Catalog,
  source: ByteSource,
  opts: DeviationOptions = {},
): Promise<DeviationReport> {
  const o = optionsObject(opts, 'scanDeviation options')
  const cat = scannableCatalog(catalog)
  const src = byteSource(source)
  const rounds = integerIn(o.rounds ?? 256, 'rounds', 1)
  const prior = betaPrior(o.prior)
  const alpha = alphaLevel(o.alpha ?? 0.05)
  const reader = openReader(src, abortSignal(o.signal))
  try {
    const bits = bitReader(reader)
    const counts = await accumulateDeviation(bits, cat.items.length, rounds)
    const { results, multiplicity } = rankedDeviationRows(cat, counts, rounds, prior, alpha)
    return Object.freeze({
      catalog: cat.id,
      results,
      p0: P0,
      multiplicity,
      source: src.name,
      accounting: Object.freeze({ bytesConsumed: reader.bytesConsumed, bitsUsed: bits.bitsUsed }),
    })
  } catch (error) {
    throw toScanError(error, src.name, 'deviation scan')
  } finally {
    await reader.close()
  }
}
