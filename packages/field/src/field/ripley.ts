import { FieldError } from '../errors.js'
import { arcFractionInRegion, borderDistance, translationOverlap } from '../internal/geometry.js'
import { checkOptions, checkRadii } from '../internal/validate.js'
import {
  type FieldRegion,
  type Point,
  regionArea,
  validatePoints,
  validateRegion,
} from '../types.js'

/** Edge corrections for {@link ripleyK} (spatstat `Kest` names in parentheses). */
export type KCorrection = 'none' | 'border' | 'isotropic' | 'translation'

/** Normalisation of the pair sum: $\hat\lambda^2 = n^2/A^2$ or $n(n-1)/A^2$. */
export type KDenominator = 'n2' | 'n(n-1)'

export interface RipleyKOptions {
  /** Edge correction. Default `'isotropic'` (Ripley 1977). */
  correction?: KCorrection
  /** Default `'n(n-1)'`, spatstat's estimator; `'n2'` is 0.1's `ripleyL`. */
  denominator?: KDenominator
}

export interface RipleyK {
  /** The radii, in the order given. */
  readonly radii: Float64Array
  /** $\hat K(r)$; `NaN` where the border method has no eligible centre. */
  readonly k: Float64Array
  /** $\hat L(r) = \sqrt{\hat K(r)/\pi}$. */
  readonly l: Float64Array
  /** $\hat L(r) - r$ (≈ 0 under CSR; positive = clustering). */
  readonly centered: Float64Array
  readonly correction: KCorrection
  readonly denominator: KDenominator
}

/** Weights above this are clipped, as spatstat's `maxedgewt` (default 100). */
export const MAX_EDGE_WEIGHT = 100

/** First index k with sorted[k] ≥ value (sorted.length if none). */
function lowerBound(sorted: Float64Array, value: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if ((sorted[mid] as number) < value) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** First index k with sorted[k] > value (sorted.length if none). */
function upperBound(sorted: Float64Array, value: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if ((sorted[mid] as number) <= value) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Ripley's K-function with a choice of edge correction and normalisation,
 * following spatstat's `Kest` definitions (Baddeley, Rubak & Turner 2015,
 * §7.4) with closed-form weights for both region kinds:
 *
 * - `'none'`: $\hat K(r) = \frac{A}{D}\sum_{i\ne j}\mathbf 1[d_{ij}\le r]$
 * - `'isotropic'` (Ripley 1977): each pair weighted by
 *   $e_{ij} = 2\pi d_{ij}/\text{length}(\partial B(x_i, d_{ij}) \cap W)$ —
 *   the inverse circumference fraction inside the region (exact for rect and
 *   disk), clipped to $[1, 100]$ as spatstat does
 * - `'translation'` (Ohser 1983): $e_{ij} = A/|W \cap (W + x_j - x_i)|$ —
 *   rect $wh/((w-|dx|)(h-|dy|))$, disk $A$ over the lens of two radius-$R$
 *   disks — clipped at 100
 * - `'border'` (reduced sample): only centres at least r from the boundary,
 *   $\hat K(r) = \frac{\sum_i \mathbf 1[b_i \ge r]\sum_{j\ne i}\mathbf 1[d_{ij}\le r]}{\hat\lambda\,\#\{i : b_i \ge r\}}$
 *
 * with $D = n(n-1)$ (default, spatstat) or $n^2$, and for the border method
 * $\hat\lambda = (n-1)/A$ or $n/A$ respectively — spatstat's `border` column
 * uses $n/A$, i.e. `denominator: 'n2'`. spatstat returns `NA` beyond
 * $r_{max}$ (translation: the shorter side; isotropic: the bounding radius);
 * this function computes every radius and leaves the choice of range to you.
 *
 * Cost $O(n^2 + n^2\log m)$ for m radii.
 *
 * @throws FieldError `insufficient_data` (< 2 points), `invalid_config` (bad
 *   region, radii, options, or points outside the region)
 */
export function ripleyK(
  points: readonly Point[],
  region: FieldRegion,
  radii: readonly number[],
  opts: RipleyKOptions = {},
): RipleyK {
  validateRegion(region)
  validatePoints(points, region, 2)
  const r = checkRadii(radii)
  checkOptions(opts, 'ripleyK')
  const correction = opts.correction ?? 'isotropic'
  const denominator = opts.denominator ?? 'n(n-1)'
  if (!['none', 'border', 'isotropic', 'translation'].includes(correction)) {
    throw new FieldError('invalid_config', `unknown correction ${String(correction)}`)
  }
  if (denominator !== 'n2' && denominator !== 'n(n-1)') {
    throw new FieldError('invalid_config', `denominator must be 'n2' or 'n(n-1)'`)
  }
  const n = points.length
  const area = regionArea(region)
  const m = r.length
  const order = Array.from({ length: m }, (_, k) => k).sort(
    (a, b) => (r[a] as number) - (r[b] as number),
  )
  const sorted = Float64Array.from(order, (k) => r[k] as number)
  const rmax = sorted[m - 1] as number
  const rmax2 = rmax * rmax
  const kSorted = new Float64Array(m)

  if (correction === 'border') {
    const pairs = new Float64Array(m + 1)
    const centres = new Float64Array(m + 1)
    for (let i = 0; i < n; i++) {
      const p = points[i] as Point
      const b = borderDistance(p, region)
      const hi = upperBound(sorted, b) // radii r_k ≤ b are k < hi
      if (hi === 0) continue
      centres[0] = (centres[0] as number) + 1
      centres[hi] = (centres[hi] as number) - 1
      const limit = Math.min(rmax, b)
      const limit2 = limit * limit
      for (let j = 0; j < n; j++) {
        if (j === i) continue
        const q = points[j] as Point
        const dx = q.x - p.x
        const dy = q.y - p.y
        const d2 = dx * dx + dy * dy
        if (d2 > limit2) continue
        const lo = lowerBound(sorted, Math.sqrt(d2))
        if (lo >= hi) continue
        pairs[lo] = (pairs[lo] as number) + 1
        pairs[hi] = (pairs[hi] as number) - 1
      }
    }
    const lambda = (denominator === 'n2' ? n : n - 1) / area
    let numerator = 0
    let count = 0
    for (let k = 0; k < m; k++) {
      numerator += pairs[k] as number
      count += centres[k] as number
      kSorted[k] = count > 0 ? numerator / (lambda * count) : Number.NaN
    }
  } else {
    const bucket = new Float64Array(m)
    for (let i = 0; i < n; i++) {
      const p = points[i] as Point
      for (let j = 0; j < n; j++) {
        if (j === i) continue
        const q = points[j] as Point
        const dx = q.x - p.x
        const dy = q.y - p.y
        const d2 = dx * dx + dy * dy
        if (d2 > rmax2) continue
        const d = Math.sqrt(d2)
        let w = 1
        if (correction === 'isotropic') {
          w = Math.max(1, Math.min(MAX_EDGE_WEIGHT, 1 / arcFractionInRegion(p, d, region)))
        } else if (correction === 'translation') {
          w = Math.min(MAX_EDGE_WEIGHT, area / translationOverlap(dx, dy, region))
        }
        const k = lowerBound(sorted, d)
        bucket[k] = (bucket[k] as number) + w
      }
    }
    const scale = area / (denominator === 'n2' ? n * n : n * (n - 1))
    let total = 0
    for (let k = 0; k < m; k++) {
      total += bucket[k] as number
      kSorted[k] = scale * total
    }
  }

  const k = new Float64Array(m)
  const l = new Float64Array(m)
  const centered = new Float64Array(m)
  for (let s = 0; s < m; s++) {
    const idx = order[s] as number
    const value = kSorted[s] as number
    k[idx] = value
    l[idx] = Math.sqrt(value / Math.PI)
    centered[idx] = (l[idx] as number) - (r[idx] as number)
  }
  return Object.freeze({ radii: r, k, l, centered, correction, denominator })
}
