import { describe, expect, test } from 'bun:test'
import { byteReader } from '@mindpeeker/oracle'
import { generalVitality, generalVitalityReader } from '../../src/scan/vitality.js'
import { batchSource, seededSource } from '../helpers/byte-sources.js'

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
