/**
 * Special-functions core: the normal and chi-square layer over the gamma
 * family in `gamma.ts` (re-exported here). Accuracy target: ~1e-13 relative
 * error for tail probabilities at any df, and relative (not absolute)
 * convergence for quantiles so lower-tail quantiles far below 1 stay exact.
 * Tail p-values must be trustworthy, which rules out the
 * Abramowitz–Stegun/Wilson–Hilferty shortcuts used for coarse pass/fail
 * elsewhere in the SDK.
 *
 * Domain errors throw `NegentropyError('invalid_config')` (NaN never passes
 * silently); a failed iteration throws `NegentropyError('numerical')`.
 * Infinite arguments return their exact limits.
 */
import { NegentropyError } from '../errors.js'
import { assertNotNaN } from './assert.js'
import { erfc, gammaP, gammaPrefactor, gammaQ, lnGamma } from './gamma.js'

export { erfc, gammaP, gammaQ, lnGamma } from './gamma.js'

/** Standard normal CDF Φ(z); Φ(−∞) = 0, Φ(∞) = 1. */
export function normCdf(z: number): number {
  return 0.5 * erfc(-z / Math.SQRT2)
}

/** Standard normal survival function 1 − Φ(z), accurate for large z; exact limits at ±∞. */
export function normSf(z: number): number {
  return 0.5 * erfc(z / Math.SQRT2)
}

/**
 * Inverse standard normal CDF (probit). Wichura's algorithm AS 241 (PPND16),
 * ~1e-15 relative accuracy — the algorithm behind R's qnorm.
 */
export function normPpf(p: number): number {
  assertNotNaN(p, 'normPpf: p')
  if (!(p > 0 && p < 1)) {
    throw new NegentropyError('invalid_config', `normPpf: p must be in (0, 1), got ${p}`)
  }
  const q = p - 0.5
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q
    return (
      (q *
        (((((((2509.0809287301227 * r + 33430.57558358813) * r + 67265.7709270087) * r +
          45921.95393154987) *
          r +
          13731.69376550946) *
          r +
          1971.5909503065513) *
          r +
          133.14166789178438) *
          r +
          3.3871328727963665)) /
      (((((((5226.495278852545 * r + 28729.085735721943) * r + 39307.89580009271) * r +
        21213.794301586597) *
        r +
        5394.196021424751) *
        r +
        687.1870074920579) *
        r +
        42.31333070160091) *
        r +
        1)
    )
  }
  let r = q < 0 ? p : 1 - p
  r = Math.sqrt(-Math.log(r))
  let value: number
  if (r <= 5) {
    r -= 1.6
    value =
      (((((((0.0007745450142783414 * r + 0.022723844989269184) * r + 0.2417807251774506) * r +
        1.2704582524523684) *
        r +
        3.6478483247632045) *
        r +
        5.769497221460691) *
        r +
        4.630337846156546) *
        r +
        1.4234371107496835) /
      (((((((1.0507500716444169e-9 * r + 0.0005475938084995345) * r + 0.015198666563616457) * r +
        0.14810397642748008) *
        r +
        0.6897673349851) *
        r +
        1.6763848301838038) *
        r +
        2.053191626637759) *
        r +
        1)
  } else {
    r -= 5
    value =
      (((((((2.0103343992922881e-7 * r + 0.000027115555687434876) * r + 0.0012426609473880784) * r +
        0.026532189526576124) *
        r +
        0.29656057182850487) *
        r +
        1.7848265399172913) *
        r +
        5.463784911164114) *
        r +
        6.657904643501103) /
      (((((((2.0442631033899397e-15 * r + 1.421511758316446e-7) * r + 0.000018463183175100548) * r +
        0.0007868691311456133) *
        r +
        0.014875361290850615) *
        r +
        0.1369298809227358) *
        r +
        0.599832206555888) *
        r +
        1)
  }
  return q < 0 ? -value : value
}

function validateDf(fn: string, k: number): void {
  assertNotNaN(k, `${fn}: df`)
  if (!(k > 0) || k === Number.POSITIVE_INFINITY) {
    throw new NegentropyError('invalid_config', `${fn}: df must be finite and > 0, got ${k}`)
  }
}

/** Chi-square survival function P(X > x) for df k; 1 for x ≤ 0, 0 at x = ∞. */
export function chi2Sf(x: number, k: number): number {
  validateDf('chi2Sf', k)
  assertNotNaN(x, 'chi2Sf: x')
  if (x <= 0) return 1
  return gammaQ(k / 2, x / 2)
}

/** Chi-square CDF P(X ≤ x) for df k; 0 for x ≤ 0, 1 at x = ∞. */
export function chi2Cdf(x: number, k: number): number {
  validateDf('chi2Cdf', k)
  assertNotNaN(x, 'chi2Cdf: x')
  if (x <= 0) return 0
  return gammaP(k / 2, x / 2)
}

/** Chi-square density for finite x > 0, via the cancellation-free gamma prefactor. */
function chi2Pdf(x: number, k: number): number {
  return gammaPrefactor(k / 2, x / 2) / x
}

/**
 * Chi-square quantile core. `lower` says which tail `prob` refers to: find x
 * with CDF(x) = prob (lower) or SF(x) = prob (upper). Newton's method runs in
 * u = ln x on G(u) = ±(ln tail(eᵘ) − ln prob), increasing in u with slope
 * x·pdf(x)/tail(x) — well-conditioned deep in either tail, where plain-space
 * Newton overshoots or crawls. Seeds: Wilson–Hilferty, plus the small-x
 * asymptote CDF(x) ≈ (x/2)^{k/2}/Γ(k/2 + 1) in the lower tail (whichever lands
 * closer). A maintained bracket falls back to geometric bisection; iteration
 * stops on a relative step of 1e-13.
 */
function chi2Quantile(prob: number, k: number, lower: boolean): number {
  const lnProb = Math.log(prob)
  const tail = (x: number): number => (lower ? chi2Cdf(x, k) : chi2Sf(x, k))
  const objective = (x: number): number => {
    const diff = Math.log(tail(x)) - lnProb
    return lower ? diff : -diff
  }

  const z = lower ? normPpf(prob) : -normPpf(prob)
  const h = 2 / (9 * k)
  const cube = 1 - h + z * Math.sqrt(h)
  const seeds = [cube > 0 ? k * cube ** 3 : k / 2]
  if (lower) seeds.push(2 * Math.exp((lnProb + lnGamma(k / 2 + 1)) / (k / 2)))
  let x = k
  let best = Number.POSITIVE_INFINITY
  for (const seed of seeds) {
    if (!(seed > 0 && Number.isFinite(seed))) continue
    const size = Math.abs(objective(seed))
    if (size < best) {
      best = size
      x = seed
    }
  }

  // bracket [lo, hi] with objective(lo) ≤ 0 ≤ objective(hi)
  let lo = 0
  let hi = Number.POSITIVE_INFINITY
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
    for (let next = 2 * x; hi === Number.POSITIVE_INFINITY; next *= 2) {
      if (next > Number.MAX_VALUE / 4) {
        throw new NegentropyError('numerical', `chi2 quantile: no bracket for p=${prob}, k=${k}`)
      }
      if (objective(next) > 0) hi = next
      else lo = next
    }
    x = lo
  }

  for (let i = 0; i < 300; i++) {
    const t = tail(x)
    const g = lower ? Math.log(t) - lnProb : lnProb - Math.log(t)
    if (g === 0) return x
    if (g > 0) hi = x
    else lo = x
    const slope = t > 0 ? (x * chi2Pdf(x, k)) / t : 0
    let next = slope > 0 && Number.isFinite(g) ? x * Math.exp(-g / slope) : Number.NaN
    if (!(next > lo && next < hi)) next = lo > 0 ? Math.sqrt(lo * hi) : hi / 2
    if (Math.abs(next - x) <= 1e-13 * x) return next
    x = next
  }
  return x
}

/**
 * Chi-square quantile (inverse CDF): the x with P(X ≤ x) = p, for p in (0, 1)
 * and finite df k > 0. Relative accuracy ~1e-13 in both tails — e.g.
 * chi2Ppf(1e-12, 1) = 1.5708e-24 (= (π/2)·p² to leading order).
 */
export function chi2Ppf(p: number, k: number): number {
  validateDf('chi2Ppf', k)
  assertNotNaN(p, 'chi2Ppf: p')
  if (!(p > 0 && p < 1)) {
    throw new NegentropyError('invalid_config', `chi2Ppf: p must be in (0, 1), got ${p}`)
  }
  return p <= 0.5 ? chi2Quantile(p, k, true) : chi2Quantile(1 - p, k, false)
}

/**
 * Chi-square inverse survival function: the x with P(X > x) = q. Unlike
 * chi2Ppf(1 − q, k) it keeps full precision for q below 2⁻⁵³, where 1 − q
 * rounds to 1. Internal (used by `significanceEnvelope`).
 */
export function chi2Isf(q: number, k: number): number {
  validateDf('chi2Isf', k)
  assertNotNaN(q, 'chi2Isf: q')
  if (!(q > 0 && q < 1)) {
    throw new NegentropyError('invalid_config', `chi2Isf: q must be in (0, 1), got ${q}`)
  }
  return q < 0.5 ? chi2Quantile(q, k, false) : chi2Quantile(1 - q, k, true)
}
