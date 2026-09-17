import { binomialCdf, binomialSf } from '@mindpeeker/negentropy/numerics'
import { FieldError } from '../errors.js'
import { circleRegionArea } from '../internal/geometry.js'
import { compareXY, neighbourCounts } from '../internal/neighbours.js'
import { checkOptions, checkPositive } from '../internal/validate.js'
import {
  type FieldRegion,
  type Point,
  regionArea,
  validatePoints,
  validateRegion,
} from '../types.js'
import { type ClarkEvans, clarkEvans } from './csr.js'

/**
 * A local density extreme — the densest (attractor) or sparsest (void)
 * neighbourhood — with its **single-point** statistics under CSR.
 *
 * Randonautica/libAttract parity: `neighbours` ≈ `n`, `expected` ≈ `mean`,
 * `power`, `z` ≈ `z_score`, `pSingle` ≈ `probability_single`. None of these
 * says how unusual the *extreme* of a whole field is — that is
 * `fieldSignificance`.
 */
export interface Hotspot {
  readonly point: Point
  /** Points (other than itself) within `radius`. */
  readonly neighbours: number
  /**
   * Edge-corrected CSR expectation of `neighbours` for this point:
   * $\mu_i = (n-1)\,|B(p_i, r) \cap W|/A$ (the disk clipped by the region).
   */
  readonly expected: number
  /** Density ratio `neighbours / expected` (a void's libAttract "power" is its inverse). */
  readonly power: number
  /** Poisson-style standard score $(k - \mu_i)/\sqrt{\mu_i}$ (libAttract's `z_score`). */
  readonly z: number
  /**
   * Exact single-point tail under CSR with fixed n: the count is
   * Binomial$(n-1,\ |B(p_i,r)\cap W|/A)$, so the attractor reports
   * $P(X \ge k)$ and the void $P(X \le k)$. This is the p of *one pre-chosen
   * point*; applied to the extreme of n counts it is not a p-value for the
   * field (it is < 0.05 for most CSR attractors).
   */
  readonly pSingle: number
  /** Same value as {@link Hotspot.pSingle}; the 0.1 name, kept for compatibility. */
  readonly pValue: number
}

export interface FieldResult {
  /** Densest neighbourhood (maximum count) — Randonautica's "attractor". */
  readonly attractor: Hotspot
  /** Sparsest neighbourhood (minimum count) — Randonautica's "void". */
  readonly void: Hotspot
  /** Neighbourhood radius used. */
  readonly radius: number
  /** Interior CSR expectation of a point's neighbour count, $(n-1)\pi r^2/A$. */
  readonly expectedNeighbours: number
  readonly clarkEvans: ClarkEvans
}

export interface AttractorOptions {
  /** Neighbourhood radius. Mutually exclusive with `expectedNeighbours`. */
  radius?: number
  /**
   * Target interior CSR neighbour expectation $(n-1)\pi r^2/A$ used to pick
   * the radius when `radius` is omitted. Default 4.
   */
  expectedNeighbours?: number
}

/**
 * Resolve the neighbourhood radius: an explicit `radius`, or the one whose
 * interior CSR expectation $(n-1)\pi r^2/A$ equals `expectedNeighbours`.
 *
 * @throws FieldError `invalid_config` for both options at once or a bad value
 */
export function resolveRadius(
  n: number,
  region: FieldRegion,
  opts: AttractorOptions,
  fn: string,
): number {
  checkOptions(opts, fn)
  if (opts.radius !== undefined && opts.expectedNeighbours !== undefined) {
    throw new FieldError('invalid_config', `${fn}: pass radius or expectedNeighbours, not both`)
  }
  if (opts.radius !== undefined) return checkPositive(opts.radius, 'radius')
  const target = checkPositive(opts.expectedNeighbours ?? 4, 'expectedNeighbours')
  return Math.sqrt((target * regionArea(region)) / ((n - 1) * Math.PI))
}

function hotspot(
  points: readonly Point[],
  index: number,
  count: number,
  radius: number,
  region: FieldRegion,
  tail: 'upper' | 'lower',
): Hotspot {
  const n = points.length
  const point = points[index] as Point
  const p = Math.min(1, circleRegionArea(point, radius, region) / regionArea(region))
  const expected = (n - 1) * p
  const pSingle =
    tail === 'upper'
      ? count >= 1
        ? binomialSf(count - 1, n - 1, p)
        : 1
      : binomialCdf(count, n - 1, p)
  return Object.freeze({
    point,
    neighbours: count,
    expected,
    power: count / expected,
    z: (count - expected) / Math.sqrt(expected),
    pSingle,
    pValue: pSingle,
  })
}

/** Indices of the maximum and minimum counts, ties broken by (x, y) — never point order. */
export function extremes(points: readonly Point[], counts: Int32Array): [number, number] {
  let maxI = 0
  let minI = 0
  for (let i = 1; i < counts.length; i++) {
    const c = counts[i] as number
    const p = points[i] as Point
    const cMax = counts[maxI] as number
    const cMin = counts[minI] as number
    if (c > cMax || (c === cMax && compareXY(p, points[maxI] as Point) < 0)) maxI = i
    if (c < cMin || (c === cMin && compareXY(p, points[minI] as Point) < 0)) minI = i
  }
  return [maxI, minI]
}

/**
 * Find the attractor (densest) and void (sparsest) neighbourhoods of a point
 * field — the per-point core of Randonautica's attractor/void generation.
 * Each point is scored by how many others lie within `radius`; the maximum
 * and minimum counts are returned (ties broken by lexicographic coordinates,
 * so the result never depends on point order) with **edge-corrected,
 * single-point** statistics: the CSR expectation clips the neighbourhood disk
 * by the region, and the exact Binomial$(n-1, |B\cap W|/A)$ tail replaces
 * 0.1's Poisson approximation.
 *
 * **Honest framing.** A field sampled from a good RNG *is* CSR, so an
 * attractor is the expected chance clustering of a random field. `pSingle`
 * is the tail of one point chosen in advance, not of the most extreme of n
 * points; the calibrated whole-field p for the attractor and the void is
 * {@link fieldSignificance} (a Monte-Carlo test of the same max/min counts).
 * Register any intention before looking. The geometry is asserted; the
 * intention hypothesis is not.
 *
 * @throws FieldError `insufficient_data` (< 3 points), `invalid_config` (bad
 *   region, points outside it, radius options)
 */
export function attractors(
  points: readonly Point[],
  region: FieldRegion,
  opts: AttractorOptions = {},
): FieldResult {
  validateRegion(region)
  validatePoints(points, region, 3)
  const n = points.length
  const radius = resolveRadius(n, region, opts, 'attractors')
  const counts = neighbourCounts(points, radius, region)
  const [maxI, minI] = extremes(points, counts)
  return {
    attractor: hotspot(points, maxI, counts[maxI] as number, radius, region, 'upper'),
    void: hotspot(points, minI, counts[minI] as number, radius, region, 'lower'),
    radius,
    expectedNeighbours: ((n - 1) * Math.PI * radius * radius) / regionArea(region),
    clarkEvans: clarkEvans(points, region),
  }
}
