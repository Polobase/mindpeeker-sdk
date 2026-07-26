/**
 * Geographic helpers for turning a field {@link Point} into real-world
 * coordinates — the Randonautica use case (a random point inside a radius of a
 * start location). Pure, browser-safe great-circle math on a spherical Earth
 * (mean radius 6 371 008.8 m); good to a few metres over the ≤ few-km radii
 * these fields use, which is well inside their sampling granularity.
 *
 * Behind the `@mindpeeker/field/geo` subpath.
 */

import type { Point } from './types.js'

/** WGS-84 mean Earth radius in metres. */
export const EARTH_RADIUS_M = 6_371_008.8

export interface LatLon {
  /** Latitude in degrees, [-90, 90]. */
  readonly lat: number
  /** Longitude in degrees, [-180, 180]. */
  readonly lon: number
}

const D2R = Math.PI / 180
const R2D = 180 / Math.PI

/**
 * Great-circle (haversine) distance in metres between two coordinates.
 * $$d = 2R\arcsin\sqrt{\sin^2\tfrac{\Delta\varphi}{2} +
 *   \cos\varphi_1\cos\varphi_2\sin^2\tfrac{\Delta\lambda}{2}}.$$
 */
export function haversine(a: LatLon, b: LatLon): number {
  const phi1 = a.lat * D2R
  const phi2 = b.lat * D2R
  const dPhi = (b.lat - a.lat) * D2R
  const dLam = (b.lon - a.lon) * D2R
  const s = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)))
}

/**
 * Destination coordinate reached from `start` by travelling `distanceM` metres
 * along an initial `bearingRad` (radians clockwise from north), on the great
 * circle. Inverse-ish of {@link haversine} along a fixed bearing.
 */
export function destination(start: LatLon, bearingRad: number, distanceM: number): LatLon {
  const delta = distanceM / EARTH_RADIUS_M
  const phi1 = start.lat * D2R
  const lam1 = start.lon * D2R
  const sinPhi2 =
    Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(bearingRad)
  const phi2 = Math.asin(Math.min(1, Math.max(-1, sinPhi2)))
  const y = Math.sin(bearingRad) * Math.sin(delta) * Math.cos(phi1)
  const x = Math.cos(delta) - Math.sin(phi1) * sinPhi2
  const lam2 = lam1 + Math.atan2(y, x)
  // normalize longitude to [-180, 180]
  const lon = (((lam2 * R2D + 540) % 360) - 180) as number
  return { lat: phi2 * R2D, lon }
}

/**
 * Map a field {@link Point} (in metres, disk coordinates centred at origin) to
 * a geographic coordinate around `center`, treating +x as east and +y as
 * north. Use with a `disk` region whose `radius` is in metres, so a
 * `sampleField` point becomes a randomly located coordinate within that radius
 * — the Randonautica primitive, done without bias.
 */
export function pointToLatLon(center: LatLon, p: Point): LatLon {
  const distance = Math.hypot(p.x, p.y)
  if (distance === 0) return { lat: center.lat, lon: center.lon }
  const bearing = Math.atan2(p.x, p.y) // clockwise from north (y), so (x=east, y=north)
  return destination(center, bearing, distance)
}
