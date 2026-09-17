import { NegentropyError } from '../errors.js'
import { P_FLOOR } from './pvalues.js'

/**
 * Anytime-valid monitoring — shared pieces of the e-process family.
 *
 * A *test martingale* is a nonnegative process M₀ = 1, M₁, M₂, … whose
 * conditional expectation under H0 never increases. Ville's inequality
 * (Ville 1939) bounds its whole path:
 * $$P_{H_0}\big(\exists t:\ M_t \ge 1/\alpha\big) \le \alpha,$$
 * so a monitor that stops the first time M_t ≥ 1/α — after any number of
 * looks, at any data-dependent time — has type-I error ≤ α. The running
 * anytime p-value p_t = min(1, 1/max_{s≤t} M_s) is valid in the same sense:
 * P(∃t: p_t ≤ α) ≤ α (Shafer, Shen, Vereshchagin & Vovk 2011; Ramdas et al.
 * 2023, "Game-theoretic statistics and safe anytime-valid inference").
 *
 * The martingales here work on ln M_t so that long streams neither overflow
 * nor underflow; `netvarMartingale` (variance/netvar channel) and
 * `driftMartingale` (mean-shift/Stouffer channel) produce the paths, and the
 * helpers below turn a path into anytime p-values and a stopping index.
 */

/** 'two': alternatives on both sides of H0; 'upper': variance excess / positive drift only. */
export type EProcessSide = 'two' | 'upper'

/** Throw unless α is a finite level in (0, 1). */
export function validateAlpha(alpha: number, fn: string): void {
  if (typeof alpha !== 'number' || !(alpha > 0 && alpha < 1)) {
    throw new NegentropyError('invalid_config', `${fn}: alpha must be in (0, 1), got ${alpha}`)
  }
}

/** Throw unless `sided` is 'two' or 'upper'. */
export function validateSide(sided: unknown, fn: string): EProcessSide {
  if (sided !== 'two' && sided !== 'upper') {
    throw new NegentropyError(
      'invalid_config',
      `${fn}: sided must be 'two' or 'upper', got ${sided}`,
    )
  }
  return sided
}

/** Throw unless t is a finite number ≥ 0 (steps observed; real-valued effective counts allowed). */
export function validateTime(t: number, fn: string): void {
  if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) {
    throw new NegentropyError('invalid_config', `${fn}: t must be a finite number ≥ 0, got ${t}`)
  }
}

/** Throw unless `value` is finite and > 0. */
export function validatePositive(value: number, name: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || !(value > 0)) {
    throw new NegentropyError('invalid_config', `${name} must be a finite number > 0, got ${value}`)
  }
}

/**
 * Running anytime-valid p-values of a log test-martingale path:
 * p_t = min(1, exp(−max_{s≤t} ln M_s)), floored at `P_FLOOR` like every
 * public p-value. Non-increasing by construction. Under H0,
 * P(∃t: p_t ≤ α) ≤ α for every α — unlike a fixed-n p-value recomputed after
 * each look, which reaches any level eventually (law of the iterated
 * logarithm). `logM[t]` may be −∞ (M = 0) but not NaN (`invalid_config`).
 */
export function anytimeP(logM: ArrayLike<number>): Float64Array {
  const out = new Float64Array(logM.length)
  let best = Number.NEGATIVE_INFINITY
  for (let t = 0; t < logM.length; t++) {
    const value = logM[t] as number
    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw new NegentropyError(
        'invalid_config',
        `anytimeP: logM[${t}] must be a number, got ${value}`,
      )
    }
    if (value > best) best = value
    out[t] = Math.max(P_FLOOR, Math.min(1, Math.exp(-best)))
  }
  return out
}

/**
 * Ville stopping index: the first index t with ln M_t ≥ ln(1/α), or −1 if
 * the path never reaches the threshold. Index t is the martingale after t + 1
 * steps (the arrays of `netvarMartingale`/`driftMartingale` start after the
 * first step). Rejecting H0 at that index has type-I error ≤ α no matter
 * when the monitor was started or how often it was looked at — provided the
 * martingale, its prior and α were fixed before the data (pre-register them).
 */
export function villeCrossing(logM: ArrayLike<number>, alpha: number): number {
  validateAlpha(alpha, 'villeCrossing')
  const threshold = -Math.log(alpha)
  for (let t = 0; t < logM.length; t++) {
    const value = logM[t] as number
    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw new NegentropyError(
        'invalid_config',
        `villeCrossing: logM[${t}] must be a number, got ${value}`,
      )
    }
    if (value >= threshold) return t
  }
  return -1
}
