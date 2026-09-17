import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ripleyL } from '../src/field/csr.js'
import { type KCorrection, type KDenominator, ripleyK } from '../src/field/ripley.js'
import type { FieldRegion, Point } from '../src/types.js'
import { thrownCode } from './helpers/errors.js'

interface StatsFixtures {
  cases: Array<{
    label: string
    region: FieldRegion
    points: Point[]
    radii: number[]
    ripleyK: Record<string, Array<number | null>>
  }>
}
const fixtures = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures', 'stats.json'), 'utf8'),
) as StatsFixtures

describe('ripleyK', () => {
  test('every correction × denominator matches the scipy-quadrature reference (rect and disk)', () => {
    let compared = 0
    for (const c of fixtures.cases) {
      for (const [key, values] of Object.entries(c.ripleyK)) {
        const [correction, denominator] = key.split('|') as [KCorrection, KDenominator]
        const k = ripleyK(c.points, c.region, c.radii, { correction, denominator })
        expect(k.correction).toBe(correction)
        expect(k.denominator).toBe(denominator)
        values.forEach((want, i) => {
          const got = k.k[i] as number
          if (want === null) {
            expect(Number.isNaN(got)).toBe(true)
          } else {
            expect(Math.abs(got - want)).toBeLessThanOrEqual(1e-11 * Math.abs(want) + 1e-12)
            expect(k.l[i] as number).toBeCloseTo(Math.sqrt(want / Math.PI), 10)
            expect(k.centered[i] as number).toBeCloseTo(
              Math.sqrt(want / Math.PI) - (c.radii[i] as number),
              10,
            )
          }
          compared++
        })
      }
    }
    expect(compared).toBe(2 * 8 * 6 + 8 * 4)
  })

  test('defaults are the isotropic correction with spatstat’s n(n−1) normalisation', () => {
    const c = fixtures.cases[0] as StatsFixtures['cases'][0]
    const k = ripleyK(c.points, c.region, c.radii)
    expect(k.correction).toBe('isotropic')
    expect(k.denominator).toBe('n(n-1)')
    expect(Array.from(k.k)).toEqual(
      Array.from(ripleyK(c.points, c.region, c.radii, { correction: 'isotropic' }).k),
    )
  })

  test('edge corrections remove the downward drift of the uncorrected CSR estimate', () => {
    const c = fixtures.cases.find((x) => x.label === 'csr200') as StatsFixtures['cases'][0]
    const radii = [14]
    const none = ripleyK(c.points, c.region, radii, { correction: 'none' }).centered[0] as number
    for (const correction of ['isotropic', 'translation', 'border'] as const) {
      const corrected = ripleyK(c.points, c.region, radii, { correction }).centered[0] as number
      expect(Math.abs(corrected)).toBeLessThan(Math.abs(none))
    }
  })

  test('radii order is preserved and ripleyL is the 0.1 estimator', () => {
    const c = fixtures.cases[1] as StatsFixtures['cases'][0]
    const shuffled = [10, 2, 14, 6]
    const k = ripleyK(c.points, c.region, shuffled, { correction: 'translation' })
    const sorted = ripleyK(c.points, c.region, [2, 6, 10, 14], { correction: 'translation' })
    expect(Array.from(k.k)).toEqual([2, 0, 3, 1].map((i) => sorted.k[i] as number))
    expect(Array.from(ripleyL(c.points, c.region, shuffled))).toEqual(
      Array.from(
        ripleyK(c.points, c.region, shuffled, { correction: 'none', denominator: 'n2' }).centered,
      ),
    )
  })

  test('validation', () => {
    const c = fixtures.cases[0] as StatsFixtures['cases'][0]
    expect(thrownCode(() => ripleyK(c.points, c.region, []))).toBe('invalid_config')
    expect(thrownCode(() => ripleyK(c.points, c.region, [Number.NaN]))).toBe('invalid_config')
    expect(thrownCode(() => ripleyK(c.points, c.region, [-1]))).toBe('invalid_config')
    expect(
      thrownCode(() =>
        ripleyK(c.points, c.region, [1], { correction: 'rigid' as unknown as KCorrection }),
      ),
    ).toBe('invalid_config')
    expect(
      thrownCode(() =>
        ripleyK(c.points, c.region, [1], { denominator: 'n' as unknown as KDenominator }),
      ),
    ).toBe('invalid_config')
    expect(thrownCode(() => ripleyK(c.points.slice(0, 1), c.region, [1]))).toBe('insufficient_data')
    expect(thrownCode(() => ripleyK(c.points, { kind: 'disk', radius: 10 }, [1]))).toBe(
      'invalid_config',
    )
  })
})
