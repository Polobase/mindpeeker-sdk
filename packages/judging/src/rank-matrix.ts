/**
 * Permutation tests for k × k judging matrices (SRI remote-viewing series):
 * a blind judge scores every transcript against every target, and the only
 * randomness the test relies on is which target went with which transcript.
 */

import { factorial } from './internal/numerics.js'
import type { Seed } from './internal/prng.js'
import { Xoshiro128 } from './internal/prng.js'
import {
  invalidInput,
  numberMatrix,
  oneOf,
  optionInteger,
  optionsObject,
  tooLarge,
} from './internal/validate.js'

/** Largest k solved exactly by branch-and-bound enumeration (non-integer scores). */
export const MAX_ENUMERATION_SIZE = 10

/** Largest `2^k × (k·range + 1)` table the integer subset DP allocates. */
export const MAX_SUBSET_DP_CELLS = 1 << 22

/** Options for {@link rankMatrixPermutationTest}. */
export interface RankMatrixOptions {
  /**
   * Which scores mean a better match: `'lower'` for ranks (1 = best, the SRI
   * convention), `'higher'` for ratings. Default `'lower'`.
   */
  readonly better?: 'lower' | 'higher'
  /**
   * `targets[i]` is the column of the true target for row i (a permutation of
   * `0…k−1`). Default: the diagonal, `targets[i] = i`.
   */
  readonly targets?: readonly number[]
  /**
   * `'exact'` enumerates all k! pairings (subset DP for integer scores up to
   * the cell limit, else branch-and-bound up to k = 10); `'monte-carlo'`
   * samples pairings; `'auto'` (default) is exact when feasible.
   */
  readonly method?: 'auto' | 'exact' | 'monte-carlo'
  /** Monte Carlo pairings drawn. Default 99 999. */
  readonly samples?: number
  /** Monte Carlo seed (part of the pre-registration). Default 0. */
  readonly seed?: Seed
}

/** Result of {@link rankMatrixPermutationTest}. */
export interface RankMatrixTest {
  /** Matrix size k. */
  readonly size: number
  readonly better: 'lower' | 'higher'
  /** Sum of the true pairs' scores. */
  readonly statistic: number
  /** Mean of the statistic over all pairings, $\sum_{ij} m_{ij}/k$. */
  readonly expected: number
  readonly method: 'exact' | 'monte-carlo'
  /**
   * Exact: pairings (including the true one) scoring at least as well as the
   * statistic. Monte Carlo: sampled pairings doing so.
   */
  readonly count: number
  /** Exact: k!. Monte Carlo: the number of samples. */
  readonly total: number
  /** Exact: `count / k!`. Monte Carlo: `(1 + count) / (1 + samples)`. */
  readonly pValue: number
  /** The seed used (Monte Carlo only). */
  readonly seed?: Seed
}

function tolerance(values: readonly (readonly number[])[]): number {
  let scale = 1
  for (const row of values) for (const v of row) scale += Math.abs(v)
  return 1e-9 * scale
}

/** Exact count of permutations with Σ v[i][π(i)] ≤ bound for integer v ≥ 0 via DP over subsets. */
function subsetDpCount(v: number[][], bound: number, maxValue: number): number {
  const k = v.length
  const range = k * maxValue + 1
  const masks = 1 << k
  const table = new Float64Array(masks * range)
  table[0] = 1
  for (let mask = 0; mask < masks; mask++) {
    let row = 0
    for (let m = mask; m !== 0; m &= m - 1) row++
    if (row === k) continue
    const base = mask * range
    const top = row * maxValue
    const values = v[row] as number[]
    for (let s = 0; s <= top; s++) {
      const c = table[base + s] as number
      if (c === 0) continue
      for (let j = 0; j < k; j++) {
        if ((mask >> j) & 1) continue
        const at = (mask | (1 << j)) * range + s + (values[j] as number)
        table[at] = (table[at] as number) + c
      }
    }
  }
  const fullBase = (masks - 1) * range
  let count = 0
  const last = Math.min(range - 1, Math.floor(bound))
  for (let s = 0; s <= last; s++) count += table[fullBase + s] as number
  return count
}

/** Exact count by depth-first enumeration with row-min/row-max pruning. */
function enumerateCount(v: number[][], bound: number): number {
  const k = v.length
  const suffixMin = new Float64Array(k + 1)
  const suffixMax = new Float64Array(k + 1)
  for (let i = k - 1; i >= 0; i--) {
    const row = v[i] as number[]
    suffixMin[i] = (suffixMin[i + 1] as number) + Math.min(...row)
    suffixMax[i] = (suffixMax[i + 1] as number) + Math.max(...row)
  }
  const visit = (row: number, used: number, partial: number): number => {
    if (partial + (suffixMin[row] as number) > bound) return 0
    if (partial + (suffixMax[row] as number) <= bound) return Number(factorial(k - row))
    let count = 0
    const values = v[row] as number[]
    for (let j = 0; j < k; j++) {
      if ((used >> j) & 1) continue
      count += visit(row + 1, used | (1 << j), partial + (values[j] as number))
    }
    return count
  }
  return visit(0, 0, 0)
}

/**
 * Exact (or seeded Monte Carlo) permutation test for a k × k judging matrix,
 * the "direct-count-of-permutations method" SRI used for its six-trial
 * remote-viewing series: entry $m_{ij}$ scores transcript i against target j,
 * the statistic is the sum over the true pairs, and under $H_0$ every pairing
 * $\pi$ of transcripts to targets is equally likely, so
 * $$p = \frac{\#\{\pi : \sum_i m_{i\pi(i)} \preceq S_{obs}\}}{k!},$$
 * with $\preceq$ meaning "at least as good" (≤ for ranks, ≥ for ratings).
 * The test needs no independence between the judge's rows or columns and no
 * normal approximation; it is valid for ranks, ratings or any score.
 *
 * Integer matrices use a DP over subsets of used targets
 * ($O(2^k k^2 \cdot \text{range})$, exact counts up to k = 14 for ranks);
 * other matrices enumerate with pruning up to k = 10. Beyond that, `'auto'`
 * samples uniform pairings with the seeded xoshiro128** PRNG and reports the
 * add-one estimate $(1 + c)/(1 + m)$, which is itself a valid p-value.
 * Floating ties are resolved with a relative tolerance of 1e-9.
 *
 * @throws {JudgingError} `invalid_input` for a non-square matrix, k < 2,
 *   non-finite entries, or `targets` that is not a permutation;
 *   `invalid_options` for an unknown `better`/`method`, bad `samples` or
 *   seed; `too_large` when `method: 'exact'` is infeasible.
 */
export function rankMatrixPermutationTest(
  matrix: readonly (readonly number[])[],
  options?: RankMatrixOptions,
): RankMatrixTest {
  const rows = numberMatrix('matrix', matrix, 2)
  const k = rows.length
  if ((rows[0] as number[]).length !== k) {
    invalidInput('matrix', `matrix must be square, got ${k} × ${(rows[0] as number[]).length}`)
  }
  if (k > 30) tooLarge('matrix', `matrix size is limited to 30, got ${k}`)
  const opts = optionsObject(options)
  const better = oneOf('better', opts.better ?? 'lower', ['lower', 'higher'] as const)
  const method = oneOf('method', opts.method ?? 'auto', ['auto', 'exact', 'monte-carlo'] as const)
  const targets = opts.targets === undefined ? rows.map((_, i) => i) : opts.targets
  if (!Array.isArray(targets) || targets.length !== k) {
    invalidInput('targets', `targets must list one column per row (${k})`)
  }
  const seenColumns = new Set<number>()
  targets.forEach((column, i) => {
    if (
      typeof column !== 'number' ||
      !Number.isInteger(column) ||
      column < 0 ||
      column >= k ||
      seenColumns.has(column)
    ) {
      invalidInput(`targets[${i}]`, 'targets must be a permutation of 0…k−1')
    }
    seenColumns.add(column)
  })

  let statistic = 0
  let grand = 0
  rows.forEach((row, i) => {
    statistic += row[targets[i] as number] as number
    for (const x of row) grand += x
  })
  // transform to "lower is better" with non-negative entries
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (const row of rows)
    for (const x of row) {
      lo = Math.min(lo, x)
      hi = Math.max(hi, x)
    }
  const v = rows.map((row) => row.map((x) => (better === 'lower' ? x - lo : hi - x)))
  const observed = better === 'lower' ? statistic - k * lo : k * hi - statistic
  const bound = observed + tolerance(v)
  const integer = v.every((row) => row.every((x) => Number.isInteger(x)))
  const maxValue = hi - lo
  const dpFeasible = integer && k <= 20 && 2 ** k * (k * maxValue + 1) <= MAX_SUBSET_DP_CELLS
  const exactFeasible = dpFeasible || k <= MAX_ENUMERATION_SIZE
  const useExact = method === 'exact' || (method === 'auto' && exactFeasible)
  const base = { size: k, better, statistic, expected: grand / k }

  if (useExact) {
    if (!exactFeasible) {
      tooLarge(
        'matrix',
        `exact enumeration of ${k}! pairings is not feasible; use method: 'monte-carlo'`,
      )
    }
    const count = dpFeasible
      ? subsetDpCount(v, Math.round(observed), maxValue)
      : enumerateCount(v, bound)
    const total = Number(factorial(k))
    return Object.freeze({ ...base, method: 'exact' as const, count, total, pValue: count / total })
  }

  const samples =
    opts.samples === undefined ? 99_999 : optionInteger('samples', opts.samples, 1, 1e8)
  const seed = opts.seed ?? 0
  const rng = new Xoshiro128(seed)
  const permutation = rows.map((_, i) => i)
  let count = 0
  for (let s = 0; s < samples; s++) {
    rng.shuffle(permutation)
    let sum = 0
    for (let i = 0; i < k; i++) sum += (v[i] as number[])[permutation[i] as number] as number
    if (sum <= bound) count++
  }
  return Object.freeze({
    ...base,
    method: 'monte-carlo' as const,
    count,
    total: samples,
    pValue: (1 + count) / (1 + samples),
    seed,
  })
}
