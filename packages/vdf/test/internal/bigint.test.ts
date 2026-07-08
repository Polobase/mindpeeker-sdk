import { describe, expect, test } from 'bun:test'
import {
  bigIntToBytes,
  bitLength,
  byteLength,
  bytesToBigInt,
  modPow,
  readU32be,
  u32be,
} from '../../src/internal/bigint.js'
import { expectVdfThrow } from '../helpers/expect.js'

describe('modPow', () => {
  test('matches naive exponentiation over a small grid', () => {
    for (let b = 0n; b < 12n; b++) {
      for (let e = 0n; e < 12n; e++) {
        for (const m of [2n, 3n, 7n, 97n, 65_537n]) {
          expect(modPow(b, e, m)).toBe(b ** e % m)
        }
      }
    }
  })

  test('reduces negative bases into [0, m)', () => {
    expect(modPow(-2n, 3n, 5n)).toBe(2n) // (−8) mod 5 = 2
    expect(modPow(-1n, 2n, 7n)).toBe(1n)
  })

  test('edge cases: exponent 0, modulus 1', () => {
    expect(modPow(123n, 0n, 7n)).toBe(1n)
    expect(modPow(123n, 456n, 1n)).toBe(0n)
  })

  test('rejects negative exponents and non-positive moduli', () => {
    expectVdfThrow(() => modPow(2n, -1n, 7n), 'invalid_input')
    expectVdfThrow(() => modPow(2n, 3n, 0n), 'invalid_input')
    expectVdfThrow(() => modPow(2n, 3n, -7n), 'invalid_input')
  })
})

describe('bitLength / byteLength', () => {
  test('known values', () => {
    expect(bitLength(0n)).toBe(0)
    expect(bitLength(1n)).toBe(1)
    expect(bitLength(2n)).toBe(2)
    expect(bitLength(255n)).toBe(8)
    expect(bitLength(256n)).toBe(9)
    expect(bitLength(2n ** 128n)).toBe(129)
    expect(bitLength(2n ** 128n - 1n)).toBe(128)
  })

  test('byteLength rounds up and floors at 1', () => {
    expect(byteLength(0n)).toBe(1)
    expect(byteLength(255n)).toBe(1)
    expect(byteLength(256n)).toBe(2)
    expect(byteLength(2n ** 256n - 1n)).toBe(32)
    expect(byteLength(2n ** 256n)).toBe(33)
  })

  test('rejects negatives', () => {
    expectVdfThrow(() => bitLength(-1n), 'invalid_input')
  })
})

describe('bytesToBigInt / bigIntToBytes', () => {
  test('big-endian round-trip with leading zeros preserved by width', () => {
    const value = 0x01_02_03n
    const bytes = bigIntToBytes(value, 8)
    expect(Array.from(bytes)).toEqual([0, 0, 0, 0, 0, 1, 2, 3])
    expect(bytesToBigInt(bytes)).toBe(value)
  })

  test('empty input decodes to 0; zero encodes to zero bytes', () => {
    expect(bytesToBigInt(new Uint8Array(0))).toBe(0n)
    expect(Array.from(bigIntToBytes(0n, 3))).toEqual([0, 0, 0])
  })

  test('round-trips a 256-bit value', () => {
    const value = 2n ** 255n + 987_654_321n
    expect(bytesToBigInt(bigIntToBytes(value, 32))).toBe(value)
  })

  test('rejects values that do not fit and bad widths', () => {
    expectVdfThrow(() => bigIntToBytes(256n, 1), 'invalid_input')
    expectVdfThrow(() => bigIntToBytes(-1n, 4), 'invalid_input')
    expectVdfThrow(() => bigIntToBytes(1n, 0), 'invalid_input')
    expectVdfThrow(() => bigIntToBytes(1n, 1.5), 'invalid_input')
  })
})

describe('u32be / readU32be', () => {
  test('round-trips boundary values', () => {
    for (const v of [0, 1, 255, 256, 65_536, 0x7fff_ffff, 0xffff_ffff]) {
      expect(readU32be(u32be(v), 0)).toBe(v)
    }
  })

  test('rejects out-of-range values and offsets', () => {
    expectVdfThrow(() => u32be(-1), 'invalid_input')
    expectVdfThrow(() => u32be(2 ** 32), 'invalid_input')
    expectVdfThrow(() => u32be(1.5), 'invalid_input')
    expectVdfThrow(() => readU32be(new Uint8Array(3), 0), 'invalid_input')
  })
})
