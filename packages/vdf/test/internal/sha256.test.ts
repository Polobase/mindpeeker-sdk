import { describe, expect, test } from 'bun:test'
import { SHA256_CONSTANTS, sha256 } from '../../src/internal/sha256.js'

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** floor(r-th root of v) by bisection — independent of the implementation under test. */
function iroot(v: bigint, r: bigint): bigint {
  let lo = 0n
  let hi = 1n
  while (hi ** r <= v) hi <<= 1n
  while (hi - lo > 1n) {
    const mid = (lo + hi) >> 1n
    if (mid ** r <= v) lo = mid
    else hi = mid
  }
  return lo
}

function firstPrimes(count: number): bigint[] {
  const out: bigint[] = []
  for (let c = 2n; out.length < count; c++) {
    if (out.every((p) => c % p !== 0n)) out.push(c)
  }
  return out
}

describe('sha256 (sync, FIPS 180-4)', () => {
  test('FIPS 180-4 example vectors', () => {
    const enc = new TextEncoder()
    expect(hex(sha256(new Uint8Array(0)))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(hex(sha256(enc.encode('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(
      hex(sha256(enc.encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))),
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
    expect(hex(sha256(new Uint8Array(1_000_000).fill(0x61)))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    )
  })

  test('round constants re-derived from cube and square roots of the first primes', () => {
    const primes = firstPrimes(64)
    const mask = 2n ** 32n - 1n
    primes.forEach((p, i) => {
      expect(BigInt(SHA256_CONSTANTS.K[i] as number)).toBe(iroot(p << 96n, 3n) & mask)
    })
    primes.slice(0, 8).forEach((p, i) => {
      expect(BigInt(SHA256_CONSTANTS.H0[i] as number)).toBe(iroot(p << 64n, 2n) & mask)
    })
  })

  test('agrees with crypto.subtle for every length 0–300 and random inputs', async () => {
    const lengths = Array.from({ length: 301 }, (_, i) => i).concat([1000, 4096, 65_537])
    let state = 0x9e3779b9
    for (const length of lengths) {
      const data = new Uint8Array(length)
      for (let i = 0; i < length; i++) {
        state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
        data[i] = state >>> 24
      }
      const reference = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
      expect(hex(sha256(data))).toBe(hex(reference))
    }
  })

  test('does not modify its input', () => {
    const data = new Uint8Array([1, 2, 3])
    sha256(data)
    expect(Array.from(data)).toEqual([1, 2, 3])
  })
})
