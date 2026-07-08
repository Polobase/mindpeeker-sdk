import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { byteReader } from '../../../src/core/reader.js'
import type { OracleError } from '../../../src/errors.js'
import { castRunes } from '../../../src/systems/runes/cast.js'
import { bump, chiSquare, prngBytes } from '../../helpers/byte-sources.js'

describe('castRunes determinism fixtures (hand-computed)', () => {
  test('bytes [0, 0]: Fehu then Uruz, no merkstave, 2 bytes / 16 bits', async () => {
    // Draw 1, uniformInt(24): threshold 240; 0 → Fehu (0).
    // Draw 2, uniformInt(23): threshold 253; 0 → j = 1+0 → Uruz (1).
    const cast = await castRunes(new Uint8Array([0, 0]), 2)
    expect(cast.runes.map((r) => r.rune.id)).toEqual(['fehu', 'uruz'])
    expect(cast.runes.map((r) => r.merkstave)).toEqual([false, false])
    expect(cast.bytesConsumed).toBe(2)
    expect(cast.bitsUsed).toBe(16)
  })

  test('merkstave draws one bit per invertible rune, in draw order', async () => {
    // Same two invertible runes, then bits from 0b1000_0000: [1, 0].
    const cast = await castRunes(new Uint8Array([0, 0, 0b1000_0000]), 2, { merkstave: true })
    expect(cast.runes.map((r) => r.merkstave)).toEqual([true, false])
    expect(cast.bytesConsumed).toBe(3)
    expect(cast.bitsUsed).toBe(18)
  })

  test('non-invertible runes consume no merkstave bit and stay upright', async () => {
    // Byte 6 → Gebo (non-invertible): no bit is drawn, so no third byte is needed.
    const cast = await castRunes(new Uint8Array([6]), 1, { merkstave: true })
    expect(cast.runes[0]?.rune.id).toBe('gebo')
    expect(cast.runes[0]?.merkstave).toBe(false)
    expect(cast.bytesConsumed).toBe(1)
    expect(cast.bitsUsed).toBe(8)
  })

  test('mixed draw: bit spent on Fehu but not on Gebo', async () => {
    // Draw 1: byte 0 → Fehu. Draw 2, uniformInt(23): byte 5 → j = 1+5 = 6 → Gebo.
    // Merkstave bits: only Fehu draws one, from 0b1000_0000 → true.
    const cast = await castRunes(new Uint8Array([0, 5, 0b1000_0000]), 2, { merkstave: true })
    expect(cast.runes.map((r) => r.rune.id)).toEqual(['fehu', 'gebo'])
    expect(cast.runes.map((r) => r.merkstave)).toEqual([true, false])
    expect(cast.bitsUsed).toBe(17)
  })

  test('a full 24-rune cast never repeats', async () => {
    const cast = await castRunes(prngBytes(64, 0x24), 24)
    expect(new Set(cast.runes.map((r) => r.rune.id)).size).toBe(24)
  })

  test('rejects invalid counts', async () => {
    for (const count of [0, 25, 1.5, -3]) {
      try {
        await castRunes(new Uint8Array(8), count)
        expect.unreachable()
      } catch (err) {
        expect((err as OracleError).code).toBe('invalid_input')
      }
    }
  })
})

describe('castRunes distribution (seeded PRNG)', () => {
  const fixture = JSON.parse(
    readFileSync(join(import.meta.dir, '..', '..', 'fixtures', 'chi2-critical.json'), 'utf8'),
  ) as { alpha: number; critical: Record<string, number> }

  test('first rune is uniform over 24 — chi-square df=23', async () => {
    const draws = 12_000
    const reader = byteReader(prngBytes(15_000, 0x5eed))
    const counts = new Array<number>(24).fill(0)
    for (let i = 0; i < draws; i++) {
      const cast = await castRunes(reader, 1)
      bump(counts, cast.runes[0]?.rune.index as number)
    }
    const expected = new Array<number>(24).fill(draws / 24)
    expect(chiSquare(counts, expected)).toBeLessThan(fixture.critical['23'] as number)
  })
})
