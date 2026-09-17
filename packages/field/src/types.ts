import { FieldError } from './errors.js'

/** A 2-D point in region coordinates (rect: [0,width]×[0,height]; disk: centred at origin). */
export interface Point {
  readonly x: number
  readonly y: number
}

/** The bounded study region a field lives in. */
export type FieldRegion =
  | { readonly kind: 'rect'; readonly width: number; readonly height: number }
  | { readonly kind: 'disk'; readonly radius: number }

/**
 * Honest receipt of the entropy a sampling call spent (mirrors the oracle's
 * shape): `bytesConsumed` bytes read, `bitsUsed` bits that entered a
 * coordinate, and — when the reader tracks it — `bytesFetched`, what the
 * source actually delivered (including the unread rest of its last chunk).
 */
export interface EntropyAccounting {
  readonly bytesConsumed: number
  readonly bitsUsed: number
  readonly bytesFetched?: number
}

/** Area of a region — the denominator of the CSR intensity λ = n/A. */
export function regionArea(region: FieldRegion): number {
  return region.kind === 'rect'
    ? region.width * region.height
    : Math.PI * region.radius * region.radius
}

/** Perimeter of a region (used by the Donnelly edge correction). */
export function regionPerimeter(region: FieldRegion): number {
  return region.kind === 'rect' ? 2 * (region.width + region.height) : 2 * Math.PI * region.radius
}

/** Axis-aligned bounding box `[xmin, ymin, xmax, ymax]` of a region. */
export function regionBounds(region: FieldRegion): readonly [number, number, number, number] {
  return region.kind === 'rect'
    ? [0, 0, region.width, region.height]
    : [-region.radius, -region.radius, region.radius, region.radius]
}

/** Validate a region's shape and that its dimensions are finite and positive. */
export function validateRegion(region: FieldRegion): void {
  if (region === null || typeof region !== 'object') {
    throw new FieldError('invalid_config', 'region must be an object')
  }
  let dims: number[]
  if (region.kind === 'rect') dims = [region.width, region.height]
  else if (region.kind === 'disk') dims = [region.radius]
  else {
    const kind = String((region as { kind?: unknown }).kind)
    throw new FieldError('invalid_config', `region kind must be 'rect' or 'disk', got ${kind}`)
  }
  for (const d of dims) {
    if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0) {
      throw new FieldError(
        'invalid_config',
        `region dimensions must be finite and > 0, got ${String(d)}`,
      )
    }
  }
}

/** Relative slack for "inside the region": float rounding at the boundary is not an error. */
const INSIDE_SLACK = 1e-9

/** True when `p` lies in the closed region (with {@link INSIDE_SLACK} relative tolerance). */
export function insideRegion(p: Point, region: FieldRegion): boolean {
  if (region.kind === 'rect') {
    const ex = INSIDE_SLACK * region.width
    const ey = INSIDE_SLACK * region.height
    return p.x >= -ex && p.x <= region.width + ex && p.y >= -ey && p.y <= region.height + ey
  }
  const limit = region.radius * (1 + INSIDE_SLACK)
  return p.x * p.x + p.y * p.y <= limit * limit
}

/**
 * Validate a point pattern at a public boundary: an array of at least `min`
 * objects with finite `x`/`y` inside the (validated) region.
 *
 * @throws FieldError `insufficient_data` for fewer than `min` points,
 *   `invalid_config` for a non-array, a non-finite coordinate, or a point
 *   outside the region
 */
export function validatePoints(
  points: readonly Point[],
  region: FieldRegion,
  min: number,
  what = 'points',
): void {
  if (!Array.isArray(points)) {
    throw new FieldError('invalid_config', `${what} must be an array of { x, y }`)
  }
  if (points.length < min) {
    throw new FieldError('insufficient_data', `${what}: need ≥ ${min} points, got ${points.length}`)
  }
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as Point | null | undefined
    if (
      p === null ||
      typeof p !== 'object' ||
      typeof p.x !== 'number' ||
      typeof p.y !== 'number' ||
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y)
    ) {
      throw new FieldError('invalid_config', `${what}[${i}] must have finite x and y`)
    }
    if (!insideRegion(p, region)) {
      throw new FieldError(
        'invalid_config',
        `${what}[${i}] = (${p.x}, ${p.y}) lies outside the ${region.kind} region`,
      )
    }
  }
}
