import { chi2Sf, normCdf, normSf } from '../internal/special.js'

/**
 * Floor applied to every public p-value so downstream probit conversion
 * (composites) never sees an exact zero.
 */
export const P_FLOOR = 1e-300

export type Tail = 'two' | 'upper' | 'lower'

/** p-value of a standard-normal statistic. Default two-sided. */
export function normalP(z: number, tail: Tail = 'two'): number {
  const upper = normSf(z)
  const lower = normCdf(z)
  const p =
    tail === 'upper' ? upper : tail === 'lower' ? lower : Math.min(1, 2 * Math.min(upper, lower))
  return Math.max(p, P_FLOOR)
}

/** Upper-tail p-value of a chi-square statistic (the GCP convention: variance excess). */
export function chiSquareP(statistic: number, df: number): number {
  return Math.max(chi2Sf(statistic, df), P_FLOOR)
}
