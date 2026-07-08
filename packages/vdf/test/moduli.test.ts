import { describe, expect, test } from 'bun:test'
import { bitLength } from '../src/internal/bigint.js'
import { RSA2048 } from '../src/moduli.js'

describe('RSA2048', () => {
  test('is the 2048-bit, 617-digit RSA factoring challenge modulus', () => {
    const decimal = RSA2048.n.toString()
    expect(bitLength(RSA2048.n)).toBe(2048)
    expect(decimal).toHaveLength(617)
    expect(decimal.startsWith('25195908475657893494')).toBe(true)
    expect(decimal.endsWith('10397122822120720357')).toBe(true)
    // Known hex head of RSA-2048 — guards against a single mistyped digit.
    expect(RSA2048.n.toString(16).startsWith('c7970ceedcc3b075')).toBe(true)
  })

  test('is odd and has no small prime factors (sanity, not a primality proof)', () => {
    expect(RSA2048.n & 1n).toBe(1n)
    const limit = 10_000
    const sieve = new Uint8Array(limit + 1).fill(1)
    for (let i = 2; i * i <= limit; i++) {
      if (sieve[i]) for (let j = i * i; j <= limit; j += i) sieve[j] = 0
    }
    for (let p = 2; p <= limit; p++) {
      if (sieve[p]) expect(RSA2048.n % BigInt(p)).not.toBe(0n)
    }
  })

  test('is frozen', () => {
    expect(Object.isFrozen(RSA2048)).toBe(true)
  })
})
