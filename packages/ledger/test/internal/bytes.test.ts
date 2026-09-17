import { describe, expect, test } from 'bun:test'
import {
  base64ToBytes,
  bytesEqual,
  bytesToBase64,
  hexToBytes,
  lengthPrefixed,
  requireSafeInteger,
  toBytes,
  u64be,
} from '../../src/internal/bytes.js'

const enc = (s: string) => new TextEncoder().encode(s)

describe('base64 (RFC 4648 §10 test vectors)', () => {
  const vectors: [string, string][] = [
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ]
  test.each(vectors)('%p <-> %p', (plain, encoded) => {
    expect(bytesToBase64(enc(plain))).toBe(encoded)
    expect(base64ToBytes(encoded)).toEqual(enc(plain))
  })

  test('agrees with btoa on every byte value', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i)
    for (let len = 0; len <= 256; len += 17) {
      const slice = all.slice(0, len)
      const reference = btoa(String.fromCharCode(...slice))
      expect(bytesToBase64(slice)).toBe(reference)
      expect(base64ToBytes(reference)).toEqual(slice)
    }
  })

  test('strict: rejects bad length, alphabet, misplaced padding, non-zero pad bits', () => {
    for (const bad of [
      'Zg=',
      'Zg',
      'Z===',
      'Zm9v!A==',
      'Zg==Zg==',
      'Zh==',
      'Zm9=',
      ' Zg==',
      'Zg=a',
    ]) {
      expect(base64ToBytes(bad)).toBeUndefined()
    }
  })
})

describe('hex and integers', () => {
  test('hexToBytes accepts both cases and rejects odd or non-hex input', () => {
    expect(hexToBytes('00ffAB', 'x')).toEqual(new Uint8Array([0, 255, 171]))
    expect(() => hexToBytes('abc', 'x')).toThrow(expect.objectContaining({ code: 'invalid_input' }))
    expect(() => hexToBytes('zz', 'x')).toThrow(expect.objectContaining({ code: 'invalid_input' }))
  })

  test('u64be encodes safe integers big-endian', () => {
    expect(u64be(0)).toEqual(new Uint8Array(8))
    expect(u64be(258)).toEqual(new Uint8Array([0, 0, 0, 0, 0, 0, 1, 2]))
    expect(u64be(Number.MAX_SAFE_INTEGER)).toEqual(
      new Uint8Array([0, 0x1f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    )
  })

  test('lengthPrefixed = u64be(len) ‖ bytes', () => {
    expect(lengthPrefixed(new Uint8Array([9, 9]))).toEqual(
      new Uint8Array([0, 0, 0, 0, 0, 0, 0, 2, 9, 9]),
    )
  })

  test('requireSafeInteger', () => {
    expect(requireSafeInteger(3, 'n')).toBe(3)
    for (const bad of [-1, 1.5, Number.NaN, 2 ** 53, '1']) {
      expect(() => requireSafeInteger(bad, 'n')).toThrow(
        expect.objectContaining({ code: 'invalid_input' }),
      )
    }
  })
})

describe('toBytes', () => {
  test('strings are UTF-8; byte input is copied', () => {
    expect(toBytes('é', 's')).toEqual(new Uint8Array([0xc3, 0xa9]))
    const input = new Uint8Array([1, 2])
    const copy = toBytes(input, 'b')
    input[0] = 7
    expect(copy[0]).toBe(1)
  })

  test('rejects lone surrogates and non-bytes', () => {
    const lone = String.fromCharCode(0xd800)
    expect(() => toBytes(lone, 's')).toThrow(expect.objectContaining({ code: 'invalid_input' }))
    expect(() => toBytes(5 as unknown as string, 's')).toThrow(
      expect.objectContaining({ code: 'invalid_input' }),
    )
  })

  test('bytesEqual', () => {
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true)
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false)
    expect(bytesEqual(new Uint8Array([1]), new Uint8Array([1, 0]))).toBe(false)
  })
})
