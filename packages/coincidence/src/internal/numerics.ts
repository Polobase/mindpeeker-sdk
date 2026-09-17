/**
 * Numerical core: compensated sums, lnΓ, falling-factorial ratios in log
 * space, and two-sided Poisson tails. Zero-dependency ports of the same
 * standard algorithms `@mindpeeker/negentropy/numerics` uses (Lanczos,
 * Stirling series, ln(1+u) − u), reduced to what this package needs.
 */

/** Neumaier's (1974) compensated summation: O(ε) error over long accumulations. */
export class NeumaierSum {
  #sum = 0
  #compensation = 0

  add(x: number): void {
    const t = this.#sum + x
    if (Math.abs(this.#sum) >= Math.abs(x)) this.#compensation += this.#sum - t + x
    else this.#compensation += x - t + this.#sum
    this.#sum = t
  }

  get value(): number {
    return this.#sum + this.#compensation
  }
}

const LN_SQRT_2PI = 0.9189385332046727

// Lanczos g = 7, n = 9 (Godfrey coefficients, ~1e-15 relative error).
const LANCZOS_G = 7
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.3234287776531,
  -176.6150291621406, 12.507343278686905, -0.13857109526572012, 9.984369578019572e-6,
  1.5056327351493116e-7,
]

/** ln Γ(x) for finite x > 0 (reflection below ½). */
export function lnGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x)
  const xm1 = x - 1
  let a = LANCZOS[0] as number
  for (let i = 1; i < LANCZOS.length; i++) a += (LANCZOS[i] as number) / (xm1 + i)
  const t = xm1 + LANCZOS_G + 0.5
  return LN_SQRT_2PI + (xm1 + 0.5) * Math.log(t) - t + Math.log(a)
}

// Stirling-series coefficients B_2j / (2j(2j − 1)), j = 1…6.
const STIRLING = [1 / 12, -1 / 360, 1 / 1260, -1 / 1680, 1 / 1188, -691 / 360360]

/**
 * δ(x) = ln Γ(x + 1) − [(x + ½) ln x − x + ½ ln 2π], by its asymptotic
 * series; absolute error below 1e-17 for x ≥ 32 (the only range it is used in).
 */
export function stirlingCorrection(x: number): number {
  const inv = 1 / x
  const inv2 = inv * inv
  let sum = 0
  for (let j = STIRLING.length - 1; j >= 0; j--) sum = sum * inv2 + (STIRLING[j] as number)
  return sum * inv
}

/** ln(1 + u) − u without cancellation, for u > −1 (series for |u| < ½). */
export function log1pmx(u: number): number {
  if (Math.abs(u) >= 0.5) return Math.log1p(u) - u
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

/** ln n! for a non-negative integer n. */
export function lnFactorial(n: number): number {
  return n < 2 ? 0 : lnGamma(n + 1)
}

/** φ(x/c) = (x/c)·ln(x/c) − (x/c − 1) for x > 0, formed without cancellation near x = c. */
function phi(x: number, c: number): number {
  const u = (x - c) / c
  if (Math.abs(u) < 0.5) return u * Math.log1p(u) + log1pmx(u)
  const ratio = x / c
  return ratio * Math.log(ratio) - u
}

/** $1 - e^{x}$ for $x \le 0$ without cancellation (and never −0). */
export function oneMinusExp(x: number): number {
  return 0 - Math.expm1(x)
}

/**
 * Whether a probability computed as `ln P(no match)` reaches a target match
 * probability p. Above ½ the test is P(no match) ≤ 1 − p (exact in floating
 * point there), so targets near 1 are not lost to rounding of 1 − P.
 */
export function reachesTarget(lnNoMatch: number, p: number): boolean {
  return p > 0.5 ? lnNoMatch <= Math.log1p(-p) : oneMinusExp(lnNoMatch) >= p
}

/** Terms summed directly in {@link lnFallingOverPower}; longer products use Stirling. */
export const FALLING_LOOP_LIMIT = 2048
const STIRLING_MIN = 32

/**
 * $\ln \prod_{i=0}^{m-1} (a - i)/c$ for integers $a \ge 0$, $m \ge 0$ and
 * $c > 0$: $-\infty$ when a factor is zero ($m > a$).
 *
 * Up to {@link FALLING_LOOP_LIMIT} factors the logs are summed exactly
 * (compensated `log1p`). Beyond that it is $\ln\Gamma(a+1) - \ln\Gamma(b+1) - m\ln c$
 * with $b = a - m$, written as
 * $c\,\varphi(a/c) - c\,\varphi(b/c) - \tfrac12\ln(1 - m/a) + \delta(a) - \delta(b)$
 * so the large cancelling terms $a\ln a$ never meet in floating point.
 */
export function lnFallingOverPower(a: number, m: number, c: number): number {
  if (m === 0) return 0
  if (a - m + 1 <= 0) return Number.NEGATIVE_INFINITY
  if (m <= FALLING_LOOP_LIMIT) {
    const sum = new NeumaierSum()
    for (let i = 0; i < m; i++) sum.add(Math.log1p((a - i - c) / c))
    return sum.value
  }
  const b = a - m
  if (b >= STIRLING_MIN) {
    return (
      c * phi(a, c) -
      c * phi(b, c) +
      -0.5 * Math.log1p(-m / a) + // ½ ln(a/b) without rounding a/b
      stirlingCorrection(a) -
      stirlingCorrection(b)
    )
  }
  // ln Γ(a+1) − a ln c by Stirling (a ≥ m > 2048), ln Γ(b+1) − b ln c exactly.
  const head = (a + 0.5) * Math.log(a / c) + 0.5 * Math.log(c) - a + LN_SQRT_2PI
  return head + stirlingCorrection(a) - (lnFactorial(b) - b * Math.log(c))
}

/** Both tails of a Poisson law, each to full relative precision. */
export interface PoissonSplit {
  /** P(X < k) = P(X ≤ k − 1). */
  readonly below: number
  /** P(X ≥ k). */
  readonly atLeast: number
}

/** ln P(X = j) for X ~ Poisson(λ), λ > 0. */
export function poissonLogPmf(j: number, lambda: number): number {
  return -lambda + j * Math.log(lambda) - lnFactorial(j)
}

/**
 * P(X < k) and P(X ≥ k) for X ~ Poisson(λ), integer k ≥ 0, finite λ ≥ 0.
 * The smaller tail is summed term by term away from the mode (terms shrink
 * geometrically there); the larger one is its complement.
 */
export function poissonSplit(k: number, lambda: number): PoissonSplit {
  if (k <= 0) return { below: 0, atLeast: 1 }
  if (lambda === 0) return { below: 1, atLeast: 0 }
  if (k > lambda) {
    // upper tail: terms j ≥ k > λ shrink by λ/(j+1) < 1
    let term = Math.exp(poissonLogPmf(k, lambda))
    const sum = new NeumaierSum()
    for (let j = k; term > 0; j++) {
      sum.add(term)
      if (term < 1e-17 * sum.value) break
      term *= lambda / (j + 1)
    }
    const atLeast = Math.min(1, sum.value)
    return { below: 1 - atLeast, atLeast }
  }
  // lower tail: terms j ≤ k − 1 < λ shrink by j/λ < 1 going down
  let term = Math.exp(poissonLogPmf(k - 1, lambda))
  const sum = new NeumaierSum()
  for (let j = k - 1; j >= 0 && term > 0; j--) {
    sum.add(term)
    if (term < 1e-17 * sum.value) break
    term *= j / lambda
  }
  const below = Math.min(1, sum.value)
  return { below, atLeast: 1 - below }
}
