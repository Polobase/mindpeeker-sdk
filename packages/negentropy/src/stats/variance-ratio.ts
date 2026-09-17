import { NegentropyError } from '../errors.js'
import { assertFiniteArray } from '../internal/assert.js'
import { KahanSum } from '../internal/kahan.js'
import { normalP } from './pvalues.js'

/** Lo–MacKinlay variance-ratio test result. */
export interface VarianceRatioResult {
  /** VR(q) = σ̂²_c(q)/σ̂²_a — 1 for a random walk, > 1 persistent, < 1 mean-reverting increments. */
  ratio: number
  /** Homoskedastic z = √n·(VR − 1)/√(2(2q − 1)(q − 1)/(3q)) — the iid-increments null. */
  statistic: number
  /** Two-sided normal p of `statistic`. */
  pValue: number
  /** Heteroskedasticity-consistent z* (uncorrelated but possibly heteroskedastic increments) and its two-sided p. */
  robust: { statistic: number; pValue: number }
  q: number
  /** Increments analysed. */
  n: number
}

/**
 * Lo & MacKinlay (1988) variance-ratio test — a small long-memory diagnostic
 * for a stream of increments x₁ … xₙ (z-scores, trial deviations): does the
 * walk Σx diffuse like a random walk (Var of q-step changes = q × Var of
 * 1-step changes)? With μ̂ = mean(x),
 * $$\hat\sigma^2_a = \frac{1}{n-1}\sum_k (x_k-\hat\mu)^2,\qquad
 *   \hat\sigma^2_c = \frac1m\sum_{k=q}^{n}\Big(\sum_{j=k-q+1}^{k} x_j - q\hat\mu\Big)^2,$$
 * m = q(n − q + 1)(1 − q/n) (overlapping q-sums, both variances bias-corrected),
 * VR = σ̂²_c/σ̂²_a, and z = √n(VR − 1)/√φ with φ = 2(2q − 1)(q − 1)/(3q) under
 * iid increments, or the robust θ̂ = Σ_{j=1}^{q−1} [2(q − j)/q]² δ̂(j),
 * δ̂(j) = n·Σₖ(xₖ − μ̂)²(xₖ₋ⱼ − μ̂)² / [Σₖ(xₖ − μ̂)²]². Both z's are
 * asymptotically N(0, 1) (n ≫ q); p-values are two-sided. VR(2) ≈ 1 + ρ̂(1).
 * Matches `arch.unitroot.VarianceRatio(cumsum, lags=q)` (overlap, debiased).
 * Needs integer q ≥ 2, n > q and non-constant finite increments.
 */
export function varianceRatio(x: ArrayLike<number>, q: number): VarianceRatioResult {
  if (!Number.isInteger(q) || q < 2) {
    throw new NegentropyError('invalid_config', `varianceRatio: q must be an integer ≥ 2, got ${q}`)
  }
  const n = x.length
  if (n <= q) {
    throw new NegentropyError(
      'insufficient_data',
      `varianceRatio needs more than q = ${q} increments, got ${n}`,
    )
  }
  assertFiniteArray(x, 'varianceRatio: x')
  const total = new KahanSum()
  for (let k = 0; k < n; k++) total.add(x[k] as number)
  const mu = total.value / n
  const centered = new Float64Array(n)
  const squares = new KahanSum()
  for (let k = 0; k < n; k++) {
    const d = (x[k] as number) - mu
    centered[k] = d
    squares.add(d * d)
  }
  if (!(squares.value > 0)) {
    throw new NegentropyError('insufficient_data', 'varianceRatio: increments are constant')
  }
  const sigmaA = squares.value / (n - 1)
  // overlapping q-step sums of the centered increments, via a sliding window
  const qSums = new KahanSum()
  let window = 0
  for (let k = 0; k < q; k++) window += centered[k] as number
  qSums.add(window * window)
  for (let k = q; k < n; k++) {
    window += (centered[k] as number) - (centered[k - q] as number)
    qSums.add(window * window)
  }
  const m = q * (n - q + 1) * (1 - q / n)
  const sigmaC = qSums.value / m
  const ratio = sigmaC / sigmaA
  const phi = (2 * (2 * q - 1) * (q - 1)) / (3 * q)
  const statistic = (Math.sqrt(n) * (ratio - 1)) / Math.sqrt(phi)
  const scale = squares.value * squares.value
  let theta = 0
  for (let j = 1; j < q; j++) {
    const acc = new KahanSum()
    for (let k = j; k < n; k++) {
      const a = centered[k] as number
      const b = centered[k - j] as number
      acc.add(a * a * b * b)
    }
    const weight = (2 * (q - j)) / q
    theta += weight * weight * ((n * acc.value) / scale)
  }
  if (!(theta > 0)) {
    throw new NegentropyError(
      'insufficient_data',
      'varianceRatio: every lagged product of squared increments is zero — the robust variance is undefined',
    )
  }
  const robustStatistic = (Math.sqrt(n) * (ratio - 1)) / Math.sqrt(theta)
  return {
    ratio,
    statistic,
    pValue: normalP(statistic),
    robust: { statistic: robustStatistic, pValue: normalP(robustStatistic) },
    q,
    n,
  }
}
