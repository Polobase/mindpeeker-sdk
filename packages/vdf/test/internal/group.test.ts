import { describe, expect, test } from 'bun:test'
import { modPow } from '../../src/internal/bigint.js'
import { canon, halfModulus, isGroupElement, jacobi, mulCanon } from '../../src/internal/group.js'
import { P, Q, TEST_MODULUS } from '../helpers/test-modulus.js'

const n = TEST_MODULUS.n

/** Legendre symbol by Euler's criterion for an odd prime p. */
function legendre(a: bigint, p: bigint): number {
  const r = modPow(((a % p) + p) % p, (p - 1n) / 2n, p)
  return r === 0n ? 0 : r === 1n ? 1 : -1
}

/** Legendre symbol by enumerating squares (tiny primes). */
function legendreBrute(a: number, p: number): number {
  const r = ((a % p) + p) % p
  if (r === 0) return 0
  for (let x = 1; x < p; x++) if ((x * x) % p === r) return 1
  return -1
}

describe('jacobi', () => {
  test('equals the product of Legendre symbols over the factorization (small moduli, brute force)', () => {
    const moduli: number[][] = [[3], [5], [3, 5], [3, 5, 7], [7, 7], [11, 13], [3, 3, 3, 17]]
    for (const factors of moduli) {
      const m = factors.reduce((a, b) => a * b, 1)
      for (let a = -3; a < 2 * m; a++) {
        const expected = factors.reduce((acc, p) => acc * legendreBrute(a, p), 1)
        expect(jacobi(BigInt(a), BigInt(m))).toBe((expected === 0 ? 0 : expected) as -1 | 0 | 1)
      }
    }
  })

  test('equals (a|P)(a|Q) by Euler’s criterion on the 256-bit test modulus', () => {
    let a = 12_345_678_901_234_567_890n
    for (let i = 0; i < 200; i++) {
      a = (a * a + 0x1234_5678_9abc_def1n) % n
      expect(jacobi(a, n)).toBe((legendre(a, P) * legendre(a, Q)) as -1 | 0 | 1)
    }
    expect(jacobi(P, n)).toBe(0)
    expect(jacobi(n - 1n, n)).toBe(1) // n ≡ 1 (mod 4)
  })
})

describe('canonical representatives', () => {
  test('canon picks min(a, n − a) and is a homomorphism modulo ±1', () => {
    const half = halfModulus(n)
    expect(canon(half, n)).toBe(half)
    expect(canon(half + 1n, n)).toBe(half)
    expect(canon(n - 1n, n)).toBe(1n)
    const a = 98_765_432_123_456_789n
    const b = n - 123_456_789_987_654_321n
    expect(mulCanon(a, b, n)).toBe(canon((canon(a, n) * canon(b, n)) % n, n))
  })

  test('isGroupElement: canonical range plus admissible Jacobi symbol', () => {
    const half = halfModulus(n)
    const square = canon((123_456_789n * 123_456_789n) % n, n)
    expect(isGroupElement(square, n)).toBe(true)
    expect(isGroupElement(n - square, n)).toBe(false) // non-canonical
    expect(isGroupElement(0n, n)).toBe(false)
    expect(isGroupElement(half + 1n, n)).toBe(false)
    expect(isGroupElement(P, n)).toBe(false) // gcd > 1
    let nonResidue = 2n
    while (jacobi(nonResidue, n) !== -1) nonResidue++
    expect(isGroupElement(nonResidue, n)).toBe(false)
    // For m ≡ 3 (mod 4) the sign flip changes the symbol, so −1 symbols are admissible.
    const m = P * (2n ** 255n - 19n)
    expect(m % 4n).toBe(3n)
    let odd = 2n
    while (jacobi(odd, m) !== -1) odd++
    expect(isGroupElement(odd, m)).toBe(true)
  })
})
