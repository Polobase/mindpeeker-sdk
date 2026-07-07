import { describe, expect, test } from 'bun:test'
import { base64ToBytes, concatBytes, hexToBytes, xorBytes } from '../../src/internal/bytes.js'

describe('hexToBytes', () => {
  test('decodes lowercase and uppercase hex', () => {
    expect(hexToBytes('dc8a04')).toEqual(new Uint8Array([0xdc, 0x8a, 0x04]))
    expect(hexToBytes('DC8A04')).toEqual(new Uint8Array([0xdc, 0x8a, 0x04]))
  })

  test('decodes the empty string to an empty array', () => {
    expect(hexToBytes('')).toEqual(new Uint8Array(0))
  })

  test('throws on odd-length input', () => {
    expect(() => hexToBytes('abc')).toThrow(TypeError)
  })

  test('throws on non-hex characters', () => {
    expect(() => hexToBytes('zz')).toThrow(TypeError)
    expect(() => hexToBytes('12 4')).toThrow(TypeError)
  })
})

describe('base64ToBytes', () => {
  test('decodes a known vector', () => {
    expect(base64ToBytes('AQID')).toEqual(new Uint8Array([1, 2, 3]))
  })

  test('decodes padded base64', () => {
    expect(base64ToBytes('/w==')).toEqual(new Uint8Array([255]))
  })

  test('throws on invalid base64', () => {
    expect(() => base64ToBytes('!not-base64!')).toThrow(TypeError)
  })
})

describe('concatBytes', () => {
  test('concatenates chunks in order', () => {
    const out = concatBytes([new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5])])
    expect(out).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
  })

  test('returns an empty array for no chunks', () => {
    expect(concatBytes([])).toEqual(new Uint8Array(0))
  })
})

describe('xorBytes', () => {
  test('xors arrays of equal length', () => {
    const a = new Uint8Array([0b1010, 0xff, 0x00])
    const b = new Uint8Array([0b0110, 0x0f, 0x00])
    expect(xorBytes([a, b])).toEqual(new Uint8Array([0b1100, 0xf0, 0x00]))
  })

  test('xors three inputs', () => {
    const out = xorBytes([new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([4])])
    expect(out).toEqual(new Uint8Array([7]))
  })

  test('throws on length mismatch', () => {
    expect(() => xorBytes([new Uint8Array([1]), new Uint8Array([1, 2])])).toThrow(TypeError)
  })

  test('throws on empty input list', () => {
    expect(() => xorBytes([])).toThrow(TypeError)
  })

  test('does not mutate its inputs', () => {
    const a = new Uint8Array([1, 2])
    const b = new Uint8Array([3, 4])
    xorBytes([a, b])
    expect(a).toEqual(new Uint8Array([1, 2]))
    expect(b).toEqual(new Uint8Array([3, 4]))
  })
})
