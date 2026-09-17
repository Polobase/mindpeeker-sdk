import { describe, expect, test } from 'bun:test'
import { sha256 } from '../../src/internal/sha256.js'

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

describe('sha256 (synchronous)', () => {
  test('FIPS 180-4 example vectors', () => {
    expect(hex(sha256(new Uint8Array(0)))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(hex(sha256(new TextEncoder().encode('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(
      hex(
        sha256(
          new TextEncoder().encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
        ),
      ),
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
  })

  test('agrees with WebCrypto across padding boundaries', async () => {
    let state = 0xdecafbad
    for (const length of [1, 55, 56, 63, 64, 65, 119, 120, 1000, 4097]) {
      const message = new Uint8Array(length)
      for (let i = 0; i < length; i++) {
        state ^= state << 13
        state ^= state >>> 17
        state ^= state << 5
        state >>>= 0
        message[i] = state & 0xff
      }
      const expected = new Uint8Array(await crypto.subtle.digest('SHA-256', message))
      expect(sha256(message)).toEqual(expected)
    }
  })
})
