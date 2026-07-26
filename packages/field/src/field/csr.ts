import { normalP } from '@mindpeeker/negentropy'
import { bitReader, byteReader, type OracleInput } from '@mindpeeker/oracle'
import { FieldError, rethrowOracle } from '../errors.js'
import { type FieldRegion, type Point, regionArea, validateRegion } from '../types.js'
import { samplePoint } from './sample.js'

/** Clark–Evans nearest-neighbour result. R < 1 clustered, ≈ 1 CSR, > 1 dispersed. */
export interface ClarkEvans {
  /** Aggregation index R = r̄_obs / r̄_exp. */
  readonly R: number
  /** Standard-normal deviate of the mean nearest-neighbour distance. */
  readonly z: number
  /** Two-sided p (edge-biased — the honest test is the Monte-Carlo `csrEnvelope`). */
  readonly pValue: number
  readonly meanNearest: number
  readonly expectedNearest: number
}

function requirePoints(points: readonly Point[], min: number): void {
  if (points.length < min) {
    throw new FieldError('insufficient_data', `need ≥ ${min} points, got ${points.length}`)
  }
}

/**
 * Clark & Evans (1954) nearest-neighbour test of complete spatial randomness.
 * $$\bar r_{\text{exp}} = \frac{1}{2\sqrt\lambda},\quad \lambda = n/A,\quad
 *   z = \frac{\bar r_{\text{obs}} - \bar r_{\text{exp}}}{0.26136/\sqrt{n\lambda}}.$$
 * R = r̄_obs/r̄_exp is < 1 for clustering (attractors), > 1 for dispersion. The
 * z ignores edge effects (boundary points have no neighbour outside the
 * region, inflating r̄_obs), so for a rigorous decision compare the observed
 * pattern to `csrEnvelope` — which carries the identical edge bias.
 */
export function clarkEvans(points: readonly Point[], region: FieldRegion): ClarkEvans {
  validateRegion(region)
  requirePoints(points, 2)
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
  const expectedNearest = 1 / (2 * Math.sqrt(lambda))
  const sd = 0.26136 / Math.sqrt(n * lambda)
  const z = (meanNearest - expectedNearest) / sd
  return {
    R: meanNearest / expectedNearest,
    z,
    pValue: normalP(z, 'two'),
    meanNearest,
    expectedNearest,
  }
}

/**
 * Besag's centered L-function L(r) − r of the pattern, evaluated at each radius
 * (no edge correction). Under CSR it is ≈ 0; **positive means clustering at
 * that scale**, negative means dispersion. With
 * $K(r) = \frac{A}{n^2}\sum_{i\ne j} \mathbf 1[d_{ij} \le r]$ and
 * $L(r) = \sqrt{K(r)/\pi}$, this returns $L(r) - r$. Compare it to
 * `csrEnvelope` for significance (both share the same edge bias, so the
 * comparison is honest).
 */
export function ripleyL(
  points: readonly Point[],
  region: FieldRegion,
  radii: readonly number[],
): Float64Array {
  validateRegion(region)
  requirePoints(points, 2)
  if (radii.length === 0) {
    throw new FieldError('invalid_config', 'radii must not be empty')
  }
  for (const r of radii) {
    if (!Number.isFinite(r) || r < 0) {
      throw new FieldError('invalid_config', `radii must be finite and ≥ 0, got ${r}`)
    }
  }
  const n = points.length
  const area = regionArea(region)
  const out = new Float64Array(radii.length)
  const r2 = radii.map((r) => r * r)
  const counts = new Float64Array(radii.length)
  for (let i = 0; i < n; i++) {
    const pi = points[i] as Point
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      const pj = points[j] as Point
      const dx = pi.x - pj.x
      const dy = pi.y - pj.y
      const d2 = dx * dx + dy * dy
      for (let k = 0; k < radii.length; k++)
        if (d2 <= (r2[k] as number)) counts[k] = (counts[k] as number) + 1
    }
  }
  for (let k = 0; k < radii.length; k++) {
    const kHat = (area / (n * n)) * (counts[k] as number)
    out[k] = Math.sqrt(kHat / Math.PI) - (radii[k] as number)
  }
  return out
}

export interface CsrEnvelope {
  /** Pointwise minimum of L(r) − r over the simulated CSR fields. */
  readonly lo: Float64Array
  /** Pointwise maximum. Observed values outside [lo, hi] are significant at ≈ 2/(runs+1). */
  readonly hi: Float64Array
  readonly runs: number
}

/**
 * Monte-Carlo complete-spatial-randomness envelope for `ripleyL`: draw `runs`
 * fresh CSR fields of the same `count` from the SAME entropy source, compute
 * L(r) − r for each, and return the pointwise min/max band. An observed curve
 * that pokes outside the band at some r is significant there at level
 * ≈ 2/(runs + 1) (the exact rank-based Monte-Carlo test; Ripley 1977). Consumes
 * `runs × count` points of entropy from a single advancing reader, so the
 * simulated fields are independent (not restarts of the same bytes).
 */
export async function csrEnvelope(
  source: OracleInput,
  count: number,
  region: FieldRegion,
  radii: readonly number[],
  runs = 99,
  opts: { signal?: AbortSignal } = {},
): Promise<CsrEnvelope> {
  if (!Number.isInteger(runs) || runs < 1) {
    throw new FieldError('invalid_config', `runs must be an integer ≥ 1, got ${runs}`)
  }
  if (!Number.isInteger(count) || count < 2) {
    throw new FieldError('invalid_config', `count must be an integer ≥ 2, got ${count}`)
  }
  validateRegion(region)
  const reader = byteReader(source, opts.signal ? { signal: opts.signal } : {})
  const bits = bitReader(reader)
  const lo = new Float64Array(radii.length).fill(Number.POSITIVE_INFINITY)
  const hi = new Float64Array(radii.length).fill(Number.NEGATIVE_INFINITY)
  try {
    for (let run = 0; run < runs; run++) {
      const points: Point[] = []
      for (let i = 0; i < count; i++) points.push(await samplePoint(bits, region))
      const l = ripleyL(points, region, radii)
      for (let k = 0; k < radii.length; k++) {
        const v = l[k] as number
        if (v < (lo[k] as number)) lo[k] = v
        if (v > (hi[k] as number)) hi[k] = v
      }
    }
  } catch (error) {
    rethrowOracle(error)
  }
  return { lo, hi, runs }
}
