/**
 * Exact P(max category count ≥ k) for n multinomial draws — two algorithms.
 *
 * 1. `dp`: condition on the categories one at a time. With m draws left for
 *    categories i…B, category i receives J ~ Binomial(m, q_i),
 *    q_i = p_i / (p_i + … + p_B), so
 *      g_i(m) = Σ_{j<k} P(J = j) g_{i+1}(m − j)                (no k-fold match)
 *      r_i(m) = P(J ≥ k) + Σ_{j<k} P(J = j) r_{i+1}(m − j)     (a k-fold match)
 *    with g_B(m) = [m < k], r_B(m) = [m ≥ k]. Every term is non-negative, so
 *    both tails keep full relative precision. Cost ≈ B·n·k.
 * 2. `levin`: Levin's (1981) representation. For any s > 0 with
 *    Y_i ~ Poisson(s·p_i) independent,
 *      P(no k-fold match) = n! e^s / s^n · Π_i P(Y_i < k) · P(W = n),
 *    W = Σ Z_i, Z_i ~ (Y_i | Y_i < k). Equal probabilities form one group
 *    whose convolution power is built by repeated squaring (arrays truncated
 *    at n), so c = 10⁶ equal categories cost O(n² log c). s = n. Rounding in
 *    the Z distribution is raised to the c-th power, so the relative error of
 *    P(no match) grows like c·10⁻¹⁶ (measured: 1e-11 at c = 10⁵, 1.2e-10 at
 *    c = 10⁶) and `match = 1 − noMatch` carries that as absolute error.
 */
import { CoincidenceError } from '../errors.js'
import type { KWayResult } from '../types.js'
import {
  lnFactorial,
  NeumaierSum,
  oneMinusExp,
  poissonLogPmf,
  poissonSplit,
  stirlingCorrection,
} from './numerics.js'

/**
 * Work limit for one exact k-fold evaluation, in rough nanoseconds of
 * arithmetic (≈ 2 s): the cheaper algorithm must fit under it.
 */
export const KWAY_WORK_LIMIT = 2e9
/** Below this (≈ 0.2 s) the DP runs even when Levin is cheaper: its `match` keeps full precision. */
const DP_PREFERRED = 2e8
/** Measured cost of one DP step per unit of (k + 4), relative to one multiply-add. */
const DP_STEP_COST = 10

/** A group of `multiplicity` categories that share probability `p`. */
interface Group {
  readonly p: number
  readonly multiplicity: number
}

function dpWork(n: number, categories: number, k: number): number {
  // Beyond 10⁶ categories use the upper bound B·(n+1)·(k+4) instead of the loop.
  if (categories > 1e6) return categories * (n + 1) * (k + 4) * DP_STEP_COST
  // layer i (1-based) needs m in [max(0, n − (i−1)(k−1)), min(n, (B−i+1)(k−1))]
  let work = 0
  for (let i = 1; i <= categories; i++) {
    const lo = Math.max(0, n - (i - 1) * (k - 1))
    const hi = Math.min(n, (categories - i + 1) * (k - 1))
    if (hi >= lo) work += (hi - lo + 1) * (k + 4)
  }
  return work * DP_STEP_COST
}

function convolutionCost(a: number, b: number, cap: number): number {
  return Math.min(a, cap) * Math.min(b, cap)
}

function levinWork(n: number, groups: readonly Group[], k: number): number {
  const cap = n + 1
  let work = 0
  let result = 1
  for (const { multiplicity } of groups) {
    let base = Math.min(k, cap)
    let e = multiplicity
    let power = 0 // length of this group's accumulated power (0 = none yet)
    while (e > 0) {
      if (e % 2 === 1) {
        work += power === 0 ? 0 : convolutionCost(power, base, cap)
        power = power === 0 ? base : Math.min(power + base - 1, cap)
      }
      e = Math.floor(e / 2)
      if (e > 0) {
        work += convolutionCost(base, base, cap)
        base = Math.min(2 * base - 1, cap)
      }
    }
    work += convolutionCost(result, power, cap)
    result = Math.min(result + power - 1, cap)
  }
  return work
}

/** Convolution of two non-negative arrays, truncated to `cap` entries. */
function convolve(a: Float64Array, b: Float64Array, cap: number): Float64Array {
  const len = Math.min(a.length + b.length - 1, cap)
  const out = new Float64Array(len)
  for (let i = 0; i < a.length && i < len; i++) {
    const ai = a[i] as number
    if (ai === 0) continue
    const jMax = Math.min(b.length, len - i)
    for (let j = 0; j < jMax; j++) out[i + j] = (out[i + j] as number) + ai * (b[j] as number)
  }
  return out
}

function levin(n: number, groups: readonly Group[], k: number): KWayResult {
  const s = n
  const cap = n + 1
  const lnPrefactor = new NeumaierSum()
  // ln(n! e^s / s^n) at s = n: ½ln(2πn) + δ(n) by Stirling, which avoids the
  // cancellation between ln n! and n ln n − n.
  if (n >= 32) lnPrefactor.add(0.5 * Math.log(2 * Math.PI * n) + stirlingCorrection(n))
  else lnPrefactor.add(lnFactorial(n) + s - n * Math.log(s))
  let w: Float64Array = Float64Array.of(1)
  for (const { p, multiplicity } of groups) {
    const lambda = s * p
    const split = poissonSplit(k, lambda)
    const lnBelow = split.atLeast < 0.5 ? Math.log1p(-split.atLeast) : Math.log(split.below)
    lnPrefactor.add(multiplicity * lnBelow)
    // Z = (Poisson(λ) | < k), normalized in log space
    const len = Math.min(k, cap)
    const logs = new Float64Array(len)
    let top = Number.NEGATIVE_INFINITY
    for (let j = 0; j < len; j++) {
      logs[j] = poissonLogPmf(j, lambda)
      top = Math.max(top, logs[j] as number)
    }
    const norm = new NeumaierSum()
    for (let j = 0; j < len; j++) norm.add(Math.exp((logs[j] as number) - top))
    let base: Float64Array = new Float64Array(len)
    const lnNorm = Math.log(norm.value)
    for (let j = 0; j < len; j++) base[j] = Math.exp((logs[j] as number) - top - lnNorm)
    let e = multiplicity
    let power: Float64Array | null = null
    while (e > 0) {
      if (e % 2 === 1) power = power === null ? base : convolve(power, base, cap)
      e = Math.floor(e / 2)
      if (e > 0) base = convolve(base, base, cap)
    }
    if (power !== null) w = convolve(w, power, cap)
  }
  const wn = n < w.length ? (w[n] as number) : 0
  if (!(wn > 0)) return { noMatch: 0, match: 1, method: 'levin' }
  const lnNoMatch = Math.min(0, lnPrefactor.value + Math.log(wn))
  return { noMatch: Math.exp(lnNoMatch), match: oneMinusExp(lnNoMatch), method: 'levin' }
}

/** `probs` is either the category probabilities or the number of equal categories. */
function dp(n: number, probs: readonly number[] | number, k: number): KWayResult {
  const B = typeof probs === 'number' ? probs : probs.length
  // suffix sums T_i = p_i + … + p_B (unequal categories only)
  const suffix = new Float64Array(typeof probs === 'number' ? 0 : B)
  if (typeof probs !== 'number') {
    const acc = new NeumaierSum()
    for (let i = B - 1; i >= 0; i--) {
      acc.add(probs[i] as number)
      suffix[i] = acc.value
    }
  }
  let g = new Float64Array(n + 1)
  let r = new Float64Array(n + 1)
  let g2 = new Float64Array(n + 1)
  let r2 = new Float64Array(n + 1)
  const lnInt = new Float64Array(n + 2)
  for (let i = 1; i <= n + 1; i++) lnInt[i] = Math.log(i)

  // last category (0-based index B − 1) takes everything that is left
  const loLast = Math.max(0, n - (B - 1) * (k - 1))
  for (let m = loLast; m <= n; m++) {
    g[m] = m < k ? 1 : 0
    r[m] = m < k ? 0 : 1
  }
  for (let idx = B - 2; idx >= 0; idx--) {
    const remaining = B - idx // categories idx … B−1
    const lo = Math.max(0, n - idx * (k - 1))
    const cap = remaining * (k - 1)
    const nextCap = (remaining - 1) * (k - 1)
    // conditional share of category idx; kept below 1 so a rounding tie with
    // negligible later categories cannot produce ln(0)
    const q =
      typeof probs === 'number'
        ? 1 / remaining
        : Math.min(1 - Number.EPSILON, (probs[idx] as number) / (suffix[idx] as number))
    const lnRatio = Math.log(q) - Math.log1p(-q)
    const ratio = q / (1 - q)
    const ln1mq = Math.log1p(-q)
    for (let m = lo; m <= n; m++) {
      if (m > cap) {
        g2[m] = 0
        r2[m] = 1
        continue
      }
      const top = Math.min(k - 1, m)
      const lp0 = m * ln1mq
      // one pass: P(J = j) for j ≤ top, their sum, and the weighted continuations
      const linear = lp0 > -700
      let t = linear ? Math.exp(lp0) : 0
      let lp = lp0
      let below = 0
      let gSum = 0
      let rSum = 0
      for (let j = 0; j <= top; j++) {
        if (!linear) t = Math.exp(lp)
        below += t
        const rest = m - j
        if (rest > nextCap) {
          rSum += t
        } else {
          gSum += t * (g[rest] as number)
          rSum += t * (r[rest] as number)
        }
        if (j < top) {
          if (linear) t *= ((m - j) / (j + 1)) * ratio
          else lp += (lnInt[m - j] as number) - (lnInt[j + 1] as number) + lnRatio
        }
      }
      if (m >= k) {
        if ((m + 1) * q < k) {
          // mode below k: sum the upper tail upward from j = k (terms shrink)
          if (!linear) t = Math.exp(lp)
          let term = (t * (m - k + 1) * ratio) / k
          let tail = 0
          for (let j = k; j <= m && term > 0; j++) {
            tail += term
            if (term < 1e-17 * tail) break
            term *= ((m - j) / (j + 1)) * ratio
          }
          rSum += tail
        } else {
          rSum += Math.max(0, 1 - below)
        }
      }
      g2[m] = Math.min(1, gSum)
      r2[m] = Math.min(1, rSum)
    }
    ;[g, g2] = [g2, g]
    ;[r, r2] = [r2, r]
  }
  return { noMatch: g[n] as number, match: r[n] as number, method: 'dp' }
}

/** The DP alone, for cross-checks in tests (same preconditions as {@link kWayEngine}). */
export function kWayDp(n: number, probs: readonly number[] | number, k: number): KWayResult {
  return dp(n, probs, k)
}

/** Levin's method alone, for cross-checks in tests; `probs` as for the DP. */
export function kWayLevin(n: number, probs: readonly number[] | number, k: number): KWayResult {
  if (typeof probs === 'number') return levin(n, [{ p: 1 / probs, multiplicity: probs }], k)
  const byValue = new Map<number, number>()
  for (const p of probs) byValue.set(p, (byValue.get(p) ?? 0) + 1)
  return levin(
    n,
    [...byValue].map(([p, multiplicity]) => ({ p, multiplicity })),
    k,
  )
}

/**
 * P(some category receives ≥ k of n draws). `probs` must be a validated
 * probability vector without zeros; `uniform` short-circuits the grouping.
 */
export function kWayEngine(
  n: number,
  probs: readonly number[] | { readonly uniform: number },
  k: number,
): KWayResult {
  const categories = 'uniform' in probs ? probs.uniform : probs.length
  if (n < k) return { noMatch: 1, match: 0, method: 'dp' }
  if (k === 1 || n > categories * (k - 1)) return { noMatch: 0, match: 1, method: 'dp' }
  if (categories === 1) return { noMatch: 0, match: 1, method: 'dp' } // n ≥ k > k − 1
  let groups: Group[]
  if ('uniform' in probs) {
    groups = [{ p: 1 / probs.uniform, multiplicity: probs.uniform }]
  } else {
    const byValue = new Map<number, number>()
    for (const p of probs) byValue.set(p, (byValue.get(p) ?? 0) + 1)
    groups = [...byValue].map(([p, multiplicity]) => ({ p, multiplicity }))
  }
  const dpCost = dpWork(n, categories, k)
  const levinCost = levinWork(n, groups, k)
  if (dpCost <= DP_PREFERRED || (dpCost <= levinCost && dpCost <= KWAY_WORK_LIMIT)) {
    return dp(n, 'uniform' in probs ? probs.uniform : probs, k)
  }
  if (levinCost <= KWAY_WORK_LIMIT) return levin(n, groups, k)
  throw new CoincidenceError(
    'too_large',
    `exact k-fold match for n=${n}, ${categories} categories, k=${k} needs ~${Math.min(
      dpCost,
      levinCost,
    ).toExponential(1)} operations (limit ${KWAY_WORK_LIMIT}); use kWayMatchApprox`,
    { argument: 'n' },
  )
}
