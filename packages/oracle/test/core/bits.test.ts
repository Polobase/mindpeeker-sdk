import { describe, expect, test } from 'bun:test'
import { bitReader } from '../../src/core/bits.js'
import { byteReader } from '../../src/core/reader.js'
import { OracleError } from '../../src/errors.js'

describe('bitReader', () => {
  test('yields bits MSB-first within each byte', async () => {
    const bits = bitReader(byteReader(new Uint8Array([0b1011_0000])))
    const seen: number[] = []
    for (let i = 0; i < 8; i++) seen.push(await bits.nextBit())
    expect(seen).toEqual([1, 0, 1, 1, 0, 0, 0, 0])
  })

  test('nextBits assembles a big-endian integer across byte boundaries', async () => {
    // 0xa5 0x0f = 1010 0101 0000 1111
    const bits = bitReader(byteReader(new Uint8Array([0xa5, 0x0f])))
    expect(await bits.nextBits(4)).toBe(0b1010)
    expect(await bits.nextBits(8)).toBe(0b0101_0000)
    expect(await bits.nextBits(4)).toBe(0b1111)
  })

  test('nextBits(0) consumes nothing and returns 0', async () => {
    const reader = byteReader(new Uint8Array([0xff]))
    const bits = bitReader(reader)
    expect(await bits.nextBits(0)).toBe(0)
    expect(reader.bytesConsumed).toBe(0)
    expect(bits.bitsUsed).toBe(0)
  })

  test('pulls bytes lazily and tracks bitsUsed exactly', async () => {
    const reader = byteReader(new Uint8Array([0xff, 0x00]))
    const bits = bitReader(reader)
    expect(reader.bytesConsumed).toBe(0)
    await bits.nextBits(3)
    expect(reader.bytesConsumed).toBe(1)
    expect(bits.bitsUsed).toBe(3)
    await bits.nextBits(5)
    expect(reader.bytesConsumed).toBe(1) // still inside the first byte
    expect(bits.bitsUsed).toBe(8)
    await bits.nextBit()
    expect(reader.bytesConsumed).toBe(2)
    expect(bits.bitsUsed).toBe(9)
  })

  test('rejects invalid nextBits counts', async () => {
    const bits = bitReader(byteReader(new Uint8Array([0])))
    expect(bits.nextBits(-1)).rejects.toBeInstanceOf(OracleError)
    expect(bits.nextBits(49)).rejects.toBeInstanceOf(OracleError)
    expect(bits.nextBits(1.5)).rejects.toBeInstanceOf(OracleError)
  })

  test('runs out of entropy exactly at the byte boundary', async () => {
    const bits = bitReader(byteReader(new Uint8Array([0b1010_1010])))
    for (let i = 0; i < 8; i++) await bits.nextBit()
    try {
      await bits.nextBit()
      expect.unreachable()
    } catch (err) {
      expect((err as OracleError).code).toBe('insufficient_entropy')
    }
  })
})
