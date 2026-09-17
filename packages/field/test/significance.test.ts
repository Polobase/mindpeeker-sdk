import { describe, expect, test } from 'bun:test'
import { gammaP, gammaQ } from '@mindpeeker/negentropy/numerics'
import { byteReader } from '@mindpeeker/oracle'
import { attractors } from '../src/field/attractors.js'
import { sampleField } from '../src/field/sample.js'
import { fieldSignificance } from '../src/field/significance.js'
import { seededSource } from '../src/internal/prng.js'
import type { FieldRegion, Point } from '../src/types.js'
import { prngBytes, trackedSource } from './helpers/byte-sources.js'
import { rejectedCode } from './helpers/errors.js'

const REGION: FieldRegion = { kind: 'rect', width: 100, height: 80 }

/** Upper edge of a ≈ 99.9 % binomial band for a rate α over `trials` fields. */
function upperBand(alpha: number, trials: number): number {
  return alpha + 3.1 * Math.sqrt((alpha * (1 - alpha)) / trials)
}

describe('fieldSignificance', () => {
  test('under CSR the whole-field p is calibrated while the per-point tails are not', async () => {
    const reader = byteReader(seededSource(20260917n))
    const fields = 200
    const n = 60
    let attractorHits = 0
    let voidHits = 0
    let singleHits = 0
    let legacyAttractorHits = 0
    let legacyVoidHits = 0
    for (let f = 0; f < fields; f++) {
      const { points } = await sampleField(reader, n, REGION)
      const sig = await fieldSignificance(reader, points, REGION, { runs: 19 })
      if (sig.attractor.p <= 0.05) attractorHits++
      if (sig.void.p <= 0.05) voidHits++
      if (attractors(points, REGION).attractor.pSingle <= 0.05) singleHits++
      // 0.1's formula: Poisson tails with μ = λπr² = 4 and no edge correction
      const legacyRadius = Math.sqrt(4 / ((n / 8000) * Math.PI))
      const legacy = attractors(points, REGION, { radius: legacyRadius })
      if (gammaP(legacy.attractor.neighbours, 4) <= 0.05) legacyAttractorHits++
      if (gammaQ(legacy.void.neighbours + 1, 4) <= 0.05) legacyVoidHits++
    }
    expect(attractorHits / fields).toBeLessThanOrEqual(upperBand(0.05, fields))
    expect(voidHits / fields).toBeLessThanOrEqual(upperBand(0.05, fields))
    expect(singleHits / fields).toBeGreaterThan(0.4)
    expect(legacyVoidHits / fields).toBeGreaterThan(0.6)
    expect(legacyAttractorHits / fields).toBeGreaterThan(0.1)
  }, 60_000)

  test('a clustered field gets a small attractor p', async () => {
    const reader = byteReader(seededSource(5n))
    const { points: background } = await sampleField(reader, 80, REGION)
    const cluster: Point[] = Array.from({ length: 20 }, (_, i) => ({
      x: 30 + 2 * Math.cos(i),
      y: 40 + 2 * Math.sin(i * 1.7),
    }))
    const points = [...background, ...cluster]
    const sig = await fieldSignificance(reader, points, REGION, { runs: 99 })
    expect(sig.attractor.p).toBe(0.01)
    expect(sig.attractor.rank).toBe(1)
    expect(sig.runs).toBe(99)
    expect(sig.attractor.neighbours).toBe(attractors(points, REGION).attractor.neighbours)
  })

  test('accounting: runs × n × 8 bytes from the reader', async () => {
    const reader = byteReader(seededSource(8n))
    const { points } = await sampleField(reader, 30, REGION)
    const before = reader.bytesConsumed
    const sig = await fieldSignificance(reader, points, REGION, { runs: 9, radius: 6 })
    expect(sig.accounting.bytesConsumed).toBe(9 * 30 * 8)
    expect(sig.accounting.bitsUsed).toBe(9 * 30 * 64)
    expect(reader.bytesConsumed - before).toBe(9 * 30 * 8)
    expect(sig.radius).toBe(6)
  })

  test('a replayed batch or restarting source is rejected instead of silently powerless', async () => {
    const bytes = prngBytes(30 * 8 * 20, 77)
    const { points } = await sampleField(bytes, 30, REGION)
    expect(await rejectedCode(fieldSignificance(bytes, points, REGION, { runs: 5 }))).toBe(
      'invalid_config',
    )
    const source = seededSource(3n)
    const again = await sampleField(source, 30, REGION)
    expect(await rejectedCode(fieldSignificance(source, again.points, REGION, { runs: 5 }))).toBe(
      'invalid_config',
    )
    // fresh bytes (the rest of the batch) work
    const ok = await fieldSignificance(bytes.subarray(240), points, REGION, { runs: 5 })
    expect(ok.runs).toBe(5)
  })

  test('validates everything before touching the source, and closes the stream it opens', async () => {
    const source = trackedSource()
    const three: Point[] = [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]
    for (const run of [
      fieldSignificance(source, three, REGION, { runs: 0 }),
      fieldSignificance(source, three, REGION, { radius: -1 }),
      fieldSignificance(source, three, REGION, { radius: 1, expectedNeighbours: 3 }),
      fieldSignificance(source, [...three, { x: 200, y: 1 }], REGION),
      fieldSignificance(source, three.slice(0, 2), REGION),
      fieldSignificance(source, three, REGION, null as unknown as { runs: number }),
    ]) {
      expect(['invalid_config', 'insufficient_data']).toContain(await rejectedCode(run))
    }
    expect(source.streams).toBe(0)
    await fieldSignificance(source, three, REGION, { runs: 3 })
    expect(source.streams).toBe(1)
    expect(source.released).toBe(1)
  })

  test('aborts', async () => {
    const controller = new AbortController()
    controller.abort()
    const three: Point[] = [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]
    expect(
      await rejectedCode(
        fieldSignificance(trackedSource(), three, REGION, { signal: controller.signal }),
      ),
    ).toBe('aborted')
  })
})
