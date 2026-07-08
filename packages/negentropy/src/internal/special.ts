/**
 * Special-functions core. Everything downstream (p-values, envelopes, probit
 * mapping) keys off these. Accuracy target: relative error ≤ 1e-12 for the
 * incomplete gamma over df up to ~10^4 — tail p-values must be trustworthy,
 * which rules out the Abramowitz–Stegun/Wilson–Hilferty shortcuts used for
 * coarse pass/fail elsewhere in the SDK.
 */

const EPS = 1e-15
const FPMIN = 1e-300
const MAX_ITER = 10_000
const LN_SQRT_2PI = 0.9189385332046727 // ln(√(2π))

// Lanczos g=7, n=9 (Godfrey coefficients — ~1e-15 relative error)
const LANCZOS_G = 7
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.3234287776531,
  -176.6150291621406, 12.507343278686905, -0.13857109526572012, 9.984369578019572e-6,
  1.5056327351493116e-7,
]

/** Natural log of the gamma function. Domain: x > 0 (reflection handles (0, 0.5)). */
export function lnGamma(x: number): number {
  if (!Number.isFinite(x) || x <= 0) throw new RangeError(`lnGamma: x must be > 0, got ${x}`)
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x)
  const xm1 = x - 1
  let a = LANCZOS[0] as number
  for (let i = 1; i < LANCZOS.length; i++) a += (LANCZOS[i] as number) / (xm1 + i)
  const t = xm1 + LANCZOS_G + 0.5
  return LN_SQRT_2PI + (xm1 + 0.5) * Math.log(t) - t + Math.log(a)
}

/** exp(−x + a·ln x − lnΓ(a)) — the prefactor shared by both gamma branches. */
function gammaPrefactor(a: number, x: number): number {
  return Math.exp(-x + a * Math.log(x) - lnGamma(a))
}

/** Series expansion for P(a, x), valid (fast) for x < a + 1. */
function gammaPSeries(a: number, x: number): number {
  let ap = a
  let del = 1 / a
  let sum = del
  for (let i = 0; i < MAX_ITER; i++) {
    ap += 1
    del *= x / ap
    sum += del
    if (Math.abs(del) < Math.abs(sum) * EPS) return sum * gammaPrefactor(a, x)
  }
  throw new Error(`gammaP: series did not converge for a=${a}, x=${x}`)
}

/** Lentz modified continued fraction for Q(a, x), valid (fast) for x ≥ a + 1. */
function gammaQContinuedFraction(a: number, x: number): number {
  let b = x + 1 - a
  let c = 1 / FPMIN
  let d = 1 / b
  let h = d
  for (let i = 1; i <= MAX_ITER; i++) {
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
  throw new Error(`gammaQ: continued fraction did not converge for a=${a}, x=${x}`)
}

/** Regularized lower incomplete gamma P(a, x) = γ(a, x)/Γ(a). */
export function gammaP(a: number, x: number): number {
  if (!(a > 0) || !(x >= 0)) throw new RangeError(`gammaP: need a > 0, x ≥ 0; got a=${a}, x=${x}`)
  if (x === 0) return 0
  return x < a + 1 ? gammaPSeries(a, x) : 1 - gammaQContinuedFraction(a, x)
}

/** Regularized upper incomplete gamma Q(a, x) = 1 − P(a, x). */
export function gammaQ(a: number, x: number): number {
  if (!(a > 0) || !(x >= 0)) throw new RangeError(`gammaQ: need a > 0, x ≥ 0; got a=${a}, x=${x}`)
  if (x === 0) return 1
  return x < a + 1 ? 1 - gammaPSeries(a, x) : gammaQContinuedFraction(a, x)
}

/** Complementary error function, via erfc(x) = Q(½, x²) — accurate deep into the tail. */
export function erfc(x: number): number {
  if (x < 0) return 2 - erfc(-x)
  if (x === 0) return 1
  return gammaQ(0.5, x * x)
}

/** Standard normal CDF Φ(z). */
export function normCdf(z: number): number {
  return 0.5 * erfc(-z / Math.SQRT2)
}

/** Standard normal survival function 1 − Φ(z), accurate for large z. */
export function normSf(z: number): number {
  return 0.5 * erfc(z / Math.SQRT2)
}

/**
 * Inverse standard normal CDF (probit). Wichura's algorithm AS 241 (PPND16),
 * ~1e-15 relative accuracy — the algorithm behind R's qnorm.
 */
export function normPpf(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError(`normPpf: p must be in (0, 1), got ${p}`)
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

/** Chi-square survival function P(X > x) for df k. */
export function chi2Sf(x: number, k: number): number {
  if (!(k > 0)) throw new RangeError(`chi2Sf: df must be > 0, got ${k}`)
  if (x <= 0) return 1
  return gammaQ(k / 2, x / 2)
}

/** Chi-square CDF P(X ≤ x) for df k. */
export function chi2Cdf(x: number, k: number): number {
  if (!(k > 0)) throw new RangeError(`chi2Cdf: df must be > 0, got ${k}`)
  if (x <= 0) return 0
  return gammaP(k / 2, x / 2)
}

/** Chi-square density, computed in log space to survive large df. */
function chi2Pdf(x: number, k: number): number {
  if (x <= 0) return 0
  return Math.exp((k / 2 - 1) * Math.log(x / 2) - x / 2 - lnGamma(k / 2)) / 2
}

/**
 * Chi-square quantile (inverse CDF): the x with P(X ≤ x) = p. Newton's method
 * on ln(CDF) — which stays quadratically convergent on the exponentially
 * decaying tail where plain-space Newton overshoots and crawls — seeded with
 * Wilson–Hilferty and safeguarded by a maintained bisection bracket.
 */
export function chi2Ppf(p: number, k: number): number {
  if (!(k > 0)) throw new RangeError(`chi2Ppf: df must be > 0, got ${k}`)
  if (!(p > 0 && p < 1)) throw new RangeError(`chi2Ppf: p must be in (0, 1), got ${p}`)
  // Wilson–Hilferty seed: k(1 − 2/(9k) + z√(2/(9k)))³
  const z = normPpf(p)
  const h = 2 / (9 * k)
  const cube = 1 - h + z * Math.sqrt(h)
  let x = cube > 0 ? k * cube ** 3 : k / 2
  const lnP = Math.log(p)
  // establish a bracket [lo, hi] with cdf(lo) < p < cdf(hi)
  let lo = 0
  let hi = Math.max(2 * x, k + 10)
  while (chi2Cdf(hi, k) < p) {
    lo = hi
    hi *= 2
    if (hi > 1e308) throw new Error(`chi2Ppf: bracket overflow for p=${p}, k=${k}`)
  }
  if (x <= lo || x >= hi) x = (lo + hi) / 2
  for (let i = 0; i < 200; i++) {
    const cdf = chi2Cdf(x, k)
    if (cdf > p) hi = x
    else lo = x
    const pdf = chi2Pdf(x, k)
    // Newton on g(x) = ln(cdf) − ln(p), with g' = pdf/cdf
    let next = cdf > 0 && pdf > 0 ? x - ((Math.log(cdf) - lnP) * cdf) / pdf : Number.NaN
    if (!(next > lo && next < hi)) next = (lo + hi) / 2 // Newton left the bracket → bisect
    const dx = Math.abs(next - x)
    x = next
    if (dx < 1e-13 * Math.max(1, x)) break
  }
  return x
}
