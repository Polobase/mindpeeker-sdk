import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { byteReader } from '@mindpeeker/oracle'
import {
  GV_AUTO_MODE_THRESHOLD,
  generalVitality,
  generalVitalityReader,
  generalVitalitySf,
} from '../../src/scan/vitality.js'
import { batchSource, prngBytes, seededSource } from '../helpers/byte-sources.js'

/** Two big-endian bytes encoding a 0..1000 draw v (uniformInt(reader, 1001) returns v). */
function draw1000(v: number): [number, number] {
  return [Math.floor(v / 256), v % 256]
}

describe('generalVitality', () => {
  test('best-of-three max, no bonus when max <= 950', async () => {
    const bytes = Uint8Array.from([...draw1000(900), ...draw1000(800), ...draw1000(700)])
    const reader = byteReader(bytes)
    expect(await generalVitalityReader(reader)).toBe(900)
    expect(reader.bytesConsumed).toBe(6) // three 2-byte draws, no explosion
  })

  test('boundary: 950 does NOT trigger the bonus, 951 does', async () => {
    const noBonus = byteReader(Uint8Array.from([...draw1000(950), ...draw1000(0), ...draw1000(0)]))
    expect(await generalVitalityReader(noBonus)).toBe(950)
    expect(noBonus.bytesConsumed).toBe(6)

    // 951 > 950 → explosion; dice 10 (<50) stops immediately, adding nothing.
    const bonusStops = byteReader(
      Uint8Array.from([...draw1000(951), ...draw1000(0), ...draw1000(0), 10]),
    )
    expect(await generalVitalityReader(bonusStops)).toBe(951)
    expect(bonusStops.bytesConsumed).toBe(7)
  })

  test('open-ended explosion accumulates dice >= 50 past 1000', async () => {
    // max 960 > 950 → dice 60 (>=50, +60), then 40 (<50, stop) → 1020.
    const bytes = Uint8Array.from([...draw1000(960), ...draw1000(100), ...draw1000(100), 60, 40])
    expect(await generalVitalityReader(byteReader(bytes))).toBe(1020)
  })

  test('is deterministic over a source and lands in a sane range', async () => {
    const a = await generalVitality(seededSource('gv', 42))
    const b = await generalVitality(seededSource('gv', 42))
    expect(a).toBe(b)
    expect(a).toBeGreaterThanOrEqual(0)
  })

  test('accepts a batch source and consumes lazily', async () => {
    const bytes = Uint8Array.from([...draw1000(500), ...draw1000(400), ...draw1000(300)])
    expect(await generalVitality(batchSource('gv', bytes))).toBe(500)
  })
})

describe('generalVitalitySf — the exact chance law of GV', () => {
  const fx = JSON.parse(
    readFileSync(join(import.meta.dir, '..', 'fixtures', 'vitality.json'), 'utf8'),
  ) as { cases: { t: number; sf: number }[] }

  test('matches exact rational arithmetic (Python fractions)', () => {
    for (const c of fx.cases) {
      expect(Math.abs(generalVitalitySf(c.t) - c.sf)).toBeLessThanOrEqual(
        1e-14 * Math.max(c.sf, 1e-300),
      )
    }
  })

  test('closed-form anchors, monotone tail, and limits', () => {
    expect(generalVitalitySf(-1)).toBe(1)
    expect(generalVitalitySf(Number.NEGATIVE_INFINITY)).toBe(1)
    expect(generalVitalitySf(Number.POSITIVE_INFINITY)).toBe(0)
    expect(generalVitalitySf(949.7)).toBe(generalVitalitySf(949))
    expect(generalVitalitySf(500)).toBeCloseTo(1 - (501 / 1001) ** 3, 14)
    // P(GV > 950) = P(max > 950): the explosion only adds
    expect(generalVitalitySf(950)).toBeCloseTo(1 - (951 / 1001) ** 3, 14)
    let previous = 1
    for (let t = 0; t <= 3000; t += 13) {
      const v = generalVitalitySf(t)
      expect(v).toBeLessThanOrEqual(previous)
      previous = v
    }
    expect(GV_AUTO_MODE_THRESHOLD).toBe(1400)
    expect(generalVitalitySf(GV_AUTO_MODE_THRESHOLD)).toBeCloseTo(0.0022527, 6)
  })

  test('agrees with draws from a seeded source', async () => {
    const reader = byteReader(prngBytes(400_000, 20260917))
    const n = 20_000
    let above950 = 0
    let above1100 = 0
    for (let i = 0; i < n; i++) {
      const gv = await generalVitalityReader(reader)
      if (gv > 950) above950++
      if (gv > 1100) above1100++
    }
    for (const [count, t] of [
      [above950, 950],
      [above1100, 1100],
    ] as const) {
      const p = generalVitalitySf(t)
      const sd = Math.sqrt((p * (1 - p)) / n)
      expect(Math.abs(count / n - p)).toBeLessThan(5 * sd)
    }
  })

  test('rejects a NaN threshold', () => {
    expect(() => generalVitalitySf(Number.NaN)).toThrow(
      expect.objectContaining({ code: 'invalid_options' }),
    )
  })
})
