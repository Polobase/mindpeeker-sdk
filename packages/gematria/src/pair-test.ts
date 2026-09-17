/**
 * The pairing permutation test for equal-value claims — the Bible-code
 * critique (McKay, Bar-Natan, Bar-Hillel & Kalai) applied to ordinary
 * gematria. A list of "meaningful" pairs $(a_i, b_i)$ whose values agree is
 * evidence of nothing until it is compared with the same list re-paired at
 * random: shuffle the second column and count how often a random pairing
 * produces at least as many agreements.
 *
 * **Statistic.** $S(\pi) = \#\{i : |v(a_i) - v(b_{\pi(i)})| \le t\}$ with the
 * identity pairing observed. **Null.** $\pi$ uniform over all $n!$ permutations.
 * **p-value.** Exact, $P(S(\pi) \ge S_\text{obs})$, by dynamic programming over
 * subsets of the second column ($2^n \cdot (n+1)$ counts, exact up to
 * $n = 16$); or Monte Carlo with $B$ seeded Fisher–Yates permutations and the
 * add-one estimate $(1 + \#\{S(\pi_b) \ge S_\text{obs}\}) / (B + 1)$, which is a
 * valid p-value. The permutations come from a seeded xoshiro128** stream, so a
 * test is replayed exactly from its `seed` — pre-register it with the pairs.
 * Under the null $E[S] = \sum_{i,j} M_{ij} / n$ where $M_{ij}$ marks agreeing
 * cross-pairs.
 *
 * Sources: B. McKay, D. Bar-Natan, M. Bar-Hillel & G. Kalai, "Solving the Bible
 * Code Puzzle", *Statistical Science* 14 (1999); D. Witztum, E. Rips &
 * Y. Rosenberg, "Equidistant Letter Sequences in the Book of Genesis",
 * *Statistical Science* 9 (1994) (the permutation-rank design being tested);
 * B. V. North, D. Curtis & P. C. Sham, "A Note on the Calculation of Empirical
 * P Values from Monte Carlo Procedures", *AJHG* 71 (2002) (the add-one rule).
 */

import { GematriaError } from './errors.js'
import { uniformBelow, xoshiro128 } from './internal/prng.js'
import { scoreLexicon } from './lexicon-registry.js'
import { toleranceOf } from './match.js'
import { getCipher } from './registry.js'
import type { Cipher, CipherId, CipherRef, MatchOptions } from './types.js'

/** How {@link pairMatchTest} computes the null distribution. */
export type PairTestMethod = 'auto' | 'exact' | 'permutation'

/** Options for {@link pairMatchTest}. */
export interface PairMatchOptions extends MatchOptions {
  /**
   * `'exact'` enumerates all $n!$ pairings (requires $n \le 16$); `'permutation'`
   * samples `permutations` of them; `'auto'` (default) is exact for $n \le 12$.
   */
  readonly method?: PairTestMethod
  /** Monte Carlo permutations, an integer in $[1, 10^7]$. Default 9999. */
  readonly permutations?: number
  /** Seed of the permutation stream, a non-negative safe integer. Default 0. */
  readonly seed?: number
}

/** The result of {@link pairMatchTest}. */
export interface PairMatchTestResult {
  readonly cipher: CipherId
  /** The ±window applied. */
  readonly tolerance: number
  /** Number of pairs. */
  readonly n: number
  /** Pairs whose values agree within tolerance, as given. */
  readonly observed: number
  /** $E[S]$ under random re-pairing. */
  readonly expected: number
  /** $P(S \ge \text{observed})$ — exact, or the add-one Monte Carlo estimate. */
  readonly pValue: number
  readonly method: 'exact' | 'permutation'
  /** Pairings evaluated: $n!$ for `'exact'`, else the Monte Carlo `permutations`. */
  readonly pairings: number
  /** How many of those pairings reached at least `observed` agreements. */
  readonly atLeastObserved: number
}

const MAX_EXACT = 16
const AUTO_EXACT = 12
const MAX_PERMUTATIONS = 10_000_000

function wordValue(word: unknown, cipher: Cipher, where: string): number {
  if (typeof word !== 'string') {
    throw new GematriaError('invalid_input', `${where} must be a string`)
  }
  const scored = scoreLexicon([word], cipher)[0]
  if (!scored) {
    throw new GematriaError(
      'invalid_input',
      `${where} (${word}) has no scoring letter in the ${cipher.script} script of ${cipher.id}`,
      { cipher: cipher.id },
    )
  }
  return scored.value
}

function readOptions(opts: PairMatchOptions | undefined): {
  method: PairTestMethod
  permutations: number
  seed: number
} {
  const method = opts?.method ?? 'auto'
  if (method !== 'auto' && method !== 'exact' && method !== 'permutation') {
    throw new GematriaError(
      'invalid_input',
      `method must be auto, exact or permutation, got ${String(method)}`,
    )
  }
  const permutations = opts?.permutations ?? 9999
  if (
    typeof permutations !== 'number' ||
    !Number.isInteger(permutations) ||
    permutations < 1 ||
    permutations > MAX_PERMUTATIONS
  ) {
    throw new GematriaError(
      'invalid_input',
      `permutations must be an integer in [1, 1e7], got ${String(permutations)}`,
    )
  }
  const seed = opts?.seed ?? 0
  if (typeof seed !== 'number' || !Number.isSafeInteger(seed) || seed < 0) {
    throw new GematriaError(
      'invalid_input',
      `seed must be a non-negative safe integer, got ${String(seed)}`,
    )
  }
  return { method, permutations, seed }
}

/** Exact count of pairings with at least `observed` agreements (subset DP). */
function exactAtLeast(match: readonly Uint8Array[], observed: number): number {
  const n = match.length
  const size = 1 << n
  const width = n + 1
  const dp = new Float64Array(size * width)
  dp[0] = 1
  const popcount = new Uint8Array(size)
  for (let mask = 1; mask < size; mask++)
    popcount[mask] = (popcount[mask >> 1] as number) + (mask & 1)
  for (let mask = 0; mask < size; mask++) {
    const row = match[popcount[mask] as number]
    if (!row) continue // mask is full
    const base = mask * width
    for (let k = 0; k <= (popcount[mask] as number); k++) {
      const ways = dp[base + k] as number
      if (ways === 0) continue
      for (let j = 0; j < n; j++) {
        if (mask & (1 << j)) continue
        const target = (mask | (1 << j)) * width + k + (row[j] as number)
        dp[target] = (dp[target] as number) + ways
      }
    }
  }
  let atLeast = 0
  const full = (size - 1) * width
  for (let k = observed; k <= n; k++) atLeast += dp[full + k] as number
  return atLeast
}

/**
 * Test whether the agreements of a list of word pairs under `cipher` exceed what
 * random re-pairing of the same words produces (see the module doc). Every word
 * must be admissible under the cipher (its script, at least one scoring letter).
 *
 * @throws GematriaError `'invalid_input'` for fewer than two pairs, a malformed
 *   pair, a word with no scoring letter, invalid options, or `method: 'exact'`
 *   with more than 16 pairs
 * @throws GematriaError `'unknown_cipher'` if `cipher` is unknown
 */
export function pairMatchTest(
  pairs: readonly (readonly [string, string])[],
  cipher: CipherRef,
  opts?: PairMatchOptions,
): PairMatchTestResult {
  if (!Array.isArray(pairs) || pairs.length < 2) {
    throw new GematriaError(
      'invalid_input',
      'pairs must be an array of at least two [word, word] pairs',
    )
  }
  const c = getCipher(cipher)
  const tolerance = toleranceOf(opts)
  const { method, permutations, seed } = readOptions(opts)
  const n = pairs.length
  const left: number[] = []
  const right: number[] = []
  for (let i = 0; i < n; i++) {
    const pair: unknown = pairs[i]
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new GematriaError('invalid_input', `pair ${i} must be a [word, word] array`)
    }
    left.push(wordValue(pair[0], c, `pair ${i} word 0`))
    right.push(wordValue(pair[1], c, `pair ${i} word 1`))
  }
  const match = left.map((a) =>
    Uint8Array.from(right, (b) => (Math.abs(a - b) <= tolerance ? 1 : 0)),
  )
  let observed = 0
  let crossTotal = 0
  for (let i = 0; i < n; i++) {
    observed += match[i]?.[i] as number
    for (const hit of match[i] as Uint8Array) crossTotal += hit
  }
  const expected = crossTotal / n

  const useExact = method === 'exact' || (method === 'auto' && n <= AUTO_EXACT)
  if (useExact) {
    if (n > MAX_EXACT) {
      throw new GematriaError(
        'invalid_input',
        `exact enumeration supports at most ${MAX_EXACT} pairs, got ${n}`,
      )
    }
    let factorial = 1
    for (let k = 2; k <= n; k++) factorial *= k
    const atLeast = exactAtLeast(match, observed)
    return Object.freeze({
      cipher: c.id,
      tolerance,
      n,
      observed,
      expected,
      pValue: atLeast / factorial,
      method: 'exact',
      pairings: factorial,
      atLeastObserved: atLeast,
    })
  }

  const next = xoshiro128(seed)
  const perm = Array.from({ length: n }, (_, i) => i)
  let atLeast = 0
  for (let b = 0; b < permutations; b++) {
    for (let i = n - 1; i > 0; i--) {
      const j = uniformBelow(next, i + 1)
      const tmp = perm[i] as number
      perm[i] = perm[j] as number
      perm[j] = tmp
    }
    let s = 0
    for (let i = 0; i < n; i++) s += (match[i] as Uint8Array)[perm[i] as number] as number
    if (s >= observed) atLeast++
  }
  return Object.freeze({
    cipher: c.id,
    tolerance,
    n,
    observed,
    expected,
    pValue: (1 + atLeast) / (1 + permutations),
    method: 'permutation',
    pairings: permutations,
    atLeastObserved: atLeast,
  })
}
