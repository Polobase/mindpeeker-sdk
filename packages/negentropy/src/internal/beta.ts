/**
 * Beta-family core: ln B(a, b), the regularized incomplete beta I_x(a, b)
 * (Lentz continued fraction, Numerical Recipes §6.4) and its inverse. The
 * sibling of the incomplete gamma: exact binomial tails, Beta posteriors and
 * F/t tails all key off it.
 *
 * The prefactor x^a(1−x)^b/B(a, b) is formed around the mean a/(a+b) with
 * Stirling corrections and ln(1+u) − u, so large a, b (binomial n ≫ 10⁶) keep
 * full relative precision instead of losing it to cancelling a·ln a terms.
 */
import { NegentropyError } from '../errors.js'
import { assertNotNaN } from './assert.js'
import { lnGamma, log1pmx, stirlingCorrection } from './gamma.js'
import { normPpf } from './special.js'

const EPS = 1e-15
const FPMIN = 1e-300

function validateShape(fn: string, a: number, b: number): void {
  assertNotNaN(a, `${fn}: a`)
  assertNotNaN(b, `${fn}: b`)
  if (!(a > 0 && b > 0) || a === Number.POSITIVE_INFINITY || b === Number.POSITIVE_INFINITY) {
    throw new NegentropyError(
      'invalid_config',
      `${fn}: shape parameters must be finite and > 0, got a=${a}, b=${b}`,
    )
  }
}

/**
 * Natural log of the beta function, $\ln B(a,b) = \ln\Gamma(a) + \ln\Gamma(b) - \ln\Gamma(a+b)$,
 * for finite a, b > 0. When the larger argument is ≥ 10 the difference
 * lnΓ(b) − lnΓ(a+b) is taken through Stirling's series, so e.g.
 * lnBeta(0.5, 1e12) keeps all its digits.
 */
export function lnBeta(a: number, b: number): number {
  validateShape('lnBeta', a, b)
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  if (hi < 10) return lnGamma(lo) + lnGamma(hi) - lnGamma(lo + hi)
  const difference =
    -(hi - 0.5) * Math.log1p(lo / hi) -
    lo * Math.log(lo + hi) +
    lo +
    stirlingCorrection(hi) -
    stirlingCorrection(lo + hi)
  return lnGamma(lo) + difference
}

/** n·(ln(m/n) − (m − n)/n) given m − n = diff, without cancellation. */
function scaledLog1pmx(n: number, m: number, diff: number): number {
  return Math.abs(diff) < 0.5 * n ? n * log1pmx(diff / n) : n * Math.log(m / n) - diff
}

/** x^a (1 − x)^b / B(a, b) for 0 < x < 1. */
export function betaPrefactor(a: number, b: number, x: number): number {
  if (Math.min(a, b) < 10) {
    return Math.exp(a * Math.log(x) + b * Math.log1p(-x) - lnBeta(a, b))
  }
  const s = a + b
  const d = x * s - a // x·s − a = −((1 − x)·s − b)
  const core = scaledLog1pmx(a, x * s, d) + scaledLog1pmx(b, (1 - x) * s, -d)
  const stirling = stirlingCorrection(s) - stirlingCorrection(a) - stirlingCorrection(b)
  return Math.exp(core + stirling) * Math.sqrt((a * b) / (2 * Math.PI * s))
}

/** Lentz evaluation of the incomplete-beta continued fraction (NR §6.4 betacf). */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const maxIter = 10_000 + Math.ceil(20 * Math.sqrt(Math.max(a, b)))
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= maxIter; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) <= EPS) return h
  }
  throw new NegentropyError(
    'numerical',
    `betaInc continued fraction did not converge for a=${a}, b=${b}, x=${x} — please report this input`,
  )
}

/**
 * Regularized incomplete beta function
 * $$I_x(a,b) = \frac{1}{B(a,b)}\int_0^x t^{a-1}(1-t)^{b-1}\,dt$$
 * for finite a, b > 0 and 0 ≤ x ≤ 1 — the CDF of Beta(a, b) at x. The
 * continued fraction is evaluated on whichever side of the switch point
 * (a+1)/(a+b+2) converges fast; the other side uses I_x(a,b) = 1 − I_{1−x}(b,a).
 * Relative accuracy ~1e-13 for shapes up to ~10⁴; near the mean of very large
 * shapes the O(√max(a,b)) fraction terms leave ~1e-12 at 10⁶ and ~1e-11 at 10⁸.
 */
export function betaInc(a: number, b: number, x: number): number {
  validateShape('betaInc', a, b)
  assertNotNaN(x, 'betaInc: x')
  if (!(x >= 0 && x <= 1)) {
    throw new NegentropyError('invalid_config', `betaInc: x must be in [0, 1], got ${x}`)
  }
  if (x === 0 || x === 1) return x
  const front = betaPrefactor(a, b, x)
  if (x < (a + 1) / (a + b + 2)) return (front * betaContinuedFraction(a, b, x)) / a
  return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b
}

/** Beta(a, b) quantile for 0 < q ≤ ½: Newton in u = ln x with a bisection bracket. */
function betaQuantileLower(q: number, a: number, b: number): number {
  const lnQ = Math.log(q)
  const objective = (x: number): number => Math.log(betaInc(a, b, x)) - lnQ
  const lnB = lnBeta(a, b)
  const mean = a / (a + b)
  const sd = Math.sqrt((a * b) / ((a + b) * (a + b) * (a + b + 1)))
  // seeds: small-x asymptote I_x ≈ x^a/(a·B), a normal approximation, half the mean
  const seeds = [Math.exp((lnQ + Math.log(a) + lnB) / a), mean + normPpf(q) * sd, mean / 2]
  let x = mean
  let best = Number.POSITIVE_INFINITY
  for (const seed of seeds) {
    if (!(seed > 0 && seed < 1)) continue
    const size = Math.abs(objective(seed))
    if (size < best) {
      best = size
      x = seed
    }
  }
  let lo = 0
  let hi = 1
  if (objective(x) > 0) {
    hi = x
    for (let next = x / 16; next > 0; next /= 16) {
      if (objective(next) <= 0) {
        lo = next
        break
      }
      hi = next
    }
    x = hi
  } else {
    lo = x
    for (let next = (x + 1) / 2; next < 1; next = (next + 1) / 2) {
      if (objective(next) > 0) {
        hi = next
        break
      }
      lo = next
    }
    x = lo
  }
  for (let i = 0; i < 300; i++) {
    const cdf = betaInc(a, b, x)
    const g = Math.log(cdf) - lnQ
    if (g === 0) return x
    if (g > 0) hi = x
    else lo = x
    // d ln I / d ln x = x·pdf/I, pdf = prefactor/(x(1 − x))
    const slope = cdf > 0 ? betaPrefactor(a, b, x) / ((1 - x) * cdf) : 0
    let next = slope > 0 && Number.isFinite(g) ? x * Math.exp(-g / slope) : Number.NaN
    if (!(next > lo && next < hi)) next = lo > 0 ? Math.sqrt(lo * hi) : hi / 2
    if (Math.abs(next - x) <= 1e-13 * x) return next
    x = next
  }
  return x
}

/**
 * Beta(a, b) quantile (inverse of `betaInc` in x): the x in [0, 1] with
 * I_x(a, b) = q. Bracketed Newton in ln x on the smaller tail (the upper half
 * uses x = 1 − betaPpf(1 − q, b, a)), relative accuracy ~1e-13.
 */
export function betaPpf(q: number, a: number, b: number): number {
  validateShape('betaPpf', a, b)
  assertNotNaN(q, 'betaPpf: q')
  if (!(q >= 0 && q <= 1)) {
    throw new NegentropyError('invalid_config', `betaPpf: q must be in [0, 1], got ${q}`)
  }
  if (q === 0 || q === 1) return q
  return q <= 0.5 ? betaQuantileLower(q, a, b) : 1 - betaQuantileLower(1 - q, b, a)
}
