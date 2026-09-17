import { describe, expect, test } from 'bun:test'
import { drawWithoutReplacement } from '../../src/core/draw.js'
import { type ByteReader, byteReader } from '../../src/core/reader.js'
import { uniformInt } from '../../src/core/uniform.js'
import type { OracleError } from '../../src/errors.js'
import { prngBytes } from '../helpers/byte-sources.js'

/**
 * The 0.1.0 dense implementation (O(n) identity array, in-place swaps), kept
 * verbatim as the reference the sparse Map-based version must match exactly.
 */
async function denseReference(reader: ByteReader, n: number, count: number): Promise<number[]> {
  const indices = Array.from({ length: n }, (_, i) => i)
  for (let i = 0; i < count; i++) {
    const j = i + (await uniformInt(reader, n - i))
    const tmp = indices[i] as number
    indices[i] = indices[j] as number
    indices[j] = tmp
  }
  return indices.slice(0, count)
}

describe('drawWithoutReplacement', () => {
  test('never repeats an index and stays in range', async () => {
    const drawn = await drawWithoutReplacement(byteReader(prngBytes(64)), 24, 24)
    expect([...drawn].sort((a, b) => a - b)).toEqual(Array.from({ length: 24 }, (_, i) => i))
  })

  test('count = 0 consumes nothing', async () => {
    const reader = byteReader(new Uint8Array(0))
    expect(await drawWithoutReplacement(reader, 10, 0)).toEqual([])
    expect(reader.bytesConsumed).toBe(0)
  })

  test('the last slot consumes zero bytes (uniformInt over 1)', async () => {
    // n = 2, count = 2: only the first swap needs a byte.
    const reader = byteReader(new Uint8Array([1]))
    expect(await drawWithoutReplacement(reader, 2, 2)).toEqual([1, 0])
    expect(reader.bytesConsumed).toBe(1)
  })

  test('n = 3 exhaustive: all 6 permutations exactly equiprobable', async () => {
    // Draw 1: uniformInt(3), threshold 255 → bytes 0..254 accepted (85 per residue).
    // Draw 2: uniformInt(2), threshold 256 → bytes 0..255 accepted (128 per residue).
    // Draw 3: uniformInt(1) → no bytes. Every (b1, b2) pair is one full cast.
    const counts = new Map<string, number>()
    for (let b1 = 0; b1 < 255; b1++) {
      for (let b2 = 0; b2 < 256; b2++) {
        const perm = await drawWithoutReplacement(byteReader(new Uint8Array([b1, b2])), 3, 3)
        const key = perm.join('')
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
    expect(counts.size).toBe(6)
    for (const [, count] of counts) expect(count).toBe((255 * 256) / 6)
  })

  test('a rejected first byte only delays, never biases, the draw', async () => {
    // 255 is rejected for n = 3; the outcome must equal the [4, 9] stream's.
    const withReject = await drawWithoutReplacement(byteReader(new Uint8Array([255, 4, 9])), 3, 3)
    const direct = await drawWithoutReplacement(byteReader(new Uint8Array([4, 9])), 3, 3)
    expect(withReject).toEqual(direct)
  })

  test('rejects invalid n / count', async () => {
    const reader = byteReader(new Uint8Array([0]))
    const bad: (readonly [number, number])[] = [
      [-1, 0],
      [2.5, 1],
      [3, -1],
      [3, 4],
      [3, 1.5],
    ]
    for (const [n, count] of bad) {
      try {
        await drawWithoutReplacement(reader, n, count)
        expect.unreachable()
      } catch (err) {
        expect((err as OracleError).code).toBe('invalid_input')
      }
    }
  })

  test('sparse draw is identical to the dense reference: outputs and byte consumption, 600 seeded runs', async () => {
    const shapes: (readonly [number, number])[] = [
      [1, 1],
      [2, 2],
      [3, 3],
      [10, 4],
      [24, 24],
      [78, 10],
      [78, 78],
      [257, 40],
      [1000, 1000],
      [65_537, 12],
      [100_000, 30],
      [300, 299],
    ]
    let runs = 0
    for (const [n, count] of shapes) {
      for (let seed = 1; seed <= 50; seed++) {
        const bytes = prngBytes(4 * count + 64, (seed * 0x9e3779b1) >>> 0 || 1)
        const sparseReader = byteReader(bytes)
        const denseReader = byteReader(bytes)
        const sparse = await drawWithoutReplacement(sparseReader, n, count)
        const dense = await denseReference(denseReader, n, count)
        expect(sparse).toEqual(dense)
        expect(sparseReader.bytesConsumed).toBe(denseReader.bytesConsumed)
        runs++
      }
    }
    expect(runs).toBe(600)
  })

  test('count = n prefix is a full permutation for n > 3', async () => {
    const drawn = await drawWithoutReplacement(byteReader(prngBytes(64, 0x77)), 20, 20)
    expect([...drawn].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i))
  })

  test('n = 2^32 works (documented bound) and costs exactly 4 bytes for the first draw', async () => {
    // uniformInt(2^32): k = 4, 256^4 = 2^32, so the first draw never rejects.
    const reader = byteReader(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0, 0, 0, 1, 0, 0, 0, 2]))
    const drawn = await drawWithoutReplacement(reader, 2 ** 32, 3)
    expect(drawn[0]).toBe(2 ** 32 - 1)
    // j = 1 + 1 = 2, j = 2 + 2 = 4: untouched slots map to themselves.
    expect(drawn.slice(1)).toEqual([2, 4])
    expect(reader.bytesConsumed).toBe(12)
    expect(new Set(drawn).size).toBe(3)
  })

  test('a single draw from a huge n allocates nothing proportional to n', async () => {
    const drawn = await drawWithoutReplacement(byteReader(prngBytes(64, 0x1e8)), 1e9, 1)
    expect(drawn.length).toBe(1)
    expect(drawn[0]).toBeLessThan(1e9)
  })

  test('n above 2^32 is rejected with invalid_input', async () => {
    try {
      await drawWithoutReplacement(byteReader(new Uint8Array(8)), 2 ** 32 + 1, 1)
      expect.unreachable()
    } catch (err) {
      expect((err as OracleError).code).toBe('invalid_input')
    }
  })
})
