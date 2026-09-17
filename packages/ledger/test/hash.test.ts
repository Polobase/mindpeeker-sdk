import { describe, expect, test } from 'bun:test'
import { fromHex, isHashHex, sha256, sha256Hex, toHex, ZERO_HASH } from '../src/hash.js'

describe('sha256 (FIPS 180-4 examples)', () => {
  test('empty string and "abc"', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  test('the two-block message', async () => {
    expect(await sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })

  test('strings hash as UTF-8; bytes and strings agree', async () => {
    const text = `caf${String.fromCodePoint(0xe9)} ${String.fromCodePoint(0x1f600)}`
    expect(await sha256(text)).toEqual(await sha256(new TextEncoder().encode(text)))
  })

  test('rejects non-byte input with invalid_input', async () => {
    await expect(sha256(42 as unknown as string)).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

describe('hex helpers', () => {
  test('toHex/fromHex round-trip', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i)
    expect(fromHex(toHex(bytes))).toEqual(bytes)
    expect(toHex(new Uint8Array([0, 15, 255]))).toBe('000fff')
  })

  test('isHashHex accepts only 64 lower-case hex digits', () => {
    expect(isHashHex(ZERO_HASH)).toBe(true)
    expect(isHashHex('A'.repeat(64))).toBe(false)
    expect(isHashHex('0'.repeat(63))).toBe(false)
    expect(isHashHex(undefined)).toBe(false)
  })

  test('toHex rejects non-bytes', () => {
    expect(() => toHex('00' as unknown as Uint8Array)).toThrow(
      expect.objectContaining({ code: 'invalid_input' }),
    )
  })
})
