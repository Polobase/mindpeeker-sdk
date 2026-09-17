/**
 * Gamma-family core: lnΓ, the regularized incomplete gammas P and Q, and
 * erfc. Everything downstream (p-values, envelopes, probit mapping, binomial
 * tails) keys off these.
 *
 * Accuracy target: ~1e-13 relative error for P and Q at any a (validated
 * against scipy/mpmath from a = 0.5 to a = 5·10⁸), with O(1) cost in a:
 * - a < 100, or |x − a| ≥ 0.3·a: series (P) / Lentz continued fraction (Q),
 *   Numerical Recipes §6.2 — both converge in O(1)–O(√a) terms there;
 * - a ≥ 100 and |x − a| < 0.3·a: Temme's uniform asymptotic expansion
 *   (DLMF §8.12), which replaces the O(√a) series/CF near the transition
 *   point that used to stop converging for a ≳ 1.8·10⁶ (χ² df ≳ 3.7·10⁶).
 * Prefactors x^a e^{−x}/Γ(a) are formed via Stirling's series and ln(1+u)−u
 * so the large cancelling terms a·ln a never meet in floating point.
 */
import { NegentropyError } from '../errors.js'
import { assertNotNaN } from './assert.js'
import { TEMME_D } from './temme-coefficients.js'

const EPS = 1e-15
const FPMIN = 1e-300
const LN_SQRT_2PI = 0.9189385332046727 // ln(√(2π))
const TEMME_MIN_A = 100
const TEMME_MAX_RATIO = 0.3

// Lanczos g=7, n=9 (Godfrey coefficients — ~1e-15 relative error)
const LANCZOS_G = 7
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.3234287776531,
  -176.6150291621406, 12.507343278686905, -0.13857109526572012, 9.984369578019572e-6,
  1.5056327351493116e-7,
]

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

/** Natural log of the gamma function. Domain: x > 0 (reflection handles (0, 0.5)); lnΓ(∞) = ∞. */
export function lnGamma(x: number): number {
  assertNotNaN(x, 'lnGamma: x')
  if (!(x > 0)) throw new NegentropyError('invalid_config', `lnGamma: x must be > 0, got ${x}`)
  if (x === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x)
  const xm1 = x - 1
  let a = LANCZOS[0] as number
  for (let i = 1; i < LANCZOS.length; i++) a += (LANCZOS[i] as number) / (xm1 + i)
  const t = xm1 + LANCZOS_G + 0.5
  return LN_SQRT_2PI + (xm1 + 0.5) * Math.log(t) - t + Math.log(a)
}

/**
 * Stirling correction δ(a) = lnΓ(a) − [(a − ½)ln a − a + ½ln 2π], via its
 * asymptotic series. Accurate to ~1e-17 absolute for a ≥ 10 (the only range
 * it is used in).
 */
export function stirlingCorrection(a: number): number {
  const inv = 1 / a
  const inv2 = inv * inv
  let sum = 0
  for (let j = STIRLING.length - 1; j >= 0; j--) sum = sum * inv2 + (STIRLING[j] as number)
  return sum * inv
}

/** ln(1 + u) − u without cancellation, for u > −1 (series for |u| < ½). */
export function log1pmx(u: number): number {
  if (Math.abs(u) >= 0.5) return Math.log1p(u) - u
  // Σ_{k≥2} (−1)^{k+1} u^k / k, with power = (−1)^{k+1} u^k
  let power = -u * u
  let sum = power / 2
  for (let k = 3; k < 200; k++) {
    power *= -u
    const term = power / k
    sum += term
    if (Math.abs(term) < 1e-17 * Math.abs(sum)) break
  }
  return sum
}

/**
 * x^a e^{−x} / Γ(a) for a > 0, x > 0 — the prefactor shared by both gamma
 * branches and (divided by x) the Gamma(a) density. For a ≥ 10 it is formed
 * as exp(a·(ln(1+σ) − σ))·√(a/2π)·e^{−δ(a)} with σ = (x − a)/a.
 */
export function gammaPrefactor(a: number, x: number): number {
  if (a < 10) return Math.exp(a * Math.log(x) - x - lnGamma(a))
  const sigma = (x - a) / a
  const core = Math.abs(sigma) < 0.5 ? a * log1pmx(sigma) : a * Math.log(x / a) - (x - a)
  return Math.exp(core - stirlingCorrection(a)) * Math.sqrt(a / (2 * Math.PI))
}

function notConverged(what: string, a: number, x: number): never {
  throw new NegentropyError(
    'numerical',
    `${what} did not converge for a=${a}, x=${x} — please report this input`,
  )
}

/** Series expansion for P(a, x), used for x < a + 1 outside the Temme band. */
function gammaPSeries(a: number, x: number): number {
  const maxIter = 10_000 + Math.ceil(20 * Math.sqrt(a))
  let ap = a
  let del = 1 / a
  let sum = del
  for (let i = 0; i < maxIter; i++) {
    ap += 1
    del *= x / ap
    sum += del
    if (Math.abs(del) < Math.abs(sum) * EPS) return sum * gammaPrefactor(a, x)
  }
  return notConverged('gammaP series', a, x)
}

/** Lentz modified continued fraction for Q(a, x), used for x ≥ a + 1 outside the Temme band. */
function gammaQContinuedFraction(a: number, x: number): number {
  const maxIter = 10_000 + Math.ceil(20 * Math.sqrt(a))
  let b = x + 1 - a
  let c = 1 / FPMIN
  let d = 1 / b
  let h = d
  for (let i = 1; i <= maxIter; i++) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = b + an / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) return h * gammaPrefactor(a, x)
  }
  return notConverged('gammaQ continued fraction', a, x)
}

/**
 * Temme's uniform asymptotic expansion (DLMF 8.12.3–8.12.12):
 * Q(a, x) = ½erfc(η√(a/2)) + R, P(a, x) = ½erfc(−η√(a/2)) − R,
 * R = e^{−aη²/2}/√(2πa) · Σ_k c_k(η) a^{−k}, ½η² = λ − 1 − ln λ, λ = x/a.
 */
function gammaTemme(a: number, x: number, upper: boolean): number {
  const sigma = (x - a) / a
  const eta = sigma === 0 ? 0 : Math.sign(sigma) * Math.sqrt(-2 * log1pmx(sigma))
  // With a ≥ 100 and |η| < 0.34 every retained term is far inside the
  // asymptotic regime (|c_k| ≲ 1e-3, a^{−k} ≤ 1e-2k), so all rows are summed —
  // no data-dependent early exit that a zero crossing of some c_k could trip.
  let sum = 0
  let afac = 1
  for (const row of TEMME_D) {
    let ck = 0
    for (let n = row.length - 1; n >= 0; n--) ck = ck * eta + (row[n] as number)
    sum += ck * afac
    afac /= a
  }
  const tail = (Math.exp(-0.5 * a * eta * eta) * sum) / Math.sqrt(2 * Math.PI * a)
  const lead = 0.5 * erfc((upper ? eta : -eta) * Math.sqrt(a / 2))
  return upper ? lead + tail : lead - tail
}

function validateGammaArgs(fn: string, a: number, x: number): void {
  assertNotNaN(a, `${fn}: a`)
  assertNotNaN(x, `${fn}: x`)
  if (!(a > 0) || a === Number.POSITIVE_INFINITY || !(x >= 0)) {
    throw new NegentropyError(
      'invalid_config',
      `${fn}: need finite a > 0 and x ≥ 0; got a=${a}, x=${x}`,
    )
  }
}

function inTemmeBand(a: number, x: number): boolean {
  return a >= TEMME_MIN_A && Math.abs(x - a) < TEMME_MAX_RATIO * a
}

/** Regularized lower incomplete gamma P(a, x) = γ(a, x)/Γ(a); P(a, ∞) = 1. */
export function gammaP(a: number, x: number): number {
  validateGammaArgs('gammaP', a, x)
  if (x === 0) return 0
  if (x === Number.POSITIVE_INFINITY) return 1
  if (inTemmeBand(a, x)) return gammaTemme(a, x, false)
  return x < a + 1 ? gammaPSeries(a, x) : 1 - gammaQContinuedFraction(a, x)
}

/** Regularized upper incomplete gamma Q(a, x) = 1 − P(a, x); Q(a, ∞) = 0. */
export function gammaQ(a: number, x: number): number {
  validateGammaArgs('gammaQ', a, x)
  if (x === 0) return 1
  if (x === Number.POSITIVE_INFINITY) return 0
  if (inTemmeBand(a, x)) return gammaTemme(a, x, true)
  return x < a + 1 ? 1 - gammaPSeries(a, x) : gammaQContinuedFraction(a, x)
}

/**
 * Complementary error function, via erfc(x) = Q(½, x²) — accurate deep into
 * the tail. erfc(+∞) = 0, erfc(−∞) = 2.
 */
export function erfc(x: number): number {
  assertNotNaN(x, 'erfc: x')
  if (x < 0) return 2 - erfc(-x)
  if (x === 0) return 1
  if (x === Number.POSITIVE_INFINITY) return 0
  return gammaQ(0.5, x * x)
}
