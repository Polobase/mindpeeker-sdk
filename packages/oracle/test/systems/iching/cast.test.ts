import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { byteReader } from '../../../src/core/reader.js'
import type { OracleError } from '../../../src/errors.js'
import { castHexagram } from '../../../src/systems/iching/cast.js'
import { bump, chiSquare, prngBytes } from '../../helpers/byte-sources.js'

describe('castHexagram determinism fixtures (hand-computed)', () => {
  test('coins, all-zero bits: six old-yin lines → Kun changing into Qian', async () => {
    // 18 zero bits → every 3-bit value v = 0 < 1 → line value 6 (old yin).
    const cast = await castHexagram(new Uint8Array([0, 0, 0]))
    expect(cast.method).toBe('coins')
    expect(cast.lines.map((l) => l.value)).toEqual([6, 6, 6, 6, 6, 6])
    expect(cast.primary.kingWen).toBe(2) // Kun, The Receptive
    expect(cast.relating?.kingWen).toBe(1) // Qian, The Creative
    expect(cast.changing).toEqual([1, 2, 3, 4, 5, 6])
    expect(cast.bytesConsumed).toBe(3)
    expect(cast.bitsUsed).toBe(18)
  })

  test('yarrow, all-one bits: six old-yang lines → Qian changing into Kun', async () => {
    // 24 one bits → every 4-bit value v = 15 ≥ 13 → line value 9 (old yang).
    const cast = await castHexagram(new Uint8Array([0xff, 0xff, 0xff]), { method: 'yarrow' })
    expect(cast.lines.map((l) => l.value)).toEqual([9, 9, 9, 9, 9, 9])
    expect(cast.primary.kingWen).toBe(1)
    expect(cast.relating?.kingWen).toBe(2)
    expect(cast.bytesConsumed).toBe(3)
    expect(cast.bitsUsed).toBe(24)
  })

  test('coins, mixed bytes [0x28, 0x3e, 0x00]: hexagram 58 → 14', async () => {
    // Bits: 00101000 00111110 00 → 3-bit groups 001 010 000 011 111 000
    //   = v [1, 2, 0, 3, 7, 0] → lines [7, 7, 6, 7, 9, 6] (bottom → top).
    // Yang flags 1,1,0,1,1,0 → '110110' = Dui over Dui = #58 (The Joyous).
    // Changing 3, 5, 6 flip → '111101' = Qian below, Li above = #14.
    const cast = await castHexagram(new Uint8Array([0x28, 0x3e, 0x00]))
    expect(cast.lines.map((l) => l.value)).toEqual([7, 7, 6, 7, 9, 6])
    expect(cast.primary.kingWen).toBe(58)
    expect(cast.primary.binary).toBe('110110')
    expect(cast.changing).toEqual([3, 5, 6])
    expect(cast.relating?.kingWen).toBe(14)
    expect(cast.bytesConsumed).toBe(3)
    expect(cast.bitsUsed).toBe(18)
  })

  test('yarrow, nibbles 1..6 ([0x12, 0x34, 0x56]): no moving lines → #43, no relating', async () => {
    // 4-bit values [1, 2, 3, 4, 5, 6] against cumsum [1, 6, 13, 16]
    //   → lines [7, 7, 7, 7, 7, 8] → '111110' = Qian below, Dui above = #43.
    const cast = await castHexagram(new Uint8Array([0x12, 0x34, 0x56]), { method: 'yarrow' })
    expect(cast.lines.map((l) => l.value)).toEqual([7, 7, 7, 7, 7, 8])
    expect(cast.primary.kingWen).toBe(43)
    expect(cast.relating).toBeUndefined()
    expect(cast.changing).toEqual([])
  })

  test('same bytes → identical reading (determinism)', async () => {
    const bytes = prngBytes(3, 0x1234)
    const a = await castHexagram(bytes, { method: 'yarrow' })
    const b = await castHexagram(Uint8Array.from(bytes), { method: 'yarrow' })
    expect(a.primary.kingWen).toBe(b.primary.kingWen)
    expect(a.lines.map((l) => l.value)).toEqual(b.lines.map((l) => l.value))
  })

  test('line objects carry position/yang/changing consistently', async () => {
    const cast = await castHexagram(prngBytes(3))
    cast.lines.forEach((line, i) => {
      expect(line.position).toBe(i + 1)
      expect(line.yang).toBe(line.value % 2 === 1)
      expect(line.changing).toBe(line.value === 6 || line.value === 9)
    })
  })

  test('unknown method throws invalid_input', async () => {
    try {
      await castHexagram(new Uint8Array(8), { method: 'dice' as never })
      expect.unreachable()
    } catch (err) {
      expect((err as OracleError).code).toBe('invalid_input')
    }
  })

  test('insufficient bytes throw insufficient_entropy', async () => {
    expect(castHexagram(new Uint8Array([0, 0]))).rejects.toMatchObject({
      code: 'insufficient_entropy',
    })
  })
})

describe('castHexagram distributions (seeded PRNG)', () => {
  const fixture = JSON.parse(
    readFileSync(join(import.meta.dir, '..', '..', 'fixtures', 'chi2-critical.json'), 'utf8'),
  ) as { alpha: number; critical: Record<string, number> }

  test('coin line values match (1,3,3,1)/8 — chi-square df=3', async () => {
    const casts = 4_000
    const reader = byteReader(prngBytes(3 * casts, 0xc01f5))
    const counts = [0, 0, 0, 0]
    for (let i = 0; i < casts; i++) {
      const cast = await castHexagram(reader)
      for (const line of cast.lines) bump(counts, line.value - 6)
    }
    const total = 6 * casts
    const expected = [total / 8, (3 * total) / 8, (3 * total) / 8, total / 8]
    expect(chiSquare(counts, expected)).toBeLessThan(fixture.critical['3'] as number)
  })

  test('yarrow line values match (1,5,7,3)/16 — chi-square df=3', async () => {
    const casts = 4_000
    const reader = byteReader(prngBytes(3 * casts, 0x9a44))
    const counts = [0, 0, 0, 0]
    for (let i = 0; i < casts; i++) {
      const cast = await castHexagram(reader, { method: 'yarrow' })
      for (const line of cast.lines) bump(counts, line.value - 6)
    }
    const total = 6 * casts
    const expected = [total / 16, (5 * total) / 16, (7 * total) / 16, (3 * total) / 16]
    expect(chiSquare(counts, expected)).toBeLessThan(fixture.critical['3'] as number)
  })

  test('primary hexagram is uniform over 64 under coins — chi-square df=63', async () => {
    // p(yang) = 3/8 + 1/8 = 1/2 exactly, so the primary is uniform on {0,1}^6.
    const casts = 12_800
    const reader = byteReader(prngBytes(3 * casts, 0x64de))
    const counts = new Array<number>(64).fill(0)
    for (let i = 0; i < casts; i++) {
      const cast = await castHexagram(reader)
      bump(counts, cast.primary.kingWen - 1)
    }
    const expected = new Array<number>(64).fill(casts / 64)
    expect(chiSquare(counts, expected)).toBeLessThan(fixture.critical['63'] as number)
  })
})
