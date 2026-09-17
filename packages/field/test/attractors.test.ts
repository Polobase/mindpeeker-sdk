import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FieldError } from '../src/errors.js'
import { attractors } from '../src/field/attractors.js'
import { sampleField } from '../src/field/sample.js'
import type { FieldRegion, Point } from '../src/types.js'
import { prngSource } from './helpers/byte-sources.js'
import { thrownCode } from './helpers/errors.js'

interface HotspotFixture {
  point: Point
  neighbours: number
  expected: number
  power: number
  z: number
  pSingle: number
}
interface StatsFixtures {
  cases: Array<{
    label: string
    region: FieldRegion
    points: Point[]
    hotspots: {
      radius: number
      expectedNeighbours: number
      attractor: HotspotFixture
      void: HotspotFixture
    }
  }>
}
const fixtures = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures', 'stats.json'), 'utf8'),
) as StatsFixtures
const clustered = fixtures.cases.find(
  (c) => c.label === 'clustered210',
) as StatsFixtures['cases'][0]

/** Brute-force neighbour count within radius — independent reference. */
function neighbours(points: readonly Point[], i: number, radius: number): number {
  let c = 0
  const p = points[i] as Point
  for (let j = 0; j < points.length; j++) {
    if (j === i) continue
    const q = points[j] as Point
    if (Math.hypot(p.x - q.x, p.y - q.y) <= radius) c++
  }
  return c
}

function close(actual: number, expected: number, rel = 1e-12): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
    rel * Math.max(1e-300, Math.abs(expected)),
  )
}

describe('attractors', () => {
  test('matches scipy references: counts, clipped expectation, exact binomial tails', () => {
    for (const c of fixtures.cases) {
      const result = attractors(c.points, c.region)
      close(result.radius, c.hotspots.radius)
      close(result.expectedNeighbours, c.hotspots.expectedNeighbours)
      for (const which of ['attractor', 'void'] as const) {
        const got = result[which]
        const want = c.hotspots[which]
        expect(got.point).toEqual(want.point)
        expect(got.neighbours).toBe(want.neighbours)
        close(got.expected, want.expected, 1e-11)
        close(got.power, want.power, 1e-11)
        close(got.z, want.z, 1e-10)
        close(got.pSingle, want.pSingle, 1e-10)
        expect(got.pValue).toBe(got.pSingle)
      }
    }
  })

  test('attractor is the densest, void the sparsest neighbourhood', async () => {
    const region: FieldRegion = { kind: 'rect', width: 100, height: 80 }
    const { points } = await sampleField(prngSource('f', 0x1), 300, region)
    const result = attractors(points, region)
    let max = -1
    let min = Number.POSITIVE_INFINITY
    for (let i = 0; i < points.length; i++) {
      const c = neighbours(points, i, result.radius)
      if (c > max) max = c
      if (c < min) min = c
    }
    expect(result.attractor.neighbours).toBe(max)
    expect(result.void.neighbours).toBe(min)
  })

  test('the expectation is edge-corrected: a corner point expects about a quarter', () => {
    const region: FieldRegion = { kind: 'rect', width: 100, height: 100 }
    // a regular lattice with the corner point as the unique sparsest spot
    const points: Point[] = [{ x: 0, y: 0 }]
    for (let i = 1; i < 10; i++) for (let j = 1; j < 10; j++) points.push({ x: i * 10, y: j * 10 })
    const result = attractors(points, region, { radius: 5 })
    const n = points.length
    close(result.void.expected, ((n - 1) * Math.PI * 25) / 4 / 10_000, 1e-12)
    close(result.expectedNeighbours, ((n - 1) * Math.PI * 25) / 10_000, 1e-12)
  })

  test('the default radius targets (n − 1)πr²/A = expectedNeighbours', () => {
    const region: FieldRegion = { kind: 'rect', width: 100, height: 100 }
    const points: Point[] = [
      { x: 10, y: 10 },
      { x: 50, y: 50 },
      { x: 90, y: 20 },
      { x: 30, y: 70 },
    ]
    const result = attractors(points, region, { expectedNeighbours: 4 })
    close(result.expectedNeighbours, 4, 1e-12)
    close(result.radius, Math.sqrt((4 * 10_000) / (3 * Math.PI)), 1e-12)
  })

  test('a clustered field yields a highly significant single-point tail', () => {
    const result = attractors(clustered.points, clustered.region, { radius: 5 })
    expect(result.attractor.neighbours).toBeGreaterThan(result.attractor.expected)
    expect(result.attractor.pSingle).toBeLessThan(1e-6)
    expect(result.attractor.power).toBeGreaterThan(3)
    expect(result.clarkEvans.R).toBeLessThan(0.4)
  })

  test('is deterministic and order-invariant (shuffling points keeps the same hotspots)', async () => {
    const region: FieldRegion = { kind: 'rect', width: 100, height: 80 }
    const { points } = await sampleField(prngSource('f', 0x2), 200, region)
    const a = attractors(points, region)
    const b = attractors([...points].reverse(), region)
    expect(b.attractor).toEqual(a.attractor)
    expect(b.void).toEqual(a.void)
  })

  test('ties in count are broken by lexicographic coordinates', () => {
    const region: FieldRegion = { kind: 'rect', width: 10, height: 10 }
    // two isolated pairs with equal counts; the pair with the smaller x wins either order
    const points: Point[] = [
      { x: 8, y: 8 },
      { x: 8.5, y: 8 },
      { x: 1, y: 2 },
      { x: 1.5, y: 2 },
    ]
    for (const order of [points, [...points].reverse()]) {
      const result = attractors(order, region, { radius: 1 })
      expect(result.attractor.point).toEqual({ x: 1, y: 2 })
      expect(result.void.point).toEqual({ x: 1, y: 2 })
    }
  })

  test('validation', () => {
    const region: FieldRegion = { kind: 'rect', width: 10, height: 10 }
    const three: Point[] = [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]
    expect(() => attractors([{ x: 1, y: 1 }], region)).toThrow(FieldError)
    expect(() => attractors(three, region, { expectedNeighbours: 0 })).toThrow(FieldError)
    expect(thrownCode(() => attractors(three, region, { radius: 1, expectedNeighbours: 2 }))).toBe(
      'invalid_config',
    )
    expect(thrownCode(() => attractors([...three, { x: 11, y: 1 }], region))).toBe('invalid_config')
    expect(() => attractors([...three, { x: Number.NaN, y: 1 }], region)).toThrow(FieldError)
    expect(() => attractors(three, { kind: 'disk', radius: 2 })).toThrow(FieldError)
  })
})
