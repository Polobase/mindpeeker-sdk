import { describe, expect, test } from 'bun:test'
import { bitReader } from '../../src/core/bits.js'
import { expectedBytes } from '../../src/core/expected.js'
import { byteReader } from '../../src/core/reader.js'
import { uniformInt } from '../../src/core/uniform.js'
import { weightedIndex, weightedIndexRational } from '../../src/core/weighted.js'
import type { OracleError } from '../../src/errors.js'
import { bump, prngBytes } from '../helpers/byte-sources.js'

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p
    return 'no-throw'
  } catch (err) {
    return (err as OracleError).code
  }
}

/** Draw once from `weights` with the 4-or-3-bit value v pre-baked into a byte. */
async function drawFromValue(v: number, k: number, weights: readonly number[]): Promise<number> {
  const reader = byteReader(new Uint8Array([v << (8 - k)]))
  const bits = bitReader(reader)
  const index = await weightedIndex(bits, weights)
  expect(bits.bitsUsed).toBe(k) // exact per-draw bit consumption
  return index
}

describe('weightedIndex', () => {
  test('yarrow weights [1,5,7,3]/16: exact counts over all 16 bit patterns', async () => {
    const counts = [0, 0, 0, 0]
    for (let v = 0; v < 16; v++) bump(counts, await drawFromValue(v, 4, [1, 5, 7, 3]))
    expect(counts).toEqual([1, 5, 7, 3])
  })

  test('coin weights [1,3,3,1]/8: exact counts over all 8 bit patterns', async () => {
    const counts = [0, 0, 0, 0]
    for (let v = 0; v < 8; v++) bump(counts, await drawFromValue(v, 3, [1, 3, 3, 1]))
    expect(counts).toEqual([1, 3, 3, 1])
  })

  test('cumulative threshold boundaries are exact (yarrow)', async () => {
    // cumsum = [1, 6, 13, 16]: v=0→0, v=1→1, v=5→1, v=6→2, v=12→2, v=13→3, v=15→3
    expect(await drawFromValue(0, 4, [1, 5, 7, 3])).toBe(0)
    expect(await drawFromValue(1, 4, [1, 5, 7, 3])).toBe(1)
    expect(await drawFromValue(5, 4, [1, 5, 7, 3])).toBe(1)
    expect(await drawFromValue(6, 4, [1, 5, 7, 3])).toBe(2)
    expect(await drawFromValue(12, 4, [1, 5, 7, 3])).toBe(2)
    expect(await drawFromValue(13, 4, [1, 5, 7, 3])).toBe(3)
    expect(await drawFromValue(15, 4, [1, 5, 7, 3])).toBe(3)
  })

  test('zero weights are never selected', async () => {
    for (let v = 0; v < 4; v++) {
      const index = await drawFromValue(v, 2, [0, 4, 0])
      expect(index).toBe(1)
    }
  })

  test('a single weight of 1 consumes zero bits', async () => {
    const reader = byteReader(new Uint8Array(0))
    const bits = bitReader(reader)
    expect(await weightedIndex(bits, [1])).toBe(0)
    expect(bits.bitsUsed).toBe(0)
  })

  test('rejects invalid weights', async () => {
    const bits = () => bitReader(byteReader(new Uint8Array([0])))
    const bad: (readonly number[])[] = [
      [],
      [3],
      [1, 2],
      [1, -1],
      [0.5, 0.5],
      [0, 0],
      [2 ** 49],
      [2 ** 48, 1],
      [2 ** 48 - 1],
      [Number.NaN],
      [Number.POSITIVE_INFINITY],
      ['4' as never],
    ]
    for (const weights of bad) {
      try {
        await weightedIndex(bits(), weights)
        expect.unreachable()
      } catch (err) {
        expect((err as OracleError).code).toBe('invalid_input')
      }
    }
  })

  test('totals up to 2^48 are verified arithmetically; k = 48 draws six bytes', async () => {
    for (let k = 0; k <= 48; k++) {
      const reader = byteReader(prngBytes(8, k + 1))
      const bits = bitReader(reader)
      expect(
        await weightedIndex(
          bits,
          [2 ** k - 1, 1].filter((w) => w > 0),
        ),
      ).toBeGreaterThanOrEqual(0)
      expect(bits.bitsUsed).toBe(k)
    }
    const top = bitReader(byteReader(new Uint8Array(6).fill(0xff)))
    expect(await weightedIndex(top, [2 ** 48 - 1, 1])).toBe(1)
  })
})

describe('weightedIndexRational', () => {
  test('astragalus [1,4,4,1]/10: exact counts over all accepted bytes', async () => {
    // uniformInt(10): k = 1, threshold 250 → each value 0..9 owns 25 bytes.
    const counts = [0, 0, 0, 0]
    for (let b = 0; b < 250; b++) {
      bump(counts, await weightedIndexRational(byteReader(new Uint8Array([b])), [1, 4, 4, 1]))
    }
    expect(counts).toEqual([25, 100, 100, 25])
    await expect(
      weightedIndexRational(byteReader(new Uint8Array([250])), [1, 4, 4, 1]),
    ).rejects.toMatchObject({ code: 'insufficient_entropy' })
  })

  test('equals the cumulative lookup of uniformInt over the total (same bytes, same consumption)', async () => {
    const weights = [8, 2, 11, 17] // 38 tokens
    const bytes = prngBytes(512, 0x38)
    const a = byteReader(bytes)
    const b = byteReader(bytes)
    for (let i = 0; i < 200; i++) {
      const index = await weightedIndexRational(a, weights)
      const v = await uniformInt(b, 38)
      const expected = v < 8 ? 0 : v < 10 ? 1 : v < 21 ? 2 : 3
      expect(index).toBe(expected)
      expect(a.bytesConsumed).toBe(b.bytesConsumed)
    }
  })

  test('zero weights are never selected; a total of 1 consumes nothing', async () => {
    for (let b = 0; b < 255; b++) {
      expect(await weightedIndexRational(byteReader(new Uint8Array([b])), [0, 3, 0])).toBe(1)
    }
    const empty = byteReader(new Uint8Array(0))
    expect(await weightedIndexRational(empty, [0, 1])).toBe(1)
    expect(empty.bytesConsumed).toBe(0)
  })

  test('large non-dyadic totals use multi-byte draws; mean consumption matches expectedBytes', async () => {
    const weights = [2 ** 40, 3, 2 ** 20 + 7] // total needs k = 6 bytes
    const total = weights.reduce((x, y) => x + y, 0)
    const reader = byteReader(prngBytes(6 * 3_000, 0xabc))
    for (let i = 0; i < 1_000; i++) await weightedIndexRational(reader, weights)
    const perDraw = reader.bytesConsumed / 1_000
    expect(Math.abs(perDraw - expectedBytes({ n: total, count: 1 }))).toBeLessThan(0.5)
  })

  test('rejects invalid weights with invalid_input', async () => {
    const bad: unknown[] = [[], [-1, 2], [1.5], [0, 0], [2 ** 48, 1], null, 'weights']
    for (const weights of bad) {
      const reader = byteReader(new Uint8Array(8))
      expect(await codeOf(weightedIndexRational(reader, weights as never))).toBe('invalid_input')
      expect(reader.bytesConsumed).toBe(0)
    }
  })
})
