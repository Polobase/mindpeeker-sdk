import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { byteReader } from '@mindpeeker/oracle'
import { sampleField } from '../src/field/sample.js'
import { scanStatistic } from '../src/field/scan.js'
import { seededSource } from '../src/internal/prng.js'
import type { FieldRegion, Point } from '../src/types.js'
import { trackedSource } from './helpers/byte-sources.js'
import { rejectedCode } from './helpers/errors.js'

interface ScanFixture {
  scan: Array<{
    label: string
    points: Point[]
    llr: number
    cluster: { center: Point; radius: number; count: number; expected: number } | null
  }>
}
const density = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures', 'density.json'), 'utf8'),
) as ScanFixture
const RECT: FieldRegion = { kind: 'rect', width: 100, height: 80 }

describe('scanStatistic', () => {
  test('most likely cluster and LLR match a brute-force scipy-quadrature scan', async () => {
    for (const s of density.scan) {
      const result = await scanStatistic(s.points, RECT, { runs: 1 })
      expect(Math.abs(result.llr - s.llr)).toBeLessThanOrEqual(1e-10 * s.llr)
      const cluster = s.cluster
      if (cluster === null) {
        expect(result.cluster).toBeUndefined()
        continue
      }
      expect(result.cluster?.center).toEqual(cluster.center)
      expect(result.cluster?.count).toBe(cluster.count)
      expect(result.cluster?.radius).toBe(cluster.radius)
      expect(Math.abs((result.cluster?.expected ?? 0) - cluster.expected)).toBeLessThan(
        1e-10 * cluster.expected,
      )
      const c = result.cluster
      if (c) {
        const n = s.points.length
        expect(c.relativeRisk).toBeCloseTo(
          c.count / c.expected / ((n - c.count) / (n - c.expected)),
          12,
        )
      }
    }
  })

  test('detects the planted cluster; the default seeded null is reproducible', async () => {
    const mixed = density.scan.find((s) => s.label === 'mixed60') as ScanFixture['scan'][0]
    const a = await scanStatistic(mixed.points, RECT, { runs: 99 })
    const b = await scanStatistic(mixed.points, RECT, { runs: 99 })
    expect(a.pValue).toBe(0.01)
    expect(a).toEqual(b)
    expect(a.seed).toBe(0n)
    const other = await scanStatistic(mixed.points, RECT, { runs: 99, seed: 7 })
    expect(other.seed).toBe(7n)
    expect(other.accounting.bytesConsumed).toBe(99 * 60 * 8)
  })

  test('under CSR the Monte-Carlo p is calibrated', async () => {
    const reader = byteReader(seededSource(31337n))
    const fields = 60
    let hits = 0
    for (let f = 0; f < fields; f++) {
      const { points } = await sampleField(reader, 30, RECT)
      const result = await scanStatistic(points, RECT, { runs: 19, source: reader })
      if (result.pValue <= 0.05) hits++
      expect(result.seed).toBeUndefined()
    }
    expect(hits / fields).toBeLessThanOrEqual(0.05 + 3.1 * Math.sqrt((0.05 * 0.95) / fields))
  }, 60_000)

  test('validation happens before sampling; the stream is closed', async () => {
    const source = trackedSource()
    const pts = (density.scan[1] as ScanFixture['scan'][0]).points
    for (const run of [
      scanStatistic(pts, RECT, { source, runs: 0 }),
      scanStatistic(pts, RECT, { source, maxFraction: 0.8 }),
      scanStatistic(pts, RECT, { source, seed: 3 }),
      scanStatistic(pts, RECT, { seed: -1 }),
      scanStatistic(pts.slice(0, 2), RECT, { source }),
    ]) {
      expect(['invalid_config', 'insufficient_data']).toContain(await rejectedCode(run))
    }
    expect(source.streams).toBe(0)
    await scanStatistic(pts, RECT, { source, runs: 1 })
    expect(source.released).toBe(1)
  })
})
