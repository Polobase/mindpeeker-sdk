// Small geographic helpers the page needs around the SDK's `@mindpeeker/field/geo`
// exports: an initial bearing (the package gives distance and destination, not
// the bearing between two points), a compass label, and link-out formatting.
//
// CLIENT ONLY (it imports the SDK for the Earth radius).

import { EARTH_RADIUS_M, type LatLon } from '@mindpeeker/field/geo'

const D2R = Math.PI / 180
const R2D = 180 / Math.PI

/**
 * Initial great-circle bearing from `a` to `b`, in radians clockwise from
 * north — the inverse of the package's `destination(a, bearing, distance)`,
 * which the Geo section uses as a round-trip check.
 */
export function initialBearing(a: LatLon, b: LatLon): number {
  const φ1 = a.lat * D2R
  const φ2 = b.lat * D2R
  const Δλ = (b.lon - a.lon) * D2R
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  const θ = Math.atan2(y, x)
  return (θ + 2 * Math.PI) % (2 * Math.PI)
}

const COMPASS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
] as const

/** 16-point compass label for a bearing in radians. */
export function compassPoint(bearingRad: number): string {
  const deg = ((bearingRad * R2D) % 360 + 360) % 360
  return COMPASS[Math.round(deg / 22.5) % 16] as string
}

export function bearingDegrees(bearingRad: number): number {
  return ((bearingRad * R2D) % 360 + 360) % 360
}

/** Six decimals ≈ 0.11 m — enough for a geohash-9 cell, short enough to read. */
export function formatCoord(p: LatLon, digits = 6): string {
  return `${p.lat.toFixed(digits)}, ${p.lon.toFixed(digits)}`
}

/** A plain coordinate link-out. No map tiles are loaded by this page. */
export function osmLink(p: LatLon, zoom = 15): string {
  return `https://www.openstreetmap.org/?mlat=${p.lat.toFixed(6)}&mlon=${p.lon.toFixed(6)}#map=${zoom}/${p.lat.toFixed(6)}/${p.lon.toFixed(6)}`
}

/**
 * Relative area distortion of the azimuthal-equidistant `pointToLatLon` map at
 * radius r: of order (r/R)². `sampleCap` has none at any radius.
 */
export function planarDistortion(radiusM: number): number {
  const x = radiusM / EARTH_RADIUS_M
  return x * x
}

export interface Place {
  label: string
  lat: number
  lon: number
}

/** Start points that are easy to sanity-check against a known geohash prefix. */
export const PLACES: readonly Place[] = [
  { label: 'New York, NY', lat: 40.7128, lon: -74.006 },
  { label: 'Berlin', lat: 52.52, lon: 13.405 },
  { label: 'Tokyo', lat: 35.6895, lon: 139.6917 },
  { label: 'Quito (equator)', lat: -0.1807, lon: -78.4678 },
  { label: 'Suva (near the antimeridian)', lat: -18.1416, lon: 178.4419 },
  { label: 'Longyearbyen (79° N)', lat: 78.2232, lon: 15.6469 },
]

export function isLat(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90
}

export function isLon(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180
}
