import { NegentropyError } from '../errors.js'

/**
 * Scalar negentropy estimators: J(x) = H(gaussian of equal variance) − H(x),
 * the canonical "how far from maximally random" measure — J ≥ 0, zero iff
 * Gaussian. All estimators standardize internally with POPULATION moments
 * (divide by n), so inputs need no preprocessing. Outputs of one family are
 * comparable with each other, not across families (proportionality constants
 * are set to 1).
 */

/** Null constants E[G(ν)], Var[G(ν)] for ν ~ N(0,1) — frozen from mpmath (see fixtures). */
export const LOGCOSH_GAUSSIAN_MEAN = 0.37456720749143796
export const LOGCOSH_GAUSSIAN_VARIANCE = 0.18976744917236543
export const EXP_GAUSSIAN_MEAN: number = -Math.SQRT1_2 // exact: −1/√2
export const EXP_GAUSSIAN_VARIANCE: number = 1 / Math.sqrt(3) - 0.5 // exact: 1/√3 − ½

/**
 * Asymptotic variance of √n·(E[G(y)] − E[G(ν)]) under H0 with EMPIRICAL
 * standardization — the constant that actually calibrates the z detector.
 * Delta method: Var[G(ν) − (b/2)(ν² − 1)] with b = E[ν·G′(ν)]. For logcosh
 * this is ~34× smaller than Var[G(ν)]: standardization removes G's quadratic
 * component almost entirely. Frozen from mpmath (see fixtures).
 */
export const LOGCOSH_NULL_VARIANCE = 0.0063278669911599715
export const EXP_NULL_VARIANCE = 0.014850269189625764

const MIN_SAMPLES = 8

interface Standardized {
  y: Float64Array
  mean: number
  sd: number
}

function standardize(x: ArrayLike<number>): Standardized | null {
  const n = x.length
  if (n < MIN_SAMPLES) {
    throw new NegentropyError(
      'insufficient_data',
      `negentropy estimators need ≥ ${MIN_SAMPLES} samples, got ${n}`,
    )
  }
  let sum = 0
  for (let i = 0; i < n; i++) sum += x[i] as number
  const mean = sum / n
  let m2 = 0
  for (let i = 0; i < n; i++) m2 += ((x[i] as number) - mean) ** 2
  const sd = Math.sqrt(m2 / n)
  if (!(sd > 0)) return null
  const y = new Float64Array(n)
  for (let i = 0; i < n; i++) y[i] = ((x[i] as number) - mean) / sd
  return { y, mean, sd }
}

export interface MomentNegentropy {
  /** J ≈ skew²/12 + exkurt²/48 (nats, proportional). NaN when degenerate. */
  j: number
  skew: number
  /** Excess kurtosis E[y⁴] − 3. */
  exkurt: number
  n: number
  /** True when the input is constant — maximally ordered but not standardizable. */
  degenerate: boolean
}

/**
 * Classic moment approximation (Jones–Sibson/Comon): J ≈ (1/12)E[y³]² +
 * (1/48)(E[y⁴] − 3)². The y⁴ term makes it very outlier-sensitive — prefer
 * the contrast estimators for heavy-tailed data. Null level: E[J] ≈ 1/n.
 */
export function negentropyKurtosis(x: ArrayLike<number>): MomentNegentropy {
  const standardized = standardize(x)
  if (!standardized) {
    return { j: Number.NaN, skew: Number.NaN, exkurt: Number.NaN, n: x.length, degenerate: true }
  }
  const { y } = standardized
  let m3 = 0
  let m4 = 0
  for (const value of y) {
    const cubed = value * value * value
    m3 += cubed
    m4 += cubed * value
  }
  const skew = m3 / y.length
  const exkurt = m4 / y.length - 3
  return {
    j: (skew * skew) / 12 + (exkurt * exkurt) / 48,
    skew,
    exkurt,
    n: y.length,
    degenerate: false,
  }
}

export interface ContrastNegentropy {
  /** J ≈ (E[G(y)] − E[G(ν)])² (proportional). NaN when degenerate. */
  j: number
  /**
   * Null-calibrated detector: √n·(E[G(y)] − E[G(ν)])/√nullVariance ~ N(0,1)
   * under H0 (the delta-method variance accounts for empirical
   * standardization). Sign: ln cosh u ≈ u²/2 − u⁴/12, so E[G] ≈ ½ − kurt/12
   * — POSITIVE z ⇒ sub-Gaussian (uniform, bimodal), NEGATIVE ⇒ super-Gaussian
   * (heavy tails/peaked); same direction for the exp contrast.
   */
  z: number
  meanG: number
  n: number
  degenerate: boolean
}

function contrast(
  x: ArrayLike<number>,
  g: (u: number) => number,
  gaussianMean: number,
  nullVariance: number,
): ContrastNegentropy {
  const standardized = standardize(x)
  if (!standardized) {
    return { j: Number.NaN, z: Number.NaN, meanG: Number.NaN, n: x.length, degenerate: true }
  }
  const { y } = standardized
  let sum = 0
  for (const value of y) sum += g(value)
  const meanG = sum / y.length
  const delta = meanG - gaussianMean
  return {
    j: delta * delta,
    z: (Math.sqrt(y.length) * delta) / Math.sqrt(nullVariance),
    meanG,
    n: y.length,
    degenerate: false,
  }
}

/**
 * Hyvärinen's log-cosh contrast (a = 1, fixed — the null constants are
 * a-specific). Robust general-purpose default; see `ContrastNegentropy.z`
 * for the sign convention.
 */
export function negentropyLogcosh(x: ArrayLike<number>): ContrastNegentropy {
  return contrast(x, (u) => Math.log(Math.cosh(u)), LOGCOSH_GAUSSIAN_MEAN, LOGCOSH_NULL_VARIANCE)
}

/** Hyvärinen's Gaussian contrast G(u) = −exp(−u²/2) — most sensitive to peaked/super-Gaussian sources. */
export function negentropyExp(x: ArrayLike<number>): ContrastNegentropy {
  return contrast(x, (u) => -Math.exp((-u * u) / 2), EXP_GAUSSIAN_MEAN, EXP_NULL_VARIANCE)
}
