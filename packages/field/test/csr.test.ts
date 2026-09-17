import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FieldError } from '../src/errors.js'
import { clarkEvans, ripleyL } from '../src/field/csr.js'
import type { FieldRegion, Point } from '../src/types.js'
import { thrownCode } from './helpers/errors.js'

interface FieldFixtures {
  cases: Array<{
    label: string
    region: FieldRegion
    points: Point[]
    clarkEvans: { meanNearest: number; expectedNearest: number; R: number; z: number }
    radii: number[]
    ripleyL: number[]
  }>
}
const fixtures = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures', 'field.json'), 'utf8'),
) as FieldFixtures

interface DonnellyFixture {
  cases: Array<{
    label: string
    region: FieldRegion
    points: Point[]
    clarkEvansDonnelly?: {
      meanNearest: number
      expectedNearest: number
      R: number
      z: number
      pValue: number
    }
  }>
}
const stats = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures', 'stats.json'), 'utf8'),
) as DonnellyFixture

const csrCase = fixtures.cases.find((c) => c.label === 'csr200') as FieldFixtures['cases'][0]
const clusteredCase = fixtures.cases.find(
  (c) => c.label === 'clustered210',
) as FieldFixtures['cases'][0]

describe('clarkEvans', () => {
  test('0.1 estimator still matches the numpy fixture (CSR and clustered)', () => {
    for (const c of [csrCase, clusteredCase]) {
      const result = clarkEvans(c.points, c.region)
      expect(result.meanNearest).toBeCloseTo(c.clarkEvans.meanNearest, 10)
      expect(result.expectedNearest).toBeCloseTo(c.clarkEvans.expectedNearest, 10)
      expect(result.R).toBeCloseTo(c.clarkEvans.R, 10)
      expect(result.z).toBeCloseTo(c.clarkEvans.z, 9)
    }
  })

  test('CSR ≈ 1, clustered ≪ 1 with a hugely negative z', () => {
    expect(clarkEvans(csrCase.points, csrCase.region).R).toBeGreaterThan(0.95)
    const clustered = clarkEvans(clusteredCase.points, clusteredCase.region)
    expect(clustered.R).toBeLessThan(0.4)
    expect(clustered.z).toBeLessThan(-10)
    expect(clustered.pValue).toBeLessThan(1e-6)
  })

  test('Donnelly correction matches the spatstat formula (scipy nearest neighbours)', () => {
    for (const c of stats.cases) {
      const want = c.clarkEvansDonnelly
      if (!want) continue
      const got = clarkEvans(c.points, c.region, { correction: 'donnelly' })
      expect(got.correction).toBe('donnelly')
      expect(got.meanNearest).toBeCloseTo(want.meanNearest, 10)
      expect(got.expectedNearest).toBeCloseTo(want.expectedNearest, 10)
      expect(got.R).toBeCloseTo(want.R, 12)
      expect(got.z).toBeCloseTo(want.z, 10)
      expect(Math.abs(got.pValue - want.pValue)).toBeLessThanOrEqual(1e-12 * want.pValue + 1e-300)
    }
  })

  test('Donnelly removes the dispersion bias of CSR fields in a small window', () => {
    const c = stats.cases.find((x) => x.label === 'csr200') as DonnellyFixture['cases'][0]
    const none = clarkEvans(c.points, c.region)
    const donnelly = clarkEvans(c.points, c.region, { correction: 'donnelly' })
    expect(donnelly.expectedNearest).toBeGreaterThan(none.expectedNearest)
    expect(donnelly.R).toBeLessThan(none.R)
  })

  test('validation', () => {
    expect(() => clarkEvans([{ x: 1, y: 1 }] as Point[], csrCase.region)).toThrow(FieldError)
    expect(
      thrownCode(() =>
        clarkEvans(
          [
            { x: 1, y: 1 },
            { x: 101, y: 1 },
          ],
          csrCase.region,
        ),
      ),
    ).toBe('invalid_config')
    const disk: FieldRegion = { kind: 'disk', radius: 5 }
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]
    expect(thrownCode(() => clarkEvans(pts, disk, { correction: 'donnelly' }))).toBe(
      'invalid_config',
    )
    expect(thrownCode(() => clarkEvans(pts, disk))).toBe('no error')
  })
})

describe('ripleyL', () => {
  test('0.1 estimator (A/n², no correction) still matches the numpy fixture', () => {
    for (const c of [csrCase, clusteredCase]) {
      const l = ripleyL(c.points, c.region, c.radii)
      for (let k = 0; k < c.radii.length; k++) {
        expect(l[k] as number).toBeCloseTo(c.ripleyL[k] as number, 9)
      }
    }
  })

  test('clustered L(r) − r is strongly positive; CSR stays near 0', () => {
    const clustered = ripleyL(clusteredCase.points, clusteredCase.region, clusteredCase.radii)
    for (const v of clustered) expect(v).toBeGreaterThan(1)
    const csr = ripleyL(csrCase.points, csrCase.region, [4, 6, 8])
    for (const v of csr) expect(Math.abs(v)).toBeLessThan(2)
  })

  test('validation', () => {
    expect(() => ripleyL(csrCase.points, csrCase.region, [])).toThrow(FieldError)
    expect(() => ripleyL(csrCase.points, csrCase.region, [-1])).toThrow(FieldError)
  })
})
