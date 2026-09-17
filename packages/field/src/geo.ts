/**
 * Geographic helpers for turning a field {@link Point} into real-world
 * coordinates — the Randonautica use case (a random point inside a radius of a
 * start location) — plus exact area-uniform samplers on the sphere and
 * geohash cells. Pure, browser-safe math on a spherical Earth (mean radius
 * 6 371 008.8 m).
 *
 * Behind the `@mindpeeker/field/geo` subpath.
 */

export {
  type GeohashCell,
  type GeohashNeighbours,
  geohashDecode,
  geohashEncode,
  geohashNeighbours,
  MAX_GEOHASH_LENGTH,
} from './geo/geohash.js'
export {
  destination,
  EARTH_RADIUS_M,
  haversine,
  type LatLon,
  type LatLonBox,
  normalizeLon,
  pointToLatLon,
  type SphereSampleOptions,
  sampleCap,
  sampleLatLonBox,
  validateLatLon,
} from './geo/sphere.js'
export type { Point } from './types.js'
