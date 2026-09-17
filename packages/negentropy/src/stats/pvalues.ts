import { NegentropyError } from '../errors.js'
import { assertFinite } from '../internal/assert.js'
import { chi2Sf, normCdf, normSf } from '../internal/special.js'

/**
 * Floor applied to every public p-value so downstream probit conversion
 * (composites) never sees an exact zero.
 */
export const P_FLOOR = 1e-300

export type Tail = 'two' | 'upper' | 'lower'

/**
 * p-value of a standard-normal statistic. Default two-sided. `z` must be
 * finite — NaN or ±Infinity (e.g. from a zero-sd calibration) throws
 * `invalid_config` instead of leaking into the p-value.
 */
export function normalP(z: number, tail: Tail = 'two'): number {
  assertFinite(z, 'normalP: z')
  if (tail !== 'two' && tail !== 'upper' && tail !== 'lower') {
    throw new NegentropyError(
      'invalid_config',
      `normalP: tail must be two|upper|lower, got ${tail}`,
    )
  }
  const upper = normSf(z)
  const lower = normCdf(z)
  const p =
    tail === 'upper' ? upper : tail === 'lower' ? lower : Math.min(1, 2 * Math.min(upper, lower))
  return Math.max(p, P_FLOOR)
}

/**
 * Upper-tail p-value of a chi-square statistic (the GCP convention: variance
 * excess). Exact incomplete-gamma tail at any df (O(1) cost even at GCP network
 * scale, df ≫ 10⁶). The statistic must be finite and df finite and > 0, else
 * `invalid_config`.
 */
export function chiSquareP(statistic: number, df: number): number {
  assertFinite(statistic, 'chiSquareP: statistic')
  assertFinite(df, 'chiSquareP: df')
  if (!(df > 0)) {
    throw new NegentropyError('invalid_config', `chiSquareP: df must be > 0, got ${df}`)
  }
  return Math.max(chi2Sf(statistic, df), P_FLOOR)
}
