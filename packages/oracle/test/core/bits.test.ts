import { describe, expect, test } from 'bun:test'
import { bitReader } from '../../src/core/bits.js'
import { type ByteReader, byteReader } from '../../src/core/reader.js'
import { OracleError } from '../../src/errors.js'
import { prngBytes } from '../helpers/byte-sources.js'

/** The 0.1.0 bit-at-a-time path, kept as the reference for the bulk nextBits. */
function referenceBits(reader: ByteReader) {
  let buffer = 0
  let remaining = 0
  let used = 0
  const bit = async (): Promise<number> => {
    if (remaining === 0) {
      buffer = await reader.next()
      remaining = 8
    }
    remaining--
    used++
    return (buffer >>> remaining) & 1
  }
  return {
    get bitsUsed() {
      return used
    },
    nextBit: bit,
    async nextBits(count: number): Promise<number> {
      let value = 0
      for (let i = 0; i < count; i++) value = value * 2 + (await bit())
      return value
    },
  }
}

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
    await expect(bits.nextBits(-1)).rejects.toBeInstanceOf(OracleError)
    await expect(bits.nextBits(49)).rejects.toBeInstanceOf(OracleError)
    await expect(bits.nextBits(1.5)).rejects.toBeInstanceOf(OracleError)
    expect(bits.bitsUsed).toBe(0)
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

  test('bulk nextBits matches the bit-at-a-time reference (seeded property test)', async () => {
    const counts = prngBytes(4_000, 0xb175)
    for (let run = 0; run < 40; run++) {
      const bytes = prngBytes(1_024, 0x1000 + run)
      const fastReader = byteReader(bytes)
      const slowReader = byteReader(bytes)
      const fast = bitReader(fastReader)
      const slow = referenceBits(slowReader)
      for (let step = 0; step < 60; step++) {
        const pick = counts[(run * 60 + step) % counts.length] as number
        // Mix single bits in between multi-bit reads (count 0..48, and 49 → nextBit).
        const count = pick % 50
        if (count === 49) {
          expect(await fast.nextBit()).toBe((await slow.nextBit()) as 0 | 1)
        } else {
          expect(await fast.nextBits(count)).toBe(await slow.nextBits(count))
        }
        expect(fast.bitsUsed).toBe(slow.bitsUsed)
        expect(fastReader.bytesConsumed).toBe(slowReader.bytesConsumed)
      }
    }
  })

  test('nextBits(48) across six bytes is exact, and a short input fails at the same bit', async () => {
    const bits = bitReader(byteReader(new Uint8Array([0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa])))
    expect(await bits.nextBits(48)).toBe(0xffeeddccbbaa)
    const short = byteReader(new Uint8Array([0xf0]))
    const partial = bitReader(short)
    expect(await partial.nextBits(3)).toBe(0b111)
    await expect(partial.nextBits(6)).rejects.toMatchObject({ code: 'insufficient_entropy' })
    expect(partial.bitsUsed).toBe(8)
  })
})
