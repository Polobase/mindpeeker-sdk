import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { quadratTest } from '../src/field/quadrat.js'
import type { FieldRegion, Point } from '../src/types.js'
import { thrownCode } from './helpers/errors.js'

interface QuadratFixture {
  cases: Array<{
    label: string
    region: FieldRegion
    points: Point[]
    quadrat: {
      nx: number
      ny: number
      counts: number[]
      expected: number[]
      df: number
      pearson: number
      pearsonP: number
      pearsonClusteredP: number
      g2: number
      g2P: number
      dispersionIndex: number
    }
  }>
}
const fixtures = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures', 'stats.json'), 'utf8'),
) as QuadratFixture

function closeRel(actual: number, expected: number, rel = 1e-10): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(rel * Math.abs(expected) + 1e-300)
}

describe('quadratTest', () => {
  test('counts, expectations, X², G² and p-values match scipy (rect and clipped disk cells)', () => {
    for (const c of fixtures.cases) {
      const q = c.quadrat
      const pearson = quadratTest(c.points, c.region, q.nx, q.ny)
      expect(Array.from(pearson.counts)).toEqual(q.counts)
      q.expected.forEach((e, i) => {
        closeRel(pearson.expected[i] as number, e, 1e-11)
      })
      expect(pearson.df).toBe(q.df)
      closeRel(pearson.statistic, q.pearson)
      closeRel(pearson.pValue, q.pearsonP)
      closeRel(pearson.dispersionIndex, q.dispersionIndex)
      closeRel(pearson.dispersionP, q.pearsonP)
      const clusteredTail = quadratTest(c.points, c.region, q.nx, q.ny, {
        alternative: 'clustered',
      })
      closeRel(clusteredTail.pValue, q.pearsonClusteredP)
      const g2 = quadratTest(c.points, c.region, q.nx, q.ny, { statistic: 'g2' })
      expect(g2.statisticName).toBe('g2')
      closeRel(g2.statistic, q.g2)
      closeRel(g2.pValue, q.g2P)
    }
  })

  test('a clustered pattern is over-dispersed, a lattice under-dispersed', () => {
    const clustered = fixtures.cases.find(
      (c) => c.label === 'clustered210',
    ) as QuadratFixture['cases'][0]
    const over = quadratTest(clustered.points, clustered.region, 5, 4, { alternative: 'clustered' })
    expect(over.dispersionIndex).toBeGreaterThan(5)
    expect(over.pValue).toBeLessThan(1e-10)
    const lattice: Point[] = []
    for (let i = 0; i < 10; i++)
      for (let j = 0; j < 8; j++) lattice.push({ x: 5 + 10 * i, y: 5 + 10 * j })
    const under = quadratTest(lattice, { kind: 'rect', width: 100, height: 80 }, 5, 4, {
      alternative: 'regular',
    })
    expect(under.statistic).toBe(0)
    expect(under.dispersionIndex).toBe(0)
    expect(under.pValue).toBeLessThan(1e-4)
  })

  test('validation', () => {
    const c = fixtures.cases[0] as QuadratFixture['cases'][0]
    expect(thrownCode(() => quadratTest(c.points, c.region, 0, 4))).toBe('invalid_config')
    expect(thrownCode(() => quadratTest(c.points, c.region, 1.5, 4))).toBe('invalid_config')
    expect(thrownCode(() => quadratTest(c.points, c.region, 1, 1))).toBe('insufficient_data')
    expect(
      thrownCode(() => quadratTest(c.points, c.region, 2, 2, { statistic: 'cr' as 'g2' })),
    ).toBe('invalid_config')
    expect(
      thrownCode(() => quadratTest(c.points, c.region, 2, 2, { alternative: 'less' as 'regular' })),
    ).toBe('invalid_config')
  })
})
