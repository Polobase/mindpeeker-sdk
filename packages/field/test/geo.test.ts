import { describe, expect, test } from 'bun:test'
import { bitReader, byteReader } from '@mindpeeker/oracle'
import {
  destination,
  EARTH_RADIUS_M,
  haversine,
  type LatLon,
  normalizeLon,
  pointToLatLon,
  sampleCap,
  sampleLatLonBox,
} from '../src/geo.js'
import { seededSource } from '../src/internal/prng.js'
import { prngBytes, trackedSource } from './helpers/byte-sources.js'
import { rejectedCode, thrownCode } from './helpers/errors.js'

const DEG_M = (EARTH_RADIUS_M * Math.PI) / 180 // metres per degree of great-circle arc ≈ 111195

describe('haversine', () => {
  test('one degree of longitude at the equator ≈ 111195 m', () => {
    expect(haversine({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(DEG_M, 2)
    expect(haversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(DEG_M, 2)
  })

  test('zero distance to self; across the antimeridian', () => {
    expect(haversine({ lat: 51.5, lon: -0.12 }, { lat: 51.5, lon: -0.12 })).toBe(0)
    expect(haversine({ lat: 0, lon: 179.5 }, { lat: 0, lon: -179.5 })).toBeCloseTo(DEG_M, 2)
  })

  test('rejects NaN and out-of-range latitudes', () => {
    expect(thrownCode(() => haversine({ lat: Number.NaN, lon: 0 }, { lat: 0, lon: 0 }))).toBe(
      'invalid_config',
    )
    expect(thrownCode(() => haversine({ lat: 95, lon: 0 }, { lat: 0, lon: 0 }))).toBe(
      'invalid_config',
    )
    expect(
      thrownCode(() => haversine({ lat: 0, lon: Number.POSITIVE_INFINITY }, { lat: 0, lon: 0 })),
    ).toBe('invalid_config')
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
    const d = destination(start, 1.1, 3200)
    expect(haversine(start, d)).toBeCloseTo(3200, 3)
  })

  test('longitude output stays in [-180, 180] and keeps an exact 180', () => {
    expect(destination({ lat: 10, lon: 180 }, 0, 0)).toEqual({ lat: 10, lon: 180 })
    expect(destination({ lat: 0, lon: -180 }, 1, 0).lon).toBe(-180)
    const east = destination({ lat: 0, lon: 179.5 }, Math.PI / 2, DEG_M)
    expect(east.lon).toBeCloseTo(-179.5, 6)
    const west = destination({ lat: 0, lon: -179.5 }, -Math.PI / 2, DEG_M)
    expect(west.lon).toBeCloseTo(179.5, 6)
    // over the pole
    const pole = destination({ lat: 89, lon: 10 }, 0, 2 * DEG_M)
    expect(pole.lat).toBeCloseTo(89, 6)
    expect(pole.lon).toBeCloseTo(-170, 6)
  })

  test('normalizeLon', () => {
    expect(normalizeLon(180)).toBe(180)
    expect(normalizeLon(-180)).toBe(-180)
    expect(normalizeLon(540)).toBe(180)
    expect(normalizeLon(190)).toBe(-170)
    expect(normalizeLon(-190)).toBe(170)
    expect(normalizeLon(-540)).toBe(-180)
  })

  test('validation', () => {
    expect(thrownCode(() => destination({ lat: 91, lon: 0 }, 0, 1))).toBe('invalid_config')
    expect(thrownCode(() => destination({ lat: 0, lon: 0 }, Number.NaN, 1))).toBe('invalid_config')
    expect(thrownCode(() => destination({ lat: 0, lon: 0 }, 0, Number.POSITIVE_INFINITY))).toBe(
      'invalid_config',
    )
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
      expect(haversine(centre, pointToLatLon(centre, p))).toBeCloseTo(Math.hypot(p.x, p.y), 2)
    }
  })

  test('+x is east, +y is north; the centre maps to itself', () => {
    const east = pointToLatLon({ lat: 0, lon: 0 }, { x: DEG_M, y: 0 })
    expect(east.lon).toBeGreaterThan(0)
    expect(east.lat).toBeCloseTo(0, 6)
    const north = pointToLatLon({ lat: 0, lon: 0 }, { x: 0, y: DEG_M })
    expect(north.lat).toBeGreaterThan(0)
    expect(north.lon).toBeCloseTo(0, 6)
    const centre: LatLon = { lat: 12.3, lon: 45.6 }
    expect(pointToLatLon(centre, { x: 0, y: 0 })).toEqual(centre)
    expect(thrownCode(() => pointToLatLon(centre, { x: Number.NaN, y: 0 }))).toBe('invalid_config')
  })
})

describe('sampleCap', () => {
  test('the angular distance is the exact inverse of the cap-area CDF', async () => {
    const bytes = prngBytes(8 * 200, 0xca9)
    const centre: LatLon = { lat: -33.87, lon: 151.21 }
    const radius = 2_000_000
    const cap = 1 - Math.cos(radius / EARTH_RADIUS_M)
    const reader = byteReader(bytes)
    for (let i = 0; i < 200; i++) {
      const u =
        ((bytes[8 * i] as number) * 2 ** 24 +
          ((bytes[8 * i + 1] as number) << 16) +
          ((bytes[8 * i + 2] as number) << 8) +
          (bytes[8 * i + 3] as number)) /
        2 ** 32
      const p = await sampleCap(reader, centre, radius)
      const theta = haversine(centre, p) / EARTH_RADIUS_M
      expect(Math.abs((1 - Math.cos(theta)) / cap - u)).toBeLessThan(1e-9)
    }
  })

  test('is area-uniform: half the samples fall inside the half-area cap, even around a pole', async () => {
    const reader = byteReader(seededSource(2n))
    const centre: LatLon = { lat: 88, lon: 0 }
    const radius = 3_000_000
    const halfTheta = Math.acos(1 - (1 - Math.cos(radius / EARTH_RADIUS_M)) / 2)
    let inner = 0
    const draws = 4000
    for (let i = 0; i < draws; i++) {
      const p = await sampleCap(reader, centre, radius)
      expect(p.lon).toBeGreaterThanOrEqual(-180)
      expect(p.lon).toBeLessThanOrEqual(180)
      const theta = haversine(centre, p) / EARTH_RADIUS_M
      expect(theta).toBeLessThanOrEqual(radius / EARTH_RADIUS_M + 1e-12)
      if (theta <= halfTheta) inner++
    }
    expect(Math.abs(inner / draws - 0.5)).toBeLessThan(3.1 * Math.sqrt(0.25 / draws))
  })

  test('accepts a bit reader (left open) and validates before reading', async () => {
    const bits = bitReader(byteReader(prngBytes(16, 1)))
    await sampleCap(bits, { lat: 0, lon: 0 }, 1000)
    expect(bits.bitsUsed).toBe(64)
    const source = trackedSource()
    expect(await rejectedCode(sampleCap(source, { lat: 100, lon: 0 }, 1000))).toBe('invalid_config')
    expect(await rejectedCode(sampleCap(source, { lat: 0, lon: 0 }, 0))).toBe('invalid_config')
    expect(await rejectedCode(sampleCap(source, { lat: 0, lon: 0 }, 1e9))).toBe('invalid_config')
    expect(source.streams).toBe(0)
    await sampleCap(source, { lat: 0, lon: 0 }, 1000)
    expect(source.released).toBe(1)
    expect(await rejectedCode(sampleCap(prngBytes(3), { lat: 0, lon: 0 }, 1000))).toBe(
      'insufficient_entropy',
    )
  })
})

describe('sampleLatLonBox', () => {
  test('latitudes are equal-area: sin(lat) is uniform', async () => {
    const reader = byteReader(seededSource(3n))
    const box = { south: 10, north: 70, west: -20, east: 40 }
    const s1 = Math.sin((10 * Math.PI) / 180)
    const s2 = Math.sin((70 * Math.PI) / 180)
    let lowerHalf = 0
    const draws = 4000
    for (let i = 0; i < draws; i++) {
      const p = await sampleLatLonBox(reader, box)
      expect(p.lat).toBeGreaterThanOrEqual(10 - 1e-9)
      expect(p.lat).toBeLessThanOrEqual(70 + 1e-9)
      expect(p.lon).toBeGreaterThanOrEqual(-20)
      expect(p.lon).toBeLessThan(40)
      if (Math.sin((p.lat * Math.PI) / 180) < (s1 + s2) / 2) lowerHalf++
    }
    expect(Math.abs(lowerHalf / draws - 0.5)).toBeLessThan(3.1 * Math.sqrt(0.25 / draws))
  })

  test('exact mapping and antimeridian crossing', async () => {
    const bytes = new Uint8Array([0, 0, 0, 0, 0x80, 0, 0, 0])
    const p = await sampleLatLonBox(bytes, { south: -30, north: 30, west: 170, east: -170 })
    expect(p.lat).toBeCloseTo(-30, 12)
    expect(p.lon).toBe(180) // 170 + ½·20 = 180 exactly, kept as 180
    const r = await sampleLatLonBox(new Uint8Array([0, 0, 0, 0, 0xc0, 0, 0, 0]), {
      south: -30,
      north: 30,
      west: 170,
      east: -170,
    })
    expect(r.lon).toBe(-175) // 170 + ¾·20 = 185 → wrapped
    const q = await sampleLatLonBox(new Uint8Array([0x80, 0, 0, 0, 0, 0, 0, 0]), {
      south: -30,
      north: 30,
      west: -10,
      east: 10,
    })
    expect(q.lat).toBeCloseTo(0, 12)
    expect(q.lon).toBe(-10)
  })

  test('validation', async () => {
    for (const box of [
      { south: 10, north: 10, west: 0, east: 1 },
      { south: -95, north: 10, west: 0, east: 1 },
      { south: 0, north: 10, west: 5, east: 5 },
      { south: 0, north: 10, west: 0, east: 181 },
    ]) {
      expect(await rejectedCode(sampleLatLonBox(prngBytes(8), box))).toBe('invalid_config')
    }
  })
})
