import { describe, expect, test } from 'bun:test'
import { destination, EARTH_RADIUS_M, haversine, type LatLon, pointToLatLon } from '../src/geo.js'

const DEG_M = (EARTH_RADIUS_M * Math.PI) / 180 // metres per degree of great-circle arc ≈ 111195

describe('haversine', () => {
  test('one degree of longitude at the equator ≈ 111195 m', () => {
    expect(haversine({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(DEG_M, 2)
    expect(haversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(DEG_M, 2)
  })

  test('zero distance to self', () => {
    expect(haversine({ lat: 51.5, lon: -0.12 }, { lat: 51.5, lon: -0.12 })).toBe(0)
  })
})

describe('destination', () => {
  test('due east from the equator lands one degree of longitude away', () => {
    const d = destination({ lat: 0, lon: 0 }, Math.PI / 2, DEG_M)
    expect(d.lat).toBeCloseTo(0, 6)
    expect(d.lon).toBeCloseTo(1, 4)
  })

  test('round-trips with haversine along a bearing', () => {
    const start: LatLon = { lat: 48.8566, lon: 2.3522 } // Paris
    const dist = 3200
    const d = destination(start, 1.1, dist)
    expect(haversine(start, d)).toBeCloseTo(dist, 3)
  })
})

describe('pointToLatLon', () => {
  test('a field point becomes a coordinate at the point distance from centre', () => {
    const centre: LatLon = { lat: 40.7128, lon: -74.006 } // NYC
    for (const p of [
      { x: 500, y: 0 },
      { x: 0, y: 800 },
      { x: -1200, y: 1600 },
    ]) {
      const geo = pointToLatLon(centre, p)
      expect(haversine(centre, geo)).toBeCloseTo(Math.hypot(p.x, p.y), 2)
    }
  })

  test('+x is east, +y is north', () => {
    const centre: LatLon = { lat: 0, lon: 0 }
    const east = pointToLatLon(centre, { x: DEG_M, y: 0 })
    expect(east.lon).toBeGreaterThan(0)
    expect(east.lat).toBeCloseTo(0, 6)
    const north = pointToLatLon(centre, { x: 0, y: DEG_M })
    expect(north.lat).toBeGreaterThan(0)
    expect(north.lon).toBeCloseTo(0, 6)
  })

  test('the centre maps to itself', () => {
    const centre: LatLon = { lat: 12.3, lon: 45.6 }
    expect(pointToLatLon(centre, { x: 0, y: 0 })).toEqual(centre)
  })
})
