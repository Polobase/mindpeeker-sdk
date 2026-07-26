import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FieldError } from '../src/errors.js'
import { clarkEvans, csrEnvelope, ripleyL } from '../src/field/csr.js'
import { sampleField } from '../src/field/sample.js'
import type { FieldRegion, Point } from '../src/types.js'
import { prngSource } from './helpers/byte-sources.js'

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

const csrCase = fixtures.cases.find((c) => c.label === 'csr200') as FieldFixtures['cases'][0]
const clusteredCase = fixtures.cases.find(
  (c) => c.label === 'clustered210',
) as FieldFixtures['cases'][0]

describe('clarkEvans', () => {
  test('matches the numpy fixture (CSR and clustered)', () => {
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

  test('validation', () => {
    expect(() => clarkEvans([{ x: 1, y: 1 }] as Point[], csrCase.region)).toThrow(FieldError)
  })
})

describe('ripleyL', () => {
  test('matches the numpy fixture at every radius', () => {
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

describe('csrEnvelope', () => {
  const region: FieldRegion = { kind: 'rect', width: 100, height: 80 }
  const radii = [2, 4, 6, 8, 10, 14]

  test('a fresh CSR field sits inside its own envelope', async () => {
    // build the envelope from independent CSR runs, then draw one more CSR field
    const env = await csrEnvelope(prngSource('csr', 0xa1), 150, region, radii, 40)
    const { points } = await sampleField(prngSource('csr', 0xb2), 150, region)
    const observed = ripleyL(points, region, radii)
    let inside = 0
    for (let k = 0; k < radii.length; k++) {
      if (
        (observed[k] as number) >= (env.lo[k] as number) &&
        (observed[k] as number) <= (env.hi[k] as number)
      ) {
        inside++
      }
    }
    expect(inside).toBeGreaterThanOrEqual(radii.length - 1) // at most one pointwise excursion
  })

  test('a clustered field pokes above the CSR envelope', async () => {
    const env = await csrEnvelope(prngSource('csr', 0xc3), 210, region, radii, 40)
    const observed = ripleyL(clusteredCase.points, region, radii)
    let above = 0
    for (let k = 0; k < radii.length; k++)
      if ((observed[k] as number) > (env.hi[k] as number)) above++
    expect(above).toBeGreaterThan(3) // clustering exceeds the null band at most scales
  })

  test('validation', () => {
    expect(csrEnvelope(prngSource('u', 1), 1, region, radii)).rejects.toMatchObject({
      code: 'invalid_config',
    })
    expect(csrEnvelope(prngSource('u', 1), 10, region, radii, 0)).rejects.toMatchObject({
      code: 'invalid_config',
    })
  })
})
