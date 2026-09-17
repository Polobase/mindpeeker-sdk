import { NegentropyError } from '../errors.js'
import { assertFiniteArray } from '../internal/assert.js'
import { convexRoot } from '../internal/convex-root.js'
import { KahanSum } from '../internal/kahan.js'
import { halfSquarePlusLnPhi, normalHazardLower } from '../internal/log-tails.js'
import {
  type EProcessSide,
  validateAlpha,
  validatePositive,
  validateSide,
  validateTime,
} from './eprocess.js'

/**
 * Normal-mixture test martingale for a mean shift in a z stream (the
 * Stouffer walk, a single source's z's, or per-run Δz's).
 *
 * Model: z_t ~ N(μ, 1), H0 μ = 0. Mixing the likelihood ratio
 * exp(μS_t − μ²t/2), S_t = Σ z, over μ ~ N(0, 1/λ) gives Robbins' closed form
 * $$M_t = \sqrt{\frac{\lambda}{t+\lambda}}\,\exp\!\Big(\frac{S_t^2}{2(t+\lambda)}\Big),$$
 * and M_t ≥ 1/α is exactly |S_t| ≥ √((t+λ)·ln((t+λ)/(λα²))) — the
 * Robbins–Siegmund boundary (Robbins 1970; Howard, Ramdas, McAuliffe &
 * Sekhon 2021, normal-mixture boundary with ρ = λ). `sided: 'upper'` uses the
 * half-normal prior on μ ≥ 0:
 * M_t⁺ = 2·√(λ/(t+λ))·exp(S_t²/(2(t+λ)))·Φ(S_t/√(t+λ)).
 *
 * λ is the prior precision of the effect: small λ expects large effects early,
 * large λ small effects late. The boundary relative to √t is tightest at
 * t_opt ≈ 8.2·λ for α = 0.05 (s = t_opt/λ solves ln(1 + s) − s = ln α²) —
 * fix λ in the pre-registration, never after looking.
 *
 * Validity: exact martingale for Gaussian z; for z from independent fair-bit
 * trials under theoretical calibration it is a test supermartingale (the z's
 * are sub-Gaussian with variance proxy 1: E e^{μz − μ²/2} ≤ 1), so Ville's
 * inequality still holds for both sides.
 */

/** Prior precision λ of the mean shift and the side of the alternative. */
export interface NormalMixtureOptions {
  /** Prior precision λ > 0 of μ ~ N(0, 1/λ) (required — part of the pre-registration). */
  lambda: number
  /** 'two' (default): μ ≠ 0; 'upper': μ > 0 (half-normal prior). */
  sided?: EProcessSide
}

const LN2 = Math.LN2

function resolve(opts: NormalMixtureOptions, fn: string): { lambda: number; sided: EProcessSide } {
  if (typeof opts !== 'object' || opts === null) {
    throw new NegentropyError('invalid_config', `${fn}: options { lambda } are required`)
  }
  validatePositive(opts.lambda, `${fn}: lambda`)
  return { lambda: opts.lambda, sided: validateSide(opts.sided ?? 'two', fn) }
}

function lnValue(lambda: number, sided: EProcessSide, t: number, sum: number): number {
  const scale = t + lambda
  const base = -0.5 * Math.log1p(t / lambda)
  if (sided === 'two') return base + (sum * sum) / (2 * scale)
  return LN2 + base + halfSquarePlusLnPhi(sum / Math.sqrt(scale))
}

/**
 * ln M_t of the normal-mixture martingale from the step count t and the
 * running sum S_t = Σ z — the O(1) form for live monitors. ln M₀ = 0.
 */
export function driftLogM(t: number, sum: number, opts: NormalMixtureOptions): number {
  validateTime(t, 'driftLogM')
  if (typeof sum !== 'number' || !Number.isFinite(sum)) {
    throw new NegentropyError('invalid_config', `driftLogM: sum must be finite, got ${sum}`)
  }
  const { lambda, sided } = resolve(opts, 'driftLogM')
  return lnValue(lambda, sided, t, sum)
}

/**
 * Running log test martingale ln M_t (index t − 1 after t steps) of a z
 * stream against "mean 0". S_t is a compensated running sum. Every z must be
 * finite.
 */
export function driftMartingale(zs: ArrayLike<number>, opts: NormalMixtureOptions): Float64Array {
  const { lambda, sided } = resolve(opts, 'driftMartingale')
  assertFiniteArray(zs, 'driftMartingale: z')
  const out = new Float64Array(zs.length)
  const acc = new KahanSum()
  for (let i = 0; i < zs.length; i++) {
    acc.add(zs[i] as number)
    out[i] = lnValue(lambda, sided, i + 1, acc.value)
  }
  return out
}

/**
 * Time-uniform boundary for the running sum S_t = Σ z at step t.
 * Two-sided (default): the closed form √((t+λ)·ln((t+λ)/(λα²))); crossing
 * means |S_t| ≥ boundary, and P_H0(∃t: |S_t| ≥ boundary(t)) ≤ α. Upper: the
 * root of M_t⁺(S) = 1/α (monotone Newton, reported on the conservative side);
 * crossing means S_t ≥ boundary. For comparison, the pointwise parabola
 * 1.96·√t is crossed by almost every H0 path eventually.
 */
export function driftBoundary(
  t: number,
  alpha: number,
  lambda: number,
  sided: EProcessSide = 'two',
): number {
  validateTime(t, 'driftBoundary')
  validateAlpha(alpha, 'driftBoundary')
  validatePositive(lambda, 'driftBoundary: lambda')
  const side = validateSide(sided, 'driftBoundary')
  const scale = t + lambda
  const two = Math.sqrt(scale * (Math.log1p(t / lambda) - 2 * Math.log(alpha)))
  if (side === 'two') return two
  const threshold = -Math.log(alpha)
  const root = Math.sqrt(scale)
  const f = (s: number): number => lnValue(lambda, 'upper', t, s) - threshold
  // x²/2 + ln Φ(x) has derivative x + φ(x)/Φ(x)
  const df = (s: number): number => {
    const x = s / root
    return (x + normalHazardLower(x)) / root
  }
  // M⁺ ≥ M (two-sided) for S ≥ 0, so the two-sided boundary has f ≥ 0; M⁺(0) ≤ 1 < 1/α
  let pos = two
  for (let i = 0; f(pos) < 0 && i < 64; i++) pos *= 1 + 1e-12 * 2 ** i
  return convexRoot(f, df, pos, 0)
}
