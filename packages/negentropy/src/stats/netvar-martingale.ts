import { NegentropyError } from '../errors.js'
import { assertFiniteArray } from '../internal/assert.js'
import { convexRoot, expandToNonNegative } from '../internal/convex-root.js'
import { log1pmx } from '../internal/gamma.js'
import { KahanSum } from '../internal/kahan.js'
import { lnGammaP, lnGammaPrefactor, stirlingRemainder } from '../internal/log-tails.js'
import { lnGamma } from '../internal/special.js'
import {
  type EProcessSide,
  validateAlpha,
  validatePositive,
  validateSide,
  validateTime,
} from './eprocess.js'

/**
 * Gamma-mixture test martingale for the netvar / cumulative-deviation
 * channel.
 *
 * Model: per-step Stouffer Z's are N(0, 1/τ) — H0 is τ = 1. The likelihood
 * ratio of precision τ against 1 after t steps is
 * τ^{t/2} exp(−(τ − 1)·S_t/2) with S_t = Σ Z². Mixing τ over a Gamma(a, b)
 * prior (shape a, rate b) gives the closed form
 * $$\ln M_t = \tfrac{S_t}{2} + a\ln b - \ln\Gamma(a) + \ln\Gamma\!\big(a+\tfrac t2\big)
 *            - \big(a+\tfrac t2\big)\ln\!\big(b+\tfrac{S_t}{2}\big).$$
 * `sided: 'upper'` restricts the prior to τ < 1 (variance *excess* only — the
 * GCP hypothesis) and adds ln[P(a + t/2, b + S_t/2) / P(a, b)] (P the
 * regularized lower incomplete gamma).
 *
 * Numerics: with D_t = S_t − t (the cumulative deviation) and A = a + t/2,
 * u = (b − a + D_t/2)/A, the two-sided value is evaluated as
 * a ln b − lnΓ(a) − b + ½ ln 2π − ½ ln A + δ(A) − A·(ln(1+u) − u), δ the
 * Stirling remainder — no a·ln a-sized terms ever cancel, so the result is
 * accurate at any t.
 *
 * Validity. For exactly Gaussian Z the two-sided mixture is a martingale with
 * E[M_t] = 1. For Z from independent fair-bit trials under theoretical
 * calibration (Binomial(k, ½) sums; a Stouffer Z over sources is a Rademacher
 * sum too) the 'upper' variant is still an exact test supermartingale: such Z
 * is sub-Gaussian with variance proxy 1, so E[τ^{1/2} e^{(1−τ)Z²/2}] ≤ 1 for
 * every τ ≤ 1 and Ville's inequality holds. The two-sided variant also mixes
 * over τ > 1, where lattice trials are *not* dominated by the Gaussian (the
 * atom at Z = 0 for even k); there it is the de Moivre–Laplace approximation.
 * Empirical calibration, drifting hardware or serial dependence void both.
 */

/** Gamma prior on the precision τ = 1/Var(Z) and the side of the alternative. */
export interface GammaMixtureOptions {
  /** Prior shape a > 0. Default 1. */
  a?: number
  /** Prior rate b > 0. Default 1 (prior mean a/b = 1, the H0 precision). */
  b?: number
  /** 'two' (default): variance excess or deficit; 'upper': excess only (τ < 1). */
  sided?: EProcessSide
}

/** Time-uniform boundary for the cumulative deviation D_t = Σ(Z² − 1) at one t. */
export interface DeviationBoundary {
  /** Smallest D with M_t(D) ≥ 1/α on the excess side. */
  upper: number
  /** Largest D with M_t(D) ≥ 1/α on the deficit side; −∞ when unreachable (always for 'upper'). */
  lower: number
}

/** The upper and lower boundary curves, index t − 1 for step t. */
export interface DeviationEnvelope {
  upper: Float64Array
  lower: Float64Array
}

interface Resolved {
  a: number
  b: number
  sided: EProcessSide
  /** a ln b − lnΓ(a) − b + ½ ln 2π */
  c0: number
  /** ln P(a, b), the truncation mass of the 'upper' prior */
  lnPab: number
}

function resolve(opts: GammaMixtureOptions, fn: string): Resolved {
  const a = opts.a ?? 1
  const b = opts.b ?? 1
  validatePositive(a, `${fn}: a`)
  validatePositive(b, `${fn}: b`)
  const sided = validateSide(opts.sided ?? 'two', fn)
  const c0 = a * Math.log(b) - lnGamma(a) - b + 0.9189385332046727
  const lnPab = sided === 'upper' ? lnGammaP(a, b) : 0
  return { a, b, sided, c0, lnPab }
}

/**
 * ln M_t from D = S − t and S = ΣZ² (both passed: D carries the precision of
 * u = (X − A)/A near 0, S the precision of X = b + S/2 when S ≪ t, where
 * ln(1 + u) is ill-conditioned in u).
 */
function lnTwoSided(r: Resolved, t: number, deviation: number, sumSquares: number): number {
  const A = r.a + t / 2
  const u = (r.b - r.a + deviation / 2) / A
  const X = r.b + sumSquares / 2
  const core = u > -0.5 ? A * log1pmx(u) : A * Math.log(X / A) - (X - A)
  return r.c0 - 0.5 * Math.log(A) + stirlingRemainder(A) - core
}

function lnValue(r: Resolved, t: number, deviation: number, sumSquares: number): number {
  const two = lnTwoSided(r, t, deviation, sumSquares)
  if (r.sided === 'two') return two
  return two + lnGammaP(r.a + t / 2, r.b + sumSquares / 2) - r.lnPab
}

/** d ln M_t / dD (convex in D, so this is monotone). */
function lnSlope(r: Resolved, t: number, deviation: number): number {
  const A = r.a + t / 2
  const X = r.b + Math.max(0, t + deviation) / 2
  const two = (0.5 * (X - A)) / X
  if (r.sided === 'two') return two
  return two + 0.5 * Math.exp(lnGammaPrefactor(A, X) - Math.log(X) - lnGammaP(A, X))
}

/** ln M_t from D alone (S = t + D): the point form and the boundary search. */
function lnFromDeviation(r: Resolved, t: number, deviation: number): number {
  return lnValue(r, t, deviation, Math.max(0, t + deviation))
}

function checkDeviation(t: number, deviation: number, fn: string): void {
  if (typeof deviation !== 'number' || !Number.isFinite(deviation)) {
    throw new NegentropyError('invalid_config', `${fn}: deviation must be finite, got ${deviation}`)
  }
  // D = S − t with S = ΣZ² ≥ 0; allow rounding of a compensated sum
  if (t + deviation < -1e-9 * Math.max(1, t)) {
    throw new NegentropyError(
      'invalid_config',
      `${fn}: deviation ${deviation} is below −t = ${-t} (ΣZ² cannot be negative)`,
    )
  }
}

/**
 * ln M_t of the Gamma-mixture martingale at one point, from the step count t
 * and the cumulative deviation D_t = Σ(Z² − 1) (what `cumulativeDeviation`
 * plots) — the O(1) form for live monitors that keep t and D_t running.
 * ln M₀ = 0.
 */
export function netvarLogM(t: number, deviation: number, opts: GammaMixtureOptions = {}): number {
  validateTime(t, 'netvarLogM')
  checkDeviation(t, deviation, 'netvarLogM')
  const r = resolve(opts, 'netvarLogM')
  return lnFromDeviation(r, t, Math.max(deviation, -t))
}

/**
 * Running log test martingale ln M_t (index t − 1 after t steps) of a
 * per-step Stouffer Z stream against "Var Z = 1". Feed it to `anytimeP` or
 * `villeCrossing`; D_t is accumulated exactly like `cumulativeDeviation`
 * (compensated summation), so `netvarMartingale(z)[t]` equals
 * `netvarLogM(t + 1, cumulativeDeviation(z)[t])` — bit for bit unless
 * ΣZ² < t/2, where ΣZ² is summed directly for accuracy. Every Z must be
 * finite.
 */
export function netvarMartingale(
  stoufferZs: ArrayLike<number>,
  opts: GammaMixtureOptions = {},
): Float64Array {
  const r = resolve(opts, 'netvarMartingale')
  assertFiniteArray(stoufferZs, 'netvarMartingale: z')
  const out = new Float64Array(stoufferZs.length)
  const deviation = new KahanSum()
  const squares = new KahanSum()
  for (let i = 0; i < stoufferZs.length; i++) {
    const z = stoufferZs[i] as number
    deviation.add(z * z - 1)
    squares.add(z * z)
    const t = i + 1
    const d = Math.max(deviation.value, -t)
    // S = t + D is exact enough unless ΣZ² ≪ t; then use the directly summed S
    const s = t + d < t / 2 ? squares.value : Math.max(0, t + d)
    out[i] = lnValue(r, t, d, s)
  }
  return out
}

/**
 * Boundary roots at step t. `guess` (optional) is a warm start for the upper
 * root — used only if f(guess) ≥ 0, so it can never bias the result.
 */
function boundaryAt(r: Resolved, t: number, alpha: number, guess?: number): DeviationBoundary {
  const threshold = -Math.log(alpha)
  const f = (d: number): number => lnFromDeviation(r, t, d) - threshold
  const df = (d: number): number => lnSlope(r, t, d)
  const floor = -t
  const step = Math.max(1, Math.sqrt(2 * t))
  // 'upper' increases in D and M_t(−t) = E[τ^{t/2} | τ < 1] ≤ 1 < 1/α; two-sided is
  // convex with its minimum (where M ≤ 1, since E_H0[M_t] = 1) at D* = 2(a − b)
  const dStar = r.sided === 'upper' ? floor : Math.max(floor, 2 * (r.a - r.b))
  const upperPos =
    guess !== undefined && guess > dStar && f(guess) >= 0
      ? guess
      : expandToNonNegative(f, Math.max(dStar, 0), step, 1)
  const upper = convexRoot(f, df, upperPos, dStar)
  let lower = Number.NEGATIVE_INFINITY
  if (r.sided === 'two' && dStar > floor && f(floor) >= 0) lower = convexRoot(f, df, floor, dStar)
  return { upper, lower }
}

/**
 * Time-uniform boundary for the cumulative deviation D_t at step t: D_t ≥
 * `upper` (or ≤ `lower`) is exactly M_t ≥ 1/α, so by Ville's inequality an H0
 * path touches the boundary *anywhere* with probability ≤ α — the property the
 * pointwise `significanceEnvelope` lacks. Roots are found in log space by
 * monotone Newton and always reported on the conservative side. Reference
 * values (α = 0.05, a = b = 1, two-sided): upper 19.498 at t = 10, 52.308 at
 * t = 100, 165.798 at t = 1000 (pointwise χ² envelope at t = 1000: 74.68).
 */
export function netvarBoundary(
  t: number,
  alpha: number,
  opts: GammaMixtureOptions = {},
): DeviationBoundary {
  validateTime(t, 'netvarBoundary')
  validateAlpha(alpha, 'netvarBoundary')
  return boundaryAt(resolve(opts, 'netvarBoundary'), t, alpha)
}

/**
 * The time-uniform envelope for a whole cumulative-deviation plot: `upper[t−1]`
 * and `lower[t−1]` from `netvarBoundary(t, α, opts)` for t = 1 … steps. Draw it
 * beside `cumulativeDeviation` instead of (or with) the pointwise
 * `significanceEnvelope`: watching this band continuously is not an
 * optional-stopping machine.
 */
export function anytimeEnvelope(
  steps: number,
  alpha = 0.05,
  opts: GammaMixtureOptions = {},
): DeviationEnvelope {
  if (!Number.isInteger(steps) || steps < 1) {
    throw new NegentropyError(
      'invalid_config',
      `anytimeEnvelope: steps must be a positive integer, got ${steps}`,
    )
  }
  validateAlpha(alpha, 'anytimeEnvelope')
  const r = resolve(opts, 'anytimeEnvelope')
  const upper = new Float64Array(steps)
  const lower = new Float64Array(steps)
  let previous = Number.NaN
  let beforePrevious = Number.NaN
  for (let t = 1; t <= steps; t++) {
    // the upper root grows smoothly in t: extrapolate a warm start (checked, never trusted)
    const growth = previous - beforePrevious
    const guess =
      t > 2
        ? previous + 2 * Math.max(growth, 0) + 1e-9 * Math.max(1, Math.abs(previous))
        : undefined
    const boundary = boundaryAt(r, t, alpha, guess)
    upper[t - 1] = boundary.upper
    lower[t - 1] = boundary.lower
    beforePrevious = previous
    previous = boundary.upper
  }
  return { upper, lower }
}
