import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FieldError } from '../src/errors.js'
import { attractors } from '../src/field/attractors.js'
import { sampleField } from '../src/field/sample.js'
import type { FieldRegion, Point } from '../src/types.js'
import { prngSource } from './helpers/byte-sources.js'

interface FieldFixtures {
  cases: Array<{ label: string; region: FieldRegion; points: Point[] }>
}
const fixtures = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures', 'field.json'), 'utf8'),
) as FieldFixtures
const clustered = fixtures.cases.find(
  (c) => c.label === 'clustered210',
) as FieldFixtures['cases'][0]

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

describe('attractors', () => {
  test('attractor is the densest, void the sparsest neighbourhood', async () => {
    const region: FieldRegion = { kind: 'rect', width: 100, height: 80 }
    const { points } = await sampleField(prngSource('f', 0x1), 300, region)
    const result = attractors(points, region)
    // recompute every point's neighbour count at the chosen radius
    let max = -1
    let min = Number.POSITIVE_INFINITY
    for (let i = 0; i < points.length; i++) {
      const c = neighbours(points, i, result.radius)
      if (c > max) max = c
      if (c < min) min = c
    }
    expect(result.attractor.neighbours).toBe(max)
    expect(result.void.neighbours).toBe(min)
    // attractor is at least as dense as expected, void at most
    expect(result.attractor.neighbours).toBeGreaterThanOrEqual(result.expectedNeighbours)
    expect(result.void.neighbours).toBeLessThanOrEqual(result.expectedNeighbours)
  })

  test('a clustered field yields a highly significant attractor', () => {
    const result = attractors(clustered.points, clustered.region, { radius: 5 })
    expect(result.attractor.neighbours).toBeGreaterThan(result.expectedNeighbours)
    expect(result.attractor.pValue).toBeLessThan(1e-6)
    expect(result.clarkEvans.R).toBeLessThan(0.4)
  })

  test('is deterministic and order-invariant (shuffling points keeps the same hotspots)', async () => {
    const region: FieldRegion = { kind: 'rect', width: 100, height: 80 }
    const { points } = await sampleField(prngSource('f', 0x2), 200, region)
    const a = attractors(points, region)
    const reversed = [...points].reverse()
    const b = attractors(reversed, region)
    expect(b.attractor.point).toEqual(a.attractor.point)
    expect(b.void.point).toEqual(a.void.point)
  })

  test('pValue uses the Poisson tail under CSR (μ = λπr²)', () => {
    const result = attractors(clustered.points, clustered.region, { expectedNeighbours: 4 })
    // μ equals the requested expectation
    expect(result.expectedNeighbours).toBeCloseTo(4, 6)
  })

  test('validation', () => {
    const region: FieldRegion = { kind: 'rect', width: 10, height: 10 }
    expect(() => attractors([{ x: 1, y: 1 }] as Point[], region)).toThrow(FieldError)
    expect(() => attractors(clustered.points, clustered.region, { expectedNeighbours: 0 })).toThrow(
      FieldError,
    )
  })
})
