/**
 * Commonness 2.0 — the whole-lexicon null model for "these two words share a
 * value". A single `commonness` fraction says how crowded one value is; the
 * statistics here say how cheap equal values are across the entire lexicon,
 * before any particular word is looked up.
 *
 * Let the lexicon's $n$ admissible words (see `LexiconWord`) take values with
 * probabilities $p_v$ — word counts $c_v / n$, or weight masses when token
 * `weights` are given (a Zipf-aware "how often is this value *used*"). For two
 * independent draws the **collision probability** within tolerance $t$ is
 * $$q = \sum_v p_v \sum_{|u - v| \le t} p_u \qquad (q = \textstyle\sum_v p_v^2 \text{ for } t = 0),$$
 * its **collision entropy** is the Rényi-2 entropy $H_2 = -\log_2 q$ (bits),
 * $n$ i.i.d. draws have $\binom{n}{2} q$ **expected equal pairs**, and the
 * **birthday bound** $k_{50} \approx \sqrt{2 \ln 2 / q}$ is how many draws make
 * a coincidence more likely than not. Any unevenness of the value distribution
 * raises $q$ above the uniform $1/\text{distinct}$: equal values get cheaper.
 *
 * All sums over word counts are exact integers until the final division; the
 * birthday bound is the standard leading-order approximation
 * $P(\text{no collision among } k) \approx e^{-\binom{k}{2} q}$ (Diaconis &
 * Mosteller), not an exact product.
 *
 * Sources: P. Diaconis & F. Mosteller, "Methods for Studying Coincidences",
 * *JASA* 84 (1989); A. Rényi, "On Measures of Entropy and Information" (1961);
 * the birthday problem for non-uniform distributions (the collision lemma: any
 * unevenness increases the chance of a match).
 */

import { GematriaError } from './errors.js'
import { checkLexicon, type ScoredWord, scoreLexicon } from './lexicon-registry.js'
import { toleranceOf } from './match.js'
import { getCipher } from './registry.js'
import type { CipherId, CipherRef, Lexicon, MatchOptions } from './types.js'

/** Options for {@link collisionProfile} and {@link expectedMatches}. */
export interface CollisionOptions extends MatchOptions {
  /**
   * Token weights per word (e.g. corpus frequencies): a word's probability mass
   * is its weight instead of 1. Words missing from the map weigh 0; every weight
   * must be a finite non-negative number, and the admissible words must weigh
   * more than 0 in total. Counts, pairs and `n` stay word counts.
   */
  readonly weights?: ReadonlyMap<string, number>
}

/** One value of a {@link CollisionProfile.histogram}. */
export interface ValueBin {
  readonly value: number
  /** Admissible words with this value. */
  readonly count: number
  /** Probability mass $p_v$ (count share, or weight share with `weights`). */
  readonly probability: number
}

/** The collision statistics of a lexicon under one cipher. */
export interface CollisionProfile {
  readonly cipher: CipherId
  /** The ±window applied (0 unless colel/tolerance was requested). */
  readonly tolerance: number
  /** Admissible words $n$. */
  readonly n: number
  /** Distinct values among them. */
  readonly distinct: number
  /** The value histogram, ascending by value (frozen). */
  readonly histogram: readonly ValueBin[]
  /** $q = \sum_v p_v \sum_{|u-v| \le t} p_u$ — two random draws coincide. */
  readonly collisionProbability: number
  /** Rényi-2 collision entropy $-\log_2 q$ in bits. */
  readonly collisionEntropyBits: number
  /** $\binom{n}{2} q$ — equal pairs expected among $n$ i.i.d. draws. */
  readonly expectedEqualPairs: number
  /**
   * Unordered pairs of distinct lexicon entries actually within tolerance (exact
   * count). Without weights $\binom{n}{2} q - \text{observed} = n(1 - q)/2$: the
   * i.i.d. expectation also counts draws that repeat the same entry.
   */
  readonly observedEqualPairs: number
  /** Draws needed for a ≥ 50% chance of a coincidence, $\sqrt{2 \ln 2 / q}$. */
  readonly birthdayBound50: number
}

interface Bins {
  readonly values: readonly number[]
  readonly counts: readonly number[]
  readonly masses: readonly number[]
  readonly totalMass: number
}

function checkWeights(weights: unknown): ReadonlyMap<string, number> | undefined {
  if (weights === undefined) return undefined
  if (!(weights instanceof Map)) {
    throw new GematriaError('invalid_input', 'weights must be a Map from word to weight')
  }
  for (const [word, w] of weights) {
    if (typeof w !== 'number' || !Number.isFinite(w) || w < 0) {
      throw new GematriaError(
        'invalid_input',
        `weight of ${String(word)} must be a finite non-negative number, got ${String(w)}`,
      )
    }
  }
  return weights as ReadonlyMap<string, number>
}

function binsOf(
  scored: readonly ScoredWord[],
  weights: ReadonlyMap<string, number> | undefined,
): Bins {
  const byValue = new Map<number, { count: number; mass: number }>()
  let totalMass = 0
  for (const { word, value } of scored) {
    const mass = weights ? (weights.get(word) ?? 0) : 1
    const bin = byValue.get(value)
    if (bin) {
      bin.count++
      bin.mass += mass
    } else byValue.set(value, { count: 1, mass })
    totalMass += mass
  }
  const values = [...byValue.keys()].sort((a, b) => a - b)
  return {
    values,
    counts: values.map((v) => (byValue.get(v) as { count: number }).count),
    masses: values.map((v) => (byValue.get(v) as { mass: number }).mass),
    totalMass,
  }
}

/** For every bin, the sum of `series` over bins within ±tolerance of its value. */
function windowSums(
  values: readonly number[],
  series: readonly number[],
  tolerance: number,
): number[] {
  const out: number[] = []
  let lo = 0
  let hi = 0
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i] as number
    while (hi < values.length && (values[hi] as number) <= v + tolerance)
      sum += series[hi++] as number
    while ((values[lo] as number) < v - tolerance) sum -= series[lo++] as number
    out.push(sum)
  }
  return out
}

function prepare(
  lexicon: Lexicon,
  cipher: CipherRef,
  opts: CollisionOptions | undefined,
): { id: CipherId; tolerance: number; scored: readonly ScoredWord[]; bins: Bins } {
  checkLexicon(lexicon)
  const c = getCipher(cipher)
  const tolerance = toleranceOf(opts)
  const weights = checkWeights(opts?.weights)
  const scored = scoreLexicon(lexicon, c)
  if (scored.length === 0) {
    throw new GematriaError('no_match', `the lexicon has no admissible words under ${c.id}`, {
      cipher: c.id,
    })
  }
  const bins = binsOf(scored, weights)
  if (!(bins.totalMass > 0)) {
    throw new GematriaError(
      'invalid_input',
      'weights give the admissible words zero total weight',
      {
        cipher: c.id,
      },
    )
  }
  return { id: c.id, tolerance, scored, bins }
}

/**
 * The approximate number of independent draws from a value distribution with
 * collision probability `collisionProbability` needed for a coincidence with
 * probability at least `probability`: $k \approx \sqrt{2 \ln(1/(1-P)) / q}$
 * (from $P(\text{no collision}) \approx e^{-k^2 q / 2}$). For 365 equally likely
 * birthdays and $P = 0.5$ this is 22.49 (the exact answer is 23).
 *
 * @throws GematriaError `'invalid_input'` unless $0 < q \le 1$ and $0 < P < 1$
 */
export function birthdayBound(collisionProbability: number, probability = 0.5): number {
  const q = collisionProbability
  if (typeof q !== 'number' || !(q > 0 && q <= 1)) {
    throw new GematriaError(
      'invalid_input',
      `collisionProbability must be in (0, 1], got ${String(q)}`,
    )
  }
  if (typeof probability !== 'number' || !(probability > 0 && probability < 1)) {
    throw new GematriaError(
      'invalid_input',
      `probability must be in (0, 1), got ${String(probability)}`,
    )
  }
  return Math.sqrt((2 * -Math.log1p(-probability)) / q)
}

/**
 * The collision statistics of `lexicon` under `cipher` (see the module doc):
 * the value histogram, the collision probability $q$ and entropy, the expected
 * and observed equal pairs, and the 50% birthday bound — with an optional ±
 * `tolerance`/`colel` window and token `weights`.
 *
 * @throws GematriaError `'invalid_input'` for an invalid lexicon, options or weights
 * @throws GematriaError `'unknown_cipher'` if `cipher` is unknown
 * @throws GematriaError `'no_match'` if no lexicon word is admissible under `cipher`
 */
export function collisionProfile(
  lexicon: Lexicon,
  cipher: CipherRef,
  opts?: CollisionOptions,
): CollisionProfile {
  const { id, tolerance, scored, bins } = prepare(lexicon, cipher, opts)
  const n = scored.length
  const massWindow = windowSums(bins.values, bins.masses, tolerance)
  const countWindow = windowSums(bins.values, bins.counts, tolerance)
  let massCross = 0
  let pairTwice = 0
  for (let i = 0; i < bins.values.length; i++) {
    massCross += (bins.masses[i] as number) * (massWindow[i] as number)
    const c = bins.counts[i] as number
    pairTwice += c * ((countWindow[i] as number) - 1)
  }
  const q = massCross / (bins.totalMass * bins.totalMass)
  return Object.freeze({
    cipher: id,
    tolerance,
    n,
    distinct: bins.values.length,
    histogram: Object.freeze(
      bins.values.map((value, i) =>
        Object.freeze({
          value,
          count: bins.counts[i] as number,
          probability: (bins.masses[i] as number) / bins.totalMass,
        }),
      ),
    ),
    collisionProbability: q,
    collisionEntropyBits: -Math.log2(q),
    expectedEqualPairs: ((n * (n - 1)) / 2) * q,
    observedEqualPairs: pairTwice / 2,
    birthdayBound50: birthdayBound(q),
  })
}

/**
 * The expected size of `matches(word, lexicon, cipher, opts).matches` for a
 * query word drawn from the lexicon itself — uniformly, or in proportion to
 * `weights`. It counts the query word, so a lexicon of distinct values gives
 * exactly 1; without weights it equals $n\,q$. Compare a particular word's
 * `matches.length` against it: a word with no more matches than this baseline
 * has an unremarkable coincidence.
 *
 * @throws GematriaError `'invalid_input'` for an invalid lexicon, options or weights
 * @throws GematriaError `'unknown_cipher'` if `cipher` is unknown
 * @throws GematriaError `'no_match'` if no lexicon word is admissible under `cipher`
 */
export function expectedMatches(
  lexicon: Lexicon,
  cipher: CipherRef,
  opts?: CollisionOptions,
): number {
  const { tolerance, bins } = prepare(lexicon, cipher, opts)
  const countWindow = windowSums(bins.values, bins.counts, tolerance)
  let sum = 0
  for (let i = 0; i < bins.values.length; i++) {
    sum += (bins.masses[i] as number) * (countWindow[i] as number)
  }
  return sum / bins.totalMass
}
