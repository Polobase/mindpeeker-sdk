/**
 * Log-space tail helpers for the sequential (e-process) statistics: the log of
 * the regularized lower incomplete gamma, the log Gamma-density prefactor, and
 * x²/2 + ln Φ(x). Each stays finite and accurate where the linear-space value
 * underflows (a degenerate all-zero z stream drives P(a, x) below 1e-308 after
 * a few hundred steps) or where two huge terms would cancel.
 */
import { NegentropyError } from '../errors.js'
import { gammaP, gammaQ, lnGamma, log1pmx, stirlingCorrection } from './gamma.js'
import { normCdf, normSf } from './special.js'

const LN_SQRT_2PI = 0.9189385332046727 // ln √(2π)
/** Below this P(a, x) is recomputed in log space (the linear value may be inexact or 0). */
const LINEAR_P_FLOOR = 1e-250
/** Below this x the Mills-ratio asymptotic series replaces ln Φ(x). */
const MILLS_SWITCH = -30

/**
 * Stirling remainder δ(a) = lnΓ(a) − [(a − ½) ln a − a + ½ ln 2π] for any a > 0
 * (series for a ≥ 10, direct difference below — where no cancellation occurs).
 */
export function stirlingRemainder(a: number): number {
  if (a >= 10) return stirlingCorrection(a)
  return lnGamma(a) - ((a - 0.5) * Math.log(a) - a + LN_SQRT_2PI)
}

/** ln(x^a e^{−x} / Γ(a)) for a > 0, x > 0, without forming a·ln a against lnΓ(a). */
export function lnGammaPrefactor(a: number, x: number): number {
  if (a < 10) return a * Math.log(x) - x - lnGamma(a)
  const sigma = (x - a) / a
  const core = Math.abs(sigma) < 0.5 ? a * log1pmx(sigma) : a * Math.log(x / a) - (x - a)
  return core - stirlingCorrection(a) + 0.5 * Math.log(a / (2 * Math.PI))
}

/**
 * ln P(a, x) for a > 0, x > 0: log1p(−Q) for x ≥ a, ln P below the mean
 * where P is representable, and the defining series in log space where P underflows
 * (P(a, x) = x^a e^{−x}/Γ(a) · Σₙ xⁿ/(a(a+1)…(a+n)), which converges
 * geometrically there because x < a).
 */
export function lnGammaP(a: number, x: number): number {
  // at or above the mean Q ≲ ½, so log1p(−Q) is accurate; below it P ≲ ½ and ln P is
  if (x >= a) return Math.log1p(-gammaQ(a, x))
  const p = gammaP(a, x)
  if (p > LINEAR_P_FLOOR) return Math.log(p)
  const maxIter = 10_000 + Math.ceil(40 * Math.sqrt(a))
  let ap = a
  let term = 1 / a
  let sum = term
  for (let i = 0; i < maxIter; i++) {
    ap += 1
    term *= x / ap
    sum += term
    if (term < sum * 1e-16) return lnGammaPrefactor(a, x) + Math.log(sum)
  }
  throw new NegentropyError(
    'numerical',
    `ln P(a, x) series did not converge for a=${a}, x=${x} — please report this input`,
  )
}

/**
 * h(x) = x²/2 + ln Φ(x), cancellation-free on the whole real line: for
 * x < −30 the Mills-ratio expansion ln Φ(x) = −x²/2 − ln(−x) − ½ ln 2π +
 * ln(1 − x⁻² + 3x⁻⁴ − 15x⁻⁶ + 105x⁻⁸ − 945x⁻¹⁰) lets the x²/2 terms cancel
 * symbolically (truncation error < 1e-13 there).
 */
export function halfSquarePlusLnPhi(x: number): number {
  if (x > 0) return 0.5 * x * x + Math.log1p(-normSf(x))
  if (x >= MILLS_SWITCH) return 0.5 * x * x + Math.log(normCdf(x))
  const inv2 = 1 / (x * x)
  const series = 1 + inv2 * (-1 + inv2 * (3 + inv2 * (-15 + inv2 * (105 - 945 * inv2))))
  return -Math.log(-x) - LN_SQRT_2PI + Math.log(series)
}

/** φ(x)/Φ(x) (the inverse Mills ratio of the lower tail), via h(x). */
export function normalHazardLower(x: number): number {
  return Math.exp(-LN_SQRT_2PI - halfSquarePlusLnPhi(x))
}
