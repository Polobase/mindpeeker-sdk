/**
 * Numeric glue: negentropy's special functions behind a `numerical` error
 * mapping, exact big-rational → float conversion, and the Stirling pieces the
 * beta-binomial Bayes factor needs to stay accurate at large n.
 */
import {
  betaInc as nBetaInc,
  betaPpf as nBetaPpf,
  binomialCdf as nBinomialCdf,
  binomialPmf as nBinomialPmf,
  binomialSf as nBinomialSf,
  chi2Sf as nChi2Sf,
  lnBeta as nLnBeta,
  normPpf as nNormPpf,
  normSf as nNormSf,
} from '@mindpeeker/negentropy/numerics'
import { JudgingError } from '../errors.js'

function numeric<T>(name: string, compute: () => T): T {
  try {
    return compute()
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : ''
    throw new JudgingError('numerical', `${name} failed${detail}`, { cause: error })
  }
}

/** Binomial pmf P(X = k). */
export const binomialPmf = (k: number, n: number, p: number): number =>
  numeric('binomialPmf', () => nBinomialPmf(k, n, p))
/** Binomial CDF P(X ≤ k). */
export const binomialCdf = (k: number, n: number, p: number): number =>
  numeric('binomialCdf', () => nBinomialCdf(k, n, p))
/** Binomial survival P(X > k). */
export const binomialSf = (k: number, n: number, p: number): number =>
  numeric('binomialSf', () => nBinomialSf(k, n, p))
/** Regularized incomplete beta $I_x(a, b)$. */
export const betaInc = (a: number, b: number, x: number): number =>
  numeric('betaInc', () => nBetaInc(a, b, x))
/** Beta(a, b) quantile. */
export const betaPpf = (q: number, a: number, b: number): number =>
  numeric('betaPpf', () => nBetaPpf(q, a, b))
/** ln B(a, b). */
export const lnBeta = (a: number, b: number): number => numeric('lnBeta', () => nLnBeta(a, b))
/** Chi-square survival P(χ²_k > x). */
export const chi2Sf = (x: number, k: number): number => numeric('chi2Sf', () => nChi2Sf(x, k))
/** Standard normal survival 1 − Φ(z). */
export const normSf = (z: number): number => numeric('normSf', () => nNormSf(z))
/** Standard normal quantile Φ⁻¹(p). */
export const normPpf = (p: number): number => numeric('normPpf', () => nNormPpf(p))

/** Upper-tail normal quantile $z$ with $1 - \Phi(z) = q$, precise for tiny q. */
export function normIsf(q: number): number {
  return q <= 0.5 ? -normPpf(q) : normPpf(1 - q)
}

// ---------------------------------------------------------------------------
// big rationals

/** Approximate bit length of a positive bigint (exact to within 3 bits). */
function roughBits(value: bigint): number {
  return value.toString(16).length * 4
}

/**
 * The float nearest (to ~2⁻⁶⁰ relative) to `num / den` for `num ≥ 0`,
 * `den > 0`. Works far outside the double range of either operand.
 */
export function ratioToNumber(num: bigint, den: bigint): number {
  if (num === 0n) return 0
  const shift = 68 - (roughBits(num) - roughBits(den))
  const q = shift >= 0 ? (num << BigInt(shift)) / den : num / (den << BigInt(-shift))
  // split the power of two so neither factor over- or underflows prematurely
  const half = Math.trunc(-shift / 2)
  return Number(q) * 2 ** half * 2 ** (-shift - half)
}

const FACTORIALS: bigint[] = [1n]

/** n! as a bigint (memoized). */
export function factorial(n: number): bigint {
  for (let i = FACTORIALS.length; i <= n; i++) {
    FACTORIALS.push((FACTORIALS[i - 1] as bigint) * BigInt(i))
  }
  return FACTORIALS[n] as bigint
}

// ---------------------------------------------------------------------------
// Stirling pieces for ln[x^α (1 − x)^β / B(α, β)]

// Stirling-series coefficients B_2j / (2j(2j−1)), j = 1…8
const STIRLING = [
  1 / 12,
  -1 / 360,
  1 / 1260,
  -1 / 1680,
  1 / 1188,
  -691 / 360360,
  1 / 156,
  -3617 / 122400,
]

/** δ(y) = lnΓ(y) − [(y − ½) ln y − y + ½ ln 2π] for y ≥ 10. */
function stirlingCorrection(y: number): number {
  const inv2 = 1 / (y * y)
  let term = 1 / y
  let sum = 0
  for (const c of STIRLING) {
    sum += c * term
    term *= inv2
  }
  return sum
}

/** ln(1 + u) − u without cancellation for small |u|. */
function log1pmx(u: number): number {
  if (Math.abs(u) >= 0.01) return Math.log1p(u) - u
  let power = u * u
  let sum = 0
  for (let j = 2; j <= 17; j++) {
    sum += ((j % 2 === 0 ? -1 : 1) * power) / j
    power *= u
  }
  return sum
}

/**
 * $\ln[x^\alpha (1-x)^\beta / B(\alpha,\beta)]$ for 0 < x < 1. For α, β ≥ 10
 * it is expanded around the mean with Stirling's series, so the O(α ln α)
 * terms cancel analytically (NR §6.4 prefactor, DLMF 5.11.1):
 * α·log1pmx(d/α) + β·log1pmx(−d/β) + ½ ln(αβ/(2πs)) + δ(s) − δ(α) − δ(β),
 * with s = α + β, d = xs − α.
 */
export function lnBetaPrefactor(alpha: number, beta: number, x: number): number {
  if (alpha < 10 || beta < 10) {
    return alpha * Math.log(x) + beta * Math.log1p(-x) - lnBeta(alpha, beta)
  }
  const s = alpha + beta
  const d = x * s - alpha
  const scaled = (m: number, diff: number): number =>
    Math.abs(diff) < 0.5 * m ? m * log1pmx(diff / m) : m * Math.log1p(diff / m) - diff
  return (
    scaled(alpha, d) +
    scaled(beta, -d) +
    0.5 * Math.log((alpha * beta) / (2 * Math.PI * s)) +
    stirlingCorrection(s) -
    stirlingCorrection(alpha) -
    stirlingCorrection(beta)
  )
}
