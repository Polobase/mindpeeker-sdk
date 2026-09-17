import { FieldError } from '../errors.js'
import { type LatLon, normalizeLon, validateLatLon } from './sphere.js'

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz'
const DECODE = new Map<string, number>(Array.from(BASE32, (ch, i) => [ch, i]))

/** Longest geohash accepted (110 bits — far below float64 resolution already at 12). */
export const MAX_GEOHASH_LENGTH = 22

/** A decoded geohash cell. */
export interface GeohashCell {
  /** Cell centre latitude. */
  readonly lat: number
  /** Cell centre longitude. */
  readonly lon: number
  /** Half the cell height in degrees (the centre's latitude uncertainty). */
  readonly latError: number
  /** Half the cell width in degrees. */
  readonly lonError: number
  readonly south: number
  readonly north: number
  readonly west: number
  readonly east: number
}

/** The eight cells around a geohash; `null` beyond a pole. */
export interface GeohashNeighbours {
  readonly n: string | null
  readonly ne: string | null
  readonly e: string | null
  readonly se: string | null
  readonly s: string | null
  readonly sw: string | null
  readonly w: string | null
  readonly nw: string | null
}

/**
 * Encode a coordinate as a geohash (Niemeyer 2008): bits alternate longitude
 * then latitude, each bisecting its interval ([-180, 180], [-90, 90]) with a
 * value **at or above** the midpoint taking the upper half, five bits per
 * base-32 character (`0-9 b-h j k m n p-z`). Longitudes outside [-180, 180]
 * are wrapped first. Precision 9 ≈ 4.8 m × 4.8 m at the equator.
 *
 * @throws FieldError `invalid_config` for an invalid coordinate or precision ∉ [1, 22]
 */
export function geohashEncode(point: LatLon, precision = 9): string {
  validateLatLon(point, 'point')
  if (!Number.isInteger(precision) || precision < 1 || precision > MAX_GEOHASH_LENGTH) {
    throw new FieldError(
      'invalid_config',
      `precision must be an integer in [1, ${MAX_GEOHASH_LENGTH}], got ${String(precision)}`,
    )
  }
  const lon = normalizeLon(point.lon)
  let latLo = -90
  let latHi = 90
  let lonLo = -180
  let lonHi = 180
  let hash = ''
  let even = true
  let bit = 0
  let ch = 0
  while (hash.length < precision) {
    if (even) {
      const mid = (lonLo + lonHi) / 2
      if (lon >= mid) {
        ch = (ch << 1) | 1
        lonLo = mid
      } else {
        ch <<= 1
        lonHi = mid
      }
    } else {
      const mid = (latLo + latHi) / 2
      if (point.lat >= mid) {
        ch = (ch << 1) | 1
        latLo = mid
      } else {
        ch <<= 1
        latHi = mid
      }
    }
    even = !even
    if (++bit === 5) {
      hash += BASE32[ch]
      bit = 0
      ch = 0
    }
  }
  return hash
}

/**
 * Decode a geohash (case-insensitive) into its cell bounds and centre.
 *
 * @throws FieldError `invalid_config` for an empty, over-long or malformed hash
 */
export function geohashDecode(hash: string): GeohashCell {
  if (typeof hash !== 'string' || hash.length === 0 || hash.length > MAX_GEOHASH_LENGTH) {
    throw new FieldError(
      'invalid_config',
      `geohash must be a string of 1–${MAX_GEOHASH_LENGTH} characters`,
    )
  }
  let south = -90
  let north = 90
  let west = -180
  let east = 180
  let even = true
  for (const raw of hash.toLowerCase()) {
    const value = DECODE.get(raw)
    if (value === undefined) {
      throw new FieldError('invalid_config', `invalid geohash character ${JSON.stringify(raw)}`)
    }
    for (let b = 4; b >= 0; b--) {
      const bit = (value >> b) & 1
      if (even) {
        const mid = (west + east) / 2
        if (bit === 1) west = mid
        else east = mid
      } else {
        const mid = (south + north) / 2
        if (bit === 1) south = mid
        else north = mid
      }
      even = !even
    }
  }
  return Object.freeze({
    lat: (south + north) / 2,
    lon: (west + east) / 2,
    latError: (north - south) / 2,
    lonError: (east - west) / 2,
    south,
    north,
    west,
    east,
  })
}

/**
 * The eight geohashes of equal length surrounding `hash`, wrapping across the
 * antimeridian; neighbours beyond the north or south pole are `null`.
 *
 * @throws FieldError `invalid_config` for a malformed hash
 */
export function geohashNeighbours(hash: string): GeohashNeighbours {
  const cell = geohashDecode(hash)
  const height = cell.north - cell.south
  const width = cell.east - cell.west
  const at = (dLat: number, dLon: number): string | null => {
    const lat = cell.lat + dLat * height
    if (lat > 90 || lat < -90) return null
    let lon = cell.lon + dLon * width
    if (lon >= 180) lon -= 360
    if (lon < -180) lon += 360
    return geohashEncode({ lat, lon }, hash.length)
  }
  return Object.freeze({
    n: at(1, 0),
    ne: at(1, 1),
    e: at(0, 1),
    se: at(-1, 1),
    s: at(-1, 0),
    sw: at(-1, -1),
    w: at(0, -1),
    nw: at(1, -1),
  })
}
