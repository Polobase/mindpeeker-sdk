import { NegentropyError } from '../errors.js'
import { KahanSum } from '../internal/kahan.js'
import { chi2Ppf } from '../internal/special.js'

/**
 * Cumulative deviation series D(t) = Σ_{s≤t} (Z(s)² − 1) — the classic GCP
 * plot. Flat under H0 (E[D] = 0, Var[D(t)] = 2t), drifting upward when
 * structure is present.
 */
export function cumulativeDeviation(stoufferZs: ArrayLike<number>): Float64Array {
  const out = new Float64Array(stoufferZs.length)
  const acc = new KahanSum()
  for (let t = 0; t < stoufferZs.length; t++) {
    const z = stoufferZs[t] as number
    acc.add(z * z - 1)
    out[t] = acc.value
  }
  return out
}

/**
 * Pointwise significance envelope for the cumulative-deviation plot: at step
 * t (1-based) the curve χ²ppf(1 − p, t) − t. IMPORTANT: this is a POINTWISE
 * p criterion. The probability that an H0 path crosses the envelope
 * *somewhere* in [1, T] is much larger than p — only a pre-registered
 * endpoint (or fixed time) carries the stated significance level.
 */
export function significanceEnvelope(steps: number, p = 0.05): Float64Array {
  if (!Number.isInteger(steps) || steps < 1) {
    throw new NegentropyError('invalid_config', `steps must be a positive integer, got ${steps}`)
  }
  if (!(p > 0 && p < 1)) {
    throw new NegentropyError('invalid_config', `envelope p must be in (0, 1), got ${p}`)
  }
  const out = new Float64Array(steps)
  for (let t = 1; t <= steps; t++) out[t - 1] = chi2Ppf(1 - p, t) - t
  return out
}
