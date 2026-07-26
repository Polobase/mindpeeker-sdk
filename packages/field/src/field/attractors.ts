import { gammaP, gammaQ } from '@mindpeeker/negentropy/numerics'
import { FieldError } from '../errors.js'
import { type FieldRegion, type Point, regionArea, validateRegion } from '../types.js'
import { type ClarkEvans, clarkEvans } from './csr.js'

/** A local density extreme — the densest (attractor) or sparsest (void) neighbourhood. */
export interface Hotspot {
  readonly point: Point
  /** Points (other than itself) within `radius`. */
  readonly neighbours: number
  /** Poisson tail p under CSR: P(X ≥ neighbours) for an attractor, P(X ≤ neighbours) for a void. */
  readonly pValue: number
}

export interface FieldResult {
  /** Densest neighbourhood — Randonautica's "attractor". */
  readonly attractor: Hotspot
  /** Sparsest neighbourhood — Randonautica's "void". */
  readonly void: Hotspot
  /** Neighbourhood radius used. */
  readonly radius: number
  /** Expected neighbours per point under CSR, μ = λ·π·radius². */
  readonly expectedNeighbours: number
  readonly clarkEvans: ClarkEvans
}

export interface AttractorOptions {
  /** Neighbourhood radius. Default: chosen so the CSR expectation is `expectedNeighbours`. */
  radius?: number
  /** Target CSR neighbour expectation when `radius` is omitted. Default 4. */
  expectedNeighbours?: number
}

/** FNV-1a hash of a point's coordinates — an order-invariant tie-break key. */
function tieKey(p: Point): number {
  const s = `${p.x},${p.y}`
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return h >>> 0
}

/**
 * Find the attractor (densest) and void (sparsest) neighbourhoods of a point
 * field — the rigorous core of Randonautica's attractor/void generation. Each
 * point is scored by how many others lie within `radius`; the extreme points
 * are returned with a **Poisson tail p-value under CSR** (μ = λ·π·radius²), so
 * a chance cluster in a uniform field is flagged as such. Ties in neighbour
 * count are broken by a stable hash of coordinates, never point order.
 *
 * **Honest framing.** A field sampled from a QRNG *is* CSR, so attractors are
 * the expected chance clustering of a random field — the p-value tells you how
 * ordinary. Because every point is tested, apply a multiple-comparisons
 * correction (Bonferroni α/n, or read the `csrEnvelope`) before calling an
 * attractor "significant", and register any intention before looking. The
 * geometry is asserted; the intention hypothesis is not.
 */
export function attractors(
  points: readonly Point[],
  region: FieldRegion,
  opts: AttractorOptions = {},
): FieldResult {
  validateRegion(region)
  const n = points.length
  if (n < 3) {
    throw new FieldError('insufficient_data', `attractors needs ≥ 3 points, got ${n}`)
  }
  const area = regionArea(region)
  const lambda = n / area
  const expectedNeighbours = opts.expectedNeighbours ?? 4
  if (!(expectedNeighbours > 0)) {
    throw new FieldError(
      'invalid_config',
      `expectedNeighbours must be > 0, got ${expectedNeighbours}`,
    )
  }
  const radius = opts.radius ?? Math.sqrt(expectedNeighbours / (lambda * Math.PI))
  if (!(radius > 0) || !Number.isFinite(radius)) {
    throw new FieldError('invalid_config', `radius must be finite and > 0, got ${radius}`)
  }
  const mu = lambda * Math.PI * radius * radius
  const r2 = radius * radius

  const counts = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const pi = points[i] as Point
    let c = 0
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      const pj = points[j] as Point
      const dx = pi.x - pj.x
      const dy = pi.y - pj.y
      if (dx * dx + dy * dy <= r2) c++
    }
    counts[i] = c
  }

  let maxI = 0
  let minI = 0
  for (let i = 1; i < n; i++) {
    const c = counts[i] as number
    if (
      c > (counts[maxI] as number) ||
      (c === (counts[maxI] as number) && tieKey(points[i] as Point) < tieKey(points[maxI] as Point))
    ) {
      maxI = i
    }
    if (
      c < (counts[minI] as number) ||
      (c === (counts[minI] as number) && tieKey(points[i] as Point) < tieKey(points[minI] as Point))
    ) {
      minI = i
    }
  }

  const attractorCount = counts[maxI] as number
  const voidCount = counts[minI] as number
  // Poisson tails: P(X ≥ k) = gammaP(k, μ) (k ≥ 1); P(X ≤ k) = gammaQ(k + 1, μ)
  const attractor: Hotspot = {
    point: points[maxI] as Point,
    neighbours: attractorCount,
    pValue: attractorCount >= 1 ? gammaP(attractorCount, mu) : 1,
  }
  const voidSpot: Hotspot = {
    point: points[minI] as Point,
    neighbours: voidCount,
    pValue: gammaQ(voidCount + 1, mu),
  }
  return {
    attractor: Object.freeze(attractor),
    void: Object.freeze(voidSpot),
    radius,
    expectedNeighbours: mu,
    clarkEvans: clarkEvans(points, region),
  }
}
