import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { byteReader } from '@mindpeeker/oracle'
import { ripleyL } from '../src/field/csr.js'
import { csrEnvelope } from '../src/field/envelope.js'
import { globalTests } from '../src/field/global-envelope.js'
import { sampleField } from '../src/field/sample.js'
import { seededSource } from '../src/internal/prng.js'
import type { FieldRegion, Point } from '../src/types.js'
import { prngBytes, prngSource, trackedSource } from './helpers/byte-sources.js'
import { rejectedCode } from './helpers/errors.js'

interface EnvelopeFixture {
  envelopes: Array<{
    label: string
    alpha: number
    curves: number[][]
    rank: number
    pInterval: [number, number]
    pErl: number
    lower: number[] | null
    upper: number[] | null
    madStatistic: number
    madP: number
    pointwiseP: number[]
  }>
}
const density = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures', 'density.json'), 'utf8'),
) as EnvelopeFixture
const field = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures', 'field.json'), 'utf8')) as {
  cases: Array<{ label: string; points: Point[] }>
}
const clustered = (field.cases.find((c) => c.label === 'clustered210') as { points: Point[] })
  .points

const REGION: FieldRegion = { kind: 'rect', width: 100, height: 80 }
const RADII = [2, 4, 6, 8, 10, 14]

describe('global envelope tests (definitions of Myllymäki et al. 2017 and Diggle 1979)', () => {
  test('rank, p-interval, ERL p, global band, MAD and pointwise p match the numpy reference', () => {
    for (const e of density.envelopes) {
      const t = globalTests(
        e.curves.map((c) => Float64Array.from(c)),
        e.alpha,
      )
      expect(t.rank.rank).toBe(e.rank)
      expect(t.rank.pInterval[0]).toBeCloseTo(e.pInterval[0], 14)
      expect(t.rank.pInterval[1]).toBeCloseTo(e.pInterval[1], 14)
      expect(t.rank.p).toBeCloseTo(e.pErl, 14)
      expect(t.rank.lower ? Array.from(t.rank.lower) : null).toEqual(e.lower)
      expect(t.rank.upper ? Array.from(t.rank.upper) : null).toEqual(e.upper)
      expect(t.mad.statistic).toBeCloseTo(e.madStatistic, 12)
      expect(t.mad.p).toBeCloseTo(e.madP, 14)
      expect(Array.from(t.pointwiseP)).toEqual(e.pointwiseP)
    }
  })
})

describe('csrEnvelope', () => {
  test('computes the observed curve and rejects a clustered field globally', async () => {
    const env = await csrEnvelope(clustered, prngSource('csr', 0xc3), REGION, RADII, { runs: 39 })
    expect(Array.from(env.observed)).toEqual(Array.from(ripleyL(clustered, REGION, RADII)))
    expect(env.global.p).toBe(1 / 40)
    expect(env.global.mad.p).toBe(1 / 40)
    expect(env.simulations.length).toBe(39)
    expect(env.correction).toBe('none')
    expect(env.denominator).toBe('n2')
    let above = 0
    for (let k = 0; k < RADII.length; k++) {
      if ((env.observed[k] as number) > (env.hi[k] as number)) above++
      expect(env.pointwiseP[k]).toBe(2 / 40)
    }
    expect(above).toBe(RADII.length)
  })

  test('global p is calibrated under CSR; scanning the pointwise band is not', async () => {
    const reader = byteReader(seededSource(424242n))
    const fields = 150
    const runs = 19
    let globalRejects = 0
    let madRejects = 0
    let anyExcursion = 0
    for (let f = 0; f < fields; f++) {
      const { points } = await sampleField(reader, 50, REGION)
      const env = await csrEnvelope(points, reader, REGION, RADII, { runs })
      if (env.global.p <= 0.05) globalRejects++
      if (env.global.mad.p <= 0.05) madRejects++
      const outside = RADII.some(
        (_, k) =>
          (env.observed[k] as number) < (env.lo[k] as number) ||
          (env.observed[k] as number) > (env.hi[k] as number),
      )
      if (outside) anyExcursion++
    }
    const band = 0.05 + 3.1 * Math.sqrt((0.05 * 0.95) / fields)
    expect(globalRejects / fields).toBeLessThanOrEqual(band)
    expect(madRejects / fields).toBeLessThanOrEqual(band)
    // the min/max band is a 2/(runs+1) = 0.10 test at ONE radius; across six radii far more
    expect(anyExcursion / fields).toBeGreaterThan(0.15)
  }, 60_000)

  test('a replayed batch or restarting source throws instead of returning a powerless band', async () => {
    const bytes = prngBytes(120_000, 0x1234)
    const { points } = await sampleField(bytes, 150, REGION)
    expect(await rejectedCode(csrEnvelope(points, bytes, REGION, RADII, { runs: 5 }))).toBe(
      'invalid_config',
    )
    const restarting = prngSource('csr', 0xa1)
    const observed = await sampleField(restarting, 150, REGION)
    expect(
      await rejectedCode(csrEnvelope(observed.points, restarting, REGION, RADII, { runs: 5 })),
    ).toBe('invalid_config')
    // one shared reader keeps the bytes disjoint
    const reader = byteReader(prngSource('csr', 0xa1))
    const shared = await sampleField(reader, 150, REGION)
    const env = await csrEnvelope(shared.points, reader, REGION, RADII, { runs: 5 })
    expect(env.accounting.bytesConsumed).toBe(5 * 150 * 8)
  })

  test('supports the edge-corrected estimators', async () => {
    const env = await csrEnvelope(clustered, prngSource('e', 7), REGION, RADII, {
      runs: 19,
      correction: 'isotropic',
      denominator: 'n(n-1)',
      alpha: 0.1,
    })
    expect(env.correction).toBe('isotropic')
    expect(env.global.rank.alpha).toBe(0.1)
    expect(env.global.rank.lower).toBeInstanceOf(Float64Array)
    expect(env.global.p).toBe(1 / 20)
  })

  test('the deprecated 0.1 signature still returns a band', async () => {
    const env = await csrEnvelope(prngSource('csr', 0xa1), 150, REGION, RADII, 40)
    const { points } = await sampleField(prngSource('csr', 0xb2), 150, REGION)
    const observed = ripleyL(points, REGION, RADII)
    let inside = 0
    for (let k = 0; k < RADII.length; k++) {
      const v = observed[k] as number
      if (v >= (env.lo[k] as number) && v <= (env.hi[k] as number)) inside++
    }
    expect(inside).toBeGreaterThanOrEqual(RADII.length - 1)
    expect(env.runs).toBe(40)
    expect(env.accounting.bytesConsumed).toBe(40 * 150 * 8)
    expect('global' in env).toBe(false)
  })

  test('validates radii, runs, points and options before touching the source', async () => {
    const source = trackedSource()
    const pts = clustered.slice(0, 20)
    const cases = [
      csrEnvelope(pts, source, REGION, []),
      csrEnvelope(pts, source, REGION, [Number.NaN]),
      csrEnvelope(pts, source, REGION, RADII, { runs: 0 }),
      csrEnvelope(pts, source, REGION, RADII, { alpha: 2 }),
      csrEnvelope(pts, source, REGION, RADII, { correction: 'rigid' as unknown as 'none' }),
      csrEnvelope([{ x: -5, y: 1 }, ...pts], source, REGION, RADII),
      csrEnvelope(pts.slice(0, 1), source, REGION, RADII),
      csrEnvelope(source, 1, REGION, RADII),
      csrEnvelope(source, 10, REGION, RADII, 0),
      csrEnvelope(source, 10, REGION, [], 5),
      csrEnvelope(pts, 42 as unknown as Uint8Array, REGION, RADII, { runs: 1 }),
    ]
    for (const run of cases) {
      expect(['invalid_config', 'insufficient_data']).toContain(await rejectedCode(run))
    }
    expect(source.streams).toBe(0)
    await csrEnvelope(pts, source, REGION, RADII, { runs: 2 })
    expect(source.released).toBe(1)
  })

  test('aborts and runs out of entropy with typed codes', async () => {
    const controller = new AbortController()
    controller.abort()
    expect(
      await rejectedCode(
        csrEnvelope(clustered, prngSource('a', 1), REGION, RADII, { signal: controller.signal }),
      ),
    ).toBe('aborted')
    expect(
      await rejectedCode(csrEnvelope(clustered, prngBytes(1000, 3), REGION, RADII, { runs: 9 })),
    ).toBe('insufficient_entropy')
  })
})
