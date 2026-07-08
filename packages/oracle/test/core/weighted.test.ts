import { describe, expect, test } from 'bun:test'
import { bitReader } from '../../src/core/bits.js'
import { byteReader } from '../../src/core/reader.js'
import { weightedIndex } from '../../src/core/weighted.js'
import type { OracleError } from '../../src/errors.js'
import { bump } from '../helpers/byte-sources.js'

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
    const bad: (readonly number[])[] = [[], [3], [1, 2], [1, -1], [0.5, 0.5], [0, 0]]
    for (const weights of bad) {
      try {
        await weightedIndex(bits(), weights)
        expect.unreachable()
      } catch (err) {
        expect((err as OracleError).code).toBe('invalid_input')
      }
    }
  })
})
