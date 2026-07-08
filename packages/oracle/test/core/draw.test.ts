import { describe, expect, test } from 'bun:test'
import { drawWithoutReplacement } from '../../src/core/draw.js'
import { byteReader } from '../../src/core/reader.js'
import type { OracleError } from '../../src/errors.js'
import { prngBytes } from '../helpers/byte-sources.js'

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
})
