import { normCdf, normSf } from '@mindpeeker/negentropy/numerics'
import { FieldError } from '../errors.js'
import { checkOptions } from '../internal/validate.js'
import {
  type FieldRegion,
  type Point,
  regionArea,
  regionPerimeter,
  validatePoints,
  validateRegion,
} from '../types.js'
import { ripleyK } from './ripley.js'

/** Clark–Evans nearest-neighbour result. R < 1 clustered, ≈ 1 CSR, > 1 dispersed. */
export interface ClarkEvans {
  /** Aggregation index R = r̄_obs / r̄_exp. */
  readonly R: number
  /** Standard-normal deviate $(\bar r_{obs} - \bar r_{exp})/SE$. */
  readonly z: number
  /** Two-sided normal p for z (floored at 1e-300, as negentropy's `normalP`). */
  readonly pValue: number
  readonly meanNearest: number
  /** $\bar r_{exp}$: $1/(2\sqrt\lambda)$, plus Donnelly's boundary term when corrected. */
  readonly expectedNearest: number
  /** Edge correction applied to `expectedNearest`. */
  readonly correction: 'none' | 'donnelly'
}

export interface ClarkEvansOptions {
  /**
   * `'none'` (default, 0.1 behaviour) or `'donnelly'`: Donnelly's (1978)
   * boundary-corrected expectation for rectangles,
   * $\bar r_{exp} = \tfrac{1}{2\sqrt\lambda} + \big(0.0514 + 0.0412/\sqrt n\big)P/n$
   * (spatstat `clarkevans(correction = "Donnelly")`; rect regions only).
   */
  correction?: 'none' | 'donnelly'
}

/**
 * Clark & Evans (1954) nearest-neighbour test of complete spatial randomness.
 * $$\bar r_{\text{exp}} = \frac{1}{2\sqrt\lambda},\quad \lambda = n/A,\quad
 *   z = \frac{\bar r_{\text{obs}} - \bar r_{\text{exp}}}{SE},\quad
 *   SE = \sqrt{\frac{(4-\pi)A}{4\pi}}\Big/n \approx 0.26136\sqrt{A}/n.$$
 * R = r̄_obs/r̄_exp is < 1 for clustering, > 1 for dispersion. Uncorrected,
 * boundary points have no neighbours outside the region, which inflates
 * r̄_obs and biases z toward dispersion; `correction: 'donnelly'` removes most
 * of that bias for rectangles (same SE, as in spatstat's `clarkevans.test`).
 * For an exact decision compare to a Monte-Carlo null (e.g. `csrEnvelope`).
 *
 * @throws FieldError `insufficient_data` (< 2 points), `invalid_config` (bad
 *   region, points outside it, Donnelly on a disk, bad options)
 */
export function clarkEvans(
  points: readonly Point[],
  region: FieldRegion,
  opts: ClarkEvansOptions = {},
): ClarkEvans {
  validateRegion(region)
  validatePoints(points, region, 2)
  checkOptions(opts, 'clarkEvans')
  const correction = opts.correction ?? 'none'
  if (correction !== 'none' && correction !== 'donnelly') {
    throw new FieldError('invalid_config', `correction must be 'none' or 'donnelly'`)
  }
  if (correction === 'donnelly' && region.kind !== 'rect') {
    throw new FieldError('invalid_config', 'the Donnelly correction is defined for rect regions')
  }
  const n = points.length
  let sum = 0
  for (let i = 0; i < n; i++) {
    const pi = points[i] as Point
    let best = Number.POSITIVE_INFINITY
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      const pj = points[j] as Point
      const dx = pi.x - pj.x
      const dy = pi.y - pj.y
      const d2 = dx * dx + dy * dy
      if (d2 < best) best = d2
    }
    sum += Math.sqrt(best)
  }
  const meanNearest = sum / n
  const area = regionArea(region)
  const lambda = n / area
  let expectedNearest = 1 / (2 * Math.sqrt(lambda))
  if (correction === 'donnelly') {
    expectedNearest += ((0.0514 + 0.0412 / Math.sqrt(n)) * regionPerimeter(region)) / n
  }
  const sd = 0.26136 / Math.sqrt(n * lambda)
  const z = (meanNearest - expectedNearest) / sd
  return {
    R: meanNearest / expectedNearest,
    z,
    pValue: Math.max(1e-300, Math.min(1, 2 * Math.min(normSf(z), normCdf(z)))),
    meanNearest,
    expectedNearest,
    correction,
  }
}

/**
 * Besag's centered L-function L(r) − r of the pattern, evaluated at each radius,
 * with 0.1's estimator: no edge correction and the $A/n^2$ normalisation,
 * $K(r) = \frac{A}{n^2}\sum_{i\ne j} \mathbf 1[d_{ij} \le r]$,
 * $L(r) = \sqrt{K(r)/\pi}$. Under CSR it is ≈ 0 near r = 0 and drifts
 * negative with r (edge loss); **positive means clustering at that scale**.
 * Equivalent to `ripleyK(points, region, radii, { correction: 'none',
 * denominator: 'n2' }).centered`; use {@link ripleyK} for spatstat's
 * $A/(n(n-1))$ estimator and edge corrections, and `csrEnvelope` for a test.
 *
 * @throws FieldError `insufficient_data` (< 2 points), `invalid_config` (bad
 *   region, radii, or points outside the region)
 */
export function ripleyL(
  points: readonly Point[],
  region: FieldRegion,
  radii: readonly number[],
): Float64Array {
  return ripleyK(points, region, radii, { correction: 'none', denominator: 'n2' }).centered
}
