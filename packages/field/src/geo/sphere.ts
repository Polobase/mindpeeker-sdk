import type { BitReader } from '@mindpeeker/oracle'
import { FieldError, toFieldError } from '../errors.js'
import {
  type FieldInput,
  type Uint32Draw,
  uint32FromBits,
  unitFloat,
  withFieldReader,
} from '../internal/draw.js'
import { checkOptions, checkSignal } from '../internal/validate.js'
import type { Point } from '../types.js'

/** WGS-84 mean Earth radius in metres. */
export const EARTH_RADIUS_M = 6_371_008.8

export interface LatLon {
  /** Latitude in degrees, [-90, 90]. */
  readonly lat: number
  /** Longitude in degrees, [-180, 180] (outputs keep 180 when that is the exact value). */
  readonly lon: number
}

const D2R = Math.PI / 180
const R2D = 180 / Math.PI

/**
 * Validate a coordinate: finite latitude in [-90, 90] and finite longitude.
 *
 * @throws FieldError `invalid_config`
 */
export function validateLatLon(p: LatLon, what = 'coordinate'): void {
  if (p === null || typeof p !== 'object') {
    throw new FieldError('invalid_config', `${what} must be an object { lat, lon }`)
  }
  if (typeof p.lat !== 'number' || !Number.isFinite(p.lat) || p.lat < -90 || p.lat > 90) {
    throw new FieldError(
      'invalid_config',
      `${what}.lat must be finite in [-90, 90], got ${String(p.lat)}`,
    )
  }
  if (typeof p.lon !== 'number' || !Number.isFinite(p.lon)) {
    throw new FieldError('invalid_config', `${what}.lon must be finite, got ${String(p.lon)}`)
  }
}

/**
 * Wrap a longitude into [-180, 180]. Values already in range — including
 * exactly 180 — are returned unchanged; others wrap into [-180, 180) except
 * that a positive input landing on -180 is reported as 180.
 */
export function normalizeLon(lon: number): number {
  if (lon >= -180 && lon <= 180) return lon
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180
  return wrapped === -180 && lon > 0 ? 180 : wrapped
}

/**
 * Great-circle (haversine) distance in metres between two coordinates.
 * $$d = 2R\arcsin\sqrt{\sin^2\tfrac{\Delta\varphi}{2} +
 *   \cos\varphi_1\cos\varphi_2\sin^2\tfrac{\Delta\lambda}{2}}.$$
 *
 * @throws FieldError `invalid_config` for an invalid coordinate
 */
export function haversine(a: LatLon, b: LatLon): number {
  validateLatLon(a, 'a')
  validateLatLon(b, 'b')
  const phi1 = a.lat * D2R
  const phi2 = b.lat * D2R
  const dPhi = (b.lat - a.lat) * D2R
  const dLam = (b.lon - a.lon) * D2R
  const s = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)))
}

function destinationUnchecked(start: LatLon, bearingRad: number, distanceM: number): LatLon {
  const delta = distanceM / EARTH_RADIUS_M
  const phi1 = start.lat * D2R
  const sinPhi2 =
    Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(bearingRad)
  const phi2 = Math.asin(Math.min(1, Math.max(-1, sinPhi2)))
  const y = Math.sin(bearingRad) * Math.sin(delta) * Math.cos(phi1)
  const x = Math.cos(delta) - Math.sin(phi1) * sinPhi2
  const lon = normalizeLon(start.lon + Math.atan2(y, x) * R2D)
  return { lat: phi2 * R2D, lon }
}

/**
 * Destination coordinate reached from `start` by travelling `distanceM` metres
 * along an initial `bearingRad` (radians clockwise from north), on the great
 * circle. The longitude is wrapped into [-180, 180] (an exact 180 stays 180).
 *
 * @throws FieldError `invalid_config` for an invalid start, bearing or distance
 */
export function destination(start: LatLon, bearingRad: number, distanceM: number): LatLon {
  validateLatLon(start, 'start')
  if (typeof bearingRad !== 'number' || !Number.isFinite(bearingRad)) {
    throw new FieldError('invalid_config', `bearing must be finite, got ${String(bearingRad)}`)
  }
  if (typeof distanceM !== 'number' || !Number.isFinite(distanceM)) {
    throw new FieldError('invalid_config', `distance must be finite, got ${String(distanceM)}`)
  }
  return destinationUnchecked(start, bearingRad, distanceM)
}

/**
 * Map a field {@link Point} (in metres, disk coordinates centred at origin) to
 * a geographic coordinate around `center`, treating +x as east and +y as
 * north: the point's distance becomes a great-circle distance along its
 * bearing (azimuthal equidistant projection). Area-uniform on the sphere to
 * a relative error of order $(r/R)^2$ — negligible at city scale; for
 * continental radii use {@link sampleCap}.
 *
 * @throws FieldError `invalid_config` for an invalid centre or point
 */
export function pointToLatLon(center: LatLon, p: Point): LatLon {
  validateLatLon(center, 'center')
  if (p === null || typeof p !== 'object' || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
    throw new FieldError('invalid_config', 'point must have finite x and y')
  }
  const distance = Math.hypot(p.x, p.y)
  if (distance === 0) return { lat: center.lat, lon: center.lon }
  const bearing = Math.atan2(p.x, p.y) // clockwise from north (y), so (x=east, y=north)
  return destinationUnchecked(center, bearing, distance)
}

/** Options for the spherical samplers. */
export interface SphereSampleOptions {
  /** Aborts the draw (only when the samplers create the reader themselves). */
  signal?: AbortSignal
}

function isBitReader(input: unknown): input is BitReader {
  return (
    input !== null &&
    typeof input === 'object' &&
    typeof (input as BitReader).nextBits === 'function' &&
    typeof (input as BitReader).bitsUsed === 'number'
  )
}

async function withDraw<T>(
  input: BitReader | FieldInput,
  opts: SphereSampleOptions,
  body: (draw: Uint32Draw) => Promise<T>,
): Promise<T> {
  checkOptions(opts, 'sampler')
  const signal = checkSignal(opts.signal)
  if (isBitReader(input)) {
    try {
      return await body(uint32FromBits(input))
    } catch (error) {
      throw toFieldError(error)
    }
  }
  return (await withFieldReader(input, signal, body)).value
}

/**
 * One point uniformly distributed **by area on the sphere** within the
 * spherical cap of great-circle radius `radiusM` around `center` (exact at
 * any scale, poles and antimeridian included; Archimedes' hat-box theorem):
 * with $\delta = r/R$ and uniforms u, v from 32 bits each,
 * $1 - \cos\theta = u\,(1 - \cos\delta)$ — computed stably as
 * $\theta = 2\arcsin(\sqrt u\,\sin(\delta/2))$ — and bearing $2\pi v$.
 *
 * `input` is a caller's `BitReader` (not closed), a `ByteReader` (not
 * closed) or any oracle input (a reader is created and closed).
 *
 * @throws FieldError `invalid_config` (centre, radius ∉ (0, πR], input
 *   shape), `insufficient_entropy`, `aborted`, `source_error`
 */
export async function sampleCap(
  input: BitReader | FieldInput,
  center: LatLon,
  radiusM: number,
  opts: SphereSampleOptions = {},
): Promise<LatLon> {
  validateLatLon(center, 'center')
  if (
    typeof radiusM !== 'number' ||
    !Number.isFinite(radiusM) ||
    radiusM <= 0 ||
    radiusM > Math.PI * EARTH_RADIUS_M
  ) {
    throw new FieldError(
      'invalid_config',
      `radiusM must be in (0, πR] = (0, ${Math.PI * EARTH_RADIUS_M}], got ${String(radiusM)}`,
    )
  }
  return withDraw(input, opts, async (draw) => {
    const u = await unitFloat(draw)
    const v = await unitFloat(draw)
    const theta = 2 * Math.asin(Math.min(1, Math.sqrt(u) * Math.sin(radiusM / EARTH_RADIUS_M / 2)))
    return destinationUnchecked(center, 2 * Math.PI * v, theta * EARTH_RADIUS_M)
  })
}

/** A latitude/longitude box in degrees; `west > east` crosses the antimeridian. */
export interface LatLonBox {
  readonly south: number
  readonly north: number
  readonly west: number
  readonly east: number
}

/**
 * One point uniformly distributed by area on the sphere inside a lat/lon box:
 * $\varphi = \arcsin(\sin\varphi_1 + u(\sin\varphi_2 - \sin\varphi_1))$ (equal
 * area per band), $\lambda = \lambda_W + v\,\Delta\lambda$, with the box
 * crossing the antimeridian when `west > east`. Input semantics as
 * {@link sampleCap}.
 *
 * @throws FieldError `invalid_config` (box bounds, input shape),
 *   `insufficient_entropy`, `aborted`, `source_error`
 */
export async function sampleLatLonBox(
  input: BitReader | FieldInput,
  box: LatLonBox,
  opts: SphereSampleOptions = {},
): Promise<LatLon> {
  if (box === null || typeof box !== 'object') {
    throw new FieldError('invalid_config', 'box must be { south, north, west, east }')
  }
  const { south, north, west, east } = box
  for (const [name, value, limit] of [
    ['south', south, 90],
    ['north', north, 90],
    ['west', west, 180],
    ['east', east, 180],
  ] as const) {
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit) {
      throw new FieldError('invalid_config', `box.${name} must be finite in [-${limit}, ${limit}]`)
    }
  }
  if (!(south < north)) throw new FieldError('invalid_config', 'box.south must be < box.north')
  if (west === east) throw new FieldError('invalid_config', 'box.west must differ from box.east')
  const span = east > west ? east - west : east - west + 360
  const s1 = Math.sin(south * D2R)
  const s2 = Math.sin(north * D2R)
  return withDraw(input, opts, async (draw) => {
    const u = await unitFloat(draw)
    const v = await unitFloat(draw)
    const lat = Math.asin(Math.max(-1, Math.min(1, s1 + u * (s2 - s1)))) * R2D
    return { lat, lon: normalizeLon(west + v * span) }
  })
}
