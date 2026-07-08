import { describe, expect, test } from 'bun:test'
import { byteReader } from '../../src/core/reader.js'
import { MAX_UNIFORM, uniformInt } from '../../src/core/uniform.js'
import type { OracleError } from '../../src/errors.js'

describe('uniformInt', () => {
  test('n = 1 consumes zero bytes and returns 0', async () => {
    const reader = byteReader(new Uint8Array(0))
    expect(await uniformInt(reader, 1)).toBe(0)
    expect(reader.bytesConsumed).toBe(0)
  })

  test('n = 256 is the identity on single bytes (no rejection possible)', async () => {
    const reader = byteReader(new Uint8Array([0, 17, 255]))
    expect(await uniformInt(reader, 256)).toBe(0)
    expect(await uniformInt(reader, 256)).toBe(17)
    expect(await uniformInt(reader, 256)).toBe(255)
  })

  test('rejects values at or above the acceptance threshold and redraws', async () => {
    // n = 100, k = 1: threshold = floor(256/100)*100 = 200.
    // 200 and 255 must be rejected; 5 is then accepted as-is.
    const reader = byteReader(new Uint8Array([200, 255, 5]))
    expect(await uniformInt(reader, 100)).toBe(5)
    expect(reader.bytesConsumed).toBe(3)
  })

  test('accepted values in [n, threshold) reduce mod n', async () => {
    // n = 100: byte 199 < 200 is accepted, 199 mod 100 = 99.
    const reader = byteReader(new Uint8Array([199]))
    expect(await uniformInt(reader, 100)).toBe(99)
  })

  test('boundary byte 199 accepted, 200 rejected — the bound is exact', async () => {
    // Crafted stream: 200 (reject), 200 (reject), 199 (accept).
    const reader = byteReader(new Uint8Array([200, 200, 199]))
    expect(await uniformInt(reader, 100)).toBe(99)
    expect(reader.bytesConsumed).toBe(3)
  })

  test('n = 257 uses two bytes, big-endian', async () => {
    // v = 0x0102 = 258, threshold = floor(65536/257)*257 = 65535 → accept, 258 mod 257 = 1.
    const reader = byteReader(new Uint8Array([0x01, 0x02]))
    expect(await uniformInt(reader, 257)).toBe(1)
    expect(reader.bytesConsumed).toBe(2)
  })

  test('n = 257 rejects exactly the single top value 65535', async () => {
    const reader = byteReader(new Uint8Array([0xff, 0xff, 0x00, 0x05]))
    expect(await uniformInt(reader, 257)).toBe(5)
    expect(reader.bytesConsumed).toBe(4)
  })

  test('exhaustive exactness for n = 6: every accepted byte maps 42-to-1', async () => {
    // threshold = floor(256/6)*6 = 252: bytes 0..251 accepted, 252..255 rejected.
    const counts = new Array<number>(6).fill(0)
    for (let b = 0; b < 252; b++) {
      const r = await uniformInt(byteReader(new Uint8Array([b])), 6)
      counts[r] = (counts[r] ?? 0) + 1
    }
    expect(counts).toEqual([42, 42, 42, 42, 42, 42])
    for (let b = 252; b < 256; b++) {
      // a lone rejected byte leaves the reader starved
      expect(uniformInt(byteReader(new Uint8Array([b])), 6)).rejects.toMatchObject({
        code: 'insufficient_entropy',
      })
    }
  })

  test('rejects invalid n', async () => {
    const reader = byteReader(new Uint8Array([0]))
    for (const n of [0, -1, 1.5, Number.NaN, MAX_UNIFORM + 1]) {
      try {
        await uniformInt(reader, n)
        expect.unreachable()
      } catch (err) {
        expect((err as OracleError).code).toBe('invalid_input')
      }
    }
    expect(reader.bytesConsumed).toBe(0)
  })
})
