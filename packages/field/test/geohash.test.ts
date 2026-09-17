import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { geohashDecode, geohashEncode, geohashNeighbours } from '../src/geo.js'
import { thrownCode } from './helpers/errors.js'

interface GeohashFixture {
  geohash: {
    encode: Array<{ lat: number; lon: number; precision: number; hash: string }>
    decode: Array<{ hash: string; lat: number; lon: number; latError: number; lonError: number }>
    neighbours: Array<Record<'hash' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw', string>>
  }
}
const { geohash } = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures', 'density.json'), 'utf8'),
) as GeohashFixture

describe('geohash (vs pygeohash)', () => {
  test('encode', () => {
    for (const e of geohash.encode) {
      expect(geohashEncode({ lat: e.lat, lon: e.lon }, e.precision)).toBe(e.hash)
    }
    expect(geohashEncode({ lat: 57.64911, lon: 10.40744 }, 11)).toBe('u4pruydqqvj') // Wikipedia
  })

  test('decode: centre and half-sizes; bounds contain the encoded point', () => {
    for (const d of geohash.decode) {
      const cell = geohashDecode(d.hash)
      expect(cell.lat).toBe(d.lat)
      expect(cell.lon).toBe(d.lon)
      expect(cell.latError).toBe(d.latError)
      expect(cell.lonError).toBe(d.lonError)
      expect(cell.north - cell.south).toBe(2 * d.latError)
    }
    for (const e of geohash.encode) {
      const cell = geohashDecode(e.hash)
      expect(e.lat).toBeGreaterThanOrEqual(cell.south)
      expect(e.lat).toBeLessThanOrEqual(cell.north)
      expect(e.lon).toBeGreaterThanOrEqual(cell.west)
      expect(e.lon).toBeLessThanOrEqual(cell.east)
    }
    expect(geohashDecode('EZS42')).toEqual(geohashDecode('ezs42'))
  })

  test('neighbours', () => {
    for (const n of geohash.neighbours) {
      const got = geohashNeighbours(n.hash)
      for (const dir of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const) {
        expect(got[dir]).toBe(n[dir])
      }
    }
  })

  test('neighbours wrap the antimeridian and stop at the poles', () => {
    const eastEdge = geohashEncode({ lat: 0.1, lon: 179.99 }, 3)
    const wrapped = geohashNeighbours(eastEdge).e as string
    expect(geohashDecode(wrapped).west).toBe(-180)
    const polar = geohashEncode({ lat: 89.99, lon: 10 }, 2)
    const around = geohashNeighbours(polar)
    expect(around.n).toBeNull()
    expect(around.ne).toBeNull()
    expect(around.nw).toBeNull()
    expect(around.s).not.toBeNull()
  })

  test('validation', () => {
    expect(thrownCode(() => geohashEncode({ lat: 0, lon: 0 }, 0))).toBe('invalid_config')
    expect(thrownCode(() => geohashEncode({ lat: 0, lon: 0 }, 23))).toBe('invalid_config')
    expect(thrownCode(() => geohashEncode({ lat: 91, lon: 0 }))).toBe('invalid_config')
    expect(thrownCode(() => geohashDecode(''))).toBe('invalid_config')
    expect(thrownCode(() => geohashDecode('ezs4a'))).toBe('invalid_config') // 'a' is not base-32 geohash
    expect(geohashEncode({ lat: 10, lon: 370 }, 6)).toBe(geohashEncode({ lat: 10, lon: 10 }, 6))
  })
})
