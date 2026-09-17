import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { byteReader } from '@mindpeeker/oracle'
import {
  type KernelDensityOptions,
  kdeAttractor,
  kdeSignificance,
  kdeVoid,
  kernelDensity,
} from '../src/field/kde.js'
import { sampleField } from '../src/field/sample.js'
import { seededSource } from '../src/internal/prng.js'
import type { FieldRegion, Point } from '../src/types.js'
import { prngSource, trackedSource } from './helpers/byte-sources.js'
import { rejectedCode, thrownCode } from './helpers/errors.js'

interface DensityFixture {
  kde: Array<{
    label: string
    region: 'rect' | 'disk'
    options: KernelDensityOptions & { grid: [number, number] }
    xs: number[]
    ys: number[]
    values: number[]
    covariance: [number, number, number] | null
  }>
  pyrandonaut: Record<string, { x: number; y: number; density: number }>
}
const density = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures', 'density.json'), 'utf8'),
) as DensityFixture
const field = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures', 'field.json'), 'utf8')) as {
  cases: Array<{ label: string; points: Point[] }>
}
const stats = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures', 'stats.json'), 'utf8')) as {
  cases: Array<{ label: string; points: Point[] }>
}
const POINTS: Record<string, Point[]> = Object.fromEntries(
  [...field.cases, ...stats.cases.filter((c) => c.label === 'disk150')].map((c) => [
    c.label,
    c.points,
  ]),
)
const RECT: FieldRegion = { kind: 'rect', width: 100, height: 80 }
const DISK: FieldRegion = { kind: 'disk', radius: 50 }

describe('kernelDensity', () => {
  test('grids match scipy gaussian_kde (Scott, Silverman) and summed normal pdfs (fixed σ)', () => {
    for (const c of density.kde) {
      const points = POINTS[c.label.split('-')[0] as string] as Point[]
      const region = c.region === 'rect' ? RECT : DISK
      const kde = kernelDensity(points, region, c.options)
      expect([kde.gx, kde.gy]).toEqual(c.options.grid)
      expect(Array.from(kde.xs)).toEqual(c.xs)
      expect(Array.from(kde.ys)).toEqual(c.ys)
      c.values.forEach((want, i) => {
        expect(Math.abs((kde.values[i] as number) - want)).toBeLessThanOrEqual(
          1e-12 * want + 1e-300,
        )
      })
      if (c.covariance) {
        c.covariance.forEach((want, i) => {
          expect(Math.abs((kde.covariance[i] as number) - want)).toBeLessThanOrEqual(
            1e-12 * Math.abs(want),
          )
        })
      }
    }
  })

  test('kdeAttractor reproduces pyrandonaut calculate_kde (Silverman, 100×100 data-extent grid)', () => {
    for (const [label, want] of Object.entries(density.pyrandonaut)) {
      const got = kdeAttractor(POINTS[label] as Point[], RECT, {
        bandwidth: 'silverman',
        grid: 100,
        extent: 'data',
      })
      expect(got.point).toEqual({ x: want.x, y: want.y })
      expect(Math.abs(got.density - want.density)).toBeLessThan(1e-12 * want.density)
    }
  })

  test('kdeVoid is the minimum over nodes inside the region only', () => {
    const points = POINTS.disk150 as Point[]
    const kde = kernelDensity(points, DISK, { grid: 21 })
    const v = kdeVoid(points, DISK, { grid: 21 })
    expect(Math.hypot(v.point.x, v.point.y)).toBeLessThanOrEqual(50)
    let min = Number.POSITIVE_INFINITY
    for (let i = 0; i < kde.values.length; i++) {
      if (kde.inside[i] === 1) min = Math.min(min, kde.values[i] as number)
    }
    expect(v.density).toBe(min)
    expect(kde.inside[0]).toBe(0) // the bounding-box corner lies outside the disk
  })

  test('validation', () => {
    const points = POINTS.csr200 as Point[]
    expect(thrownCode(() => kernelDensity(points, RECT, { grid: 1 }))).toBe('invalid_config')
    expect(thrownCode(() => kernelDensity(points, RECT, { bandwidth: 0 }))).toBe('invalid_config')
    expect(thrownCode(() => kernelDensity(points, RECT, { bandwidth: 'ucv' as 'scott' }))).toBe(
      'invalid_config',
    )
    expect(thrownCode(() => kernelDensity(points, RECT, { extent: 'box' as 'data' }))).toBe(
      'invalid_config',
    )
    const line = [0, 1, 2, 3].map((i) => ({ x: 10 + i, y: 10 + i }))
    expect(thrownCode(() => kernelDensity(line, RECT))).toBe('insufficient_data')
    expect(thrownCode(() => kernelDensity(line, RECT, { bandwidth: 2, grid: 5 }))).toBe('no error')
  })
})

describe('kdeSignificance', () => {
  test('a planted cluster is a significant KDE attractor; the procedure is rerun per field', async () => {
    const reader = byteReader(seededSource(99n))
    const { points } = await sampleField(reader, 60, RECT)
    const cluster = Array.from({ length: 25 }, (_, i) => ({
      x: 70 + 1.5 * Math.cos(i),
      y: 20 + 1.5 * Math.sin(1.3 * i),
    }))
    const sig = await kdeSignificance(reader, [...points, ...cluster], RECT, { grid: 16, runs: 19 })
    expect(sig.attractor.p).toBe(1 / 20)
    expect(Math.hypot(sig.attractor.point.x - 70, sig.attractor.point.y - 20)).toBeLessThan(8)
    expect(sig.void.rank).toBeGreaterThanOrEqual(1)
    expect(sig.accounting.bytesConsumed).toBe(19 * 85 * 8)
  })

  test('under CSR the attractor p is not systematically small', async () => {
    const reader = byteReader(seededSource(1234n))
    let small = 0
    const fields = 40
    for (let f = 0; f < fields; f++) {
      const { points } = await sampleField(reader, 40, RECT)
      const sig = await kdeSignificance(reader, points, RECT, { grid: 10, runs: 9 })
      if (sig.attractor.p <= 0.1) small++
    }
    expect(small / fields).toBeLessThanOrEqual(0.1 + 3.1 * Math.sqrt(0.09 / fields))
  }, 30_000)

  test('validates before sampling, rejects replays, closes its stream', async () => {
    const source = trackedSource()
    const points = (POINTS.csr200 as Point[]).slice(0, 30)
    expect(await rejectedCode(kdeSignificance(source, points, RECT, { runs: 0 }))).toBe(
      'invalid_config',
    )
    expect(await rejectedCode(kdeSignificance(source, points, RECT, { grid: 3000 }))).toBe(
      'invalid_config',
    )
    expect(source.streams).toBe(0)
    await kdeSignificance(source, points, RECT, { runs: 2, grid: 5 })
    expect(source.released).toBe(1)
    const replay = prngSource('r', 5)
    const drawn = await sampleField(replay, 30, RECT)
    expect(
      await rejectedCode(kdeSignificance(replay, drawn.points, RECT, { runs: 2, grid: 5 })),
    ).toBe('invalid_config')
  })
})
