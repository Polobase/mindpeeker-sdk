import { describe, expect, test } from 'bun:test'
import { modPow } from '../../src/internal/bigint.js'
import {
  integerRoot,
  isProbablePrime,
  MILLER_RABIN_BASES,
  perfectPowerExponent,
  smallPrimes,
  TRIAL_DIVISION_BOUND,
} from '../../src/internal/primes.js'
import { P, Q } from '../helpers/test-modulus.js'

/** floor(v^(1/k)) by bisection — independent of Newton's iteration. */
function bisectRoot(v: bigint, k: bigint): bigint {
  let lo = 0n
  let hi = 1n
  while (hi ** k <= v) hi <<= 1n
  while (hi - lo > 1n) {
    const mid = (lo + hi) >> 1n
    if (mid ** k <= v) lo = mid
    else hi = mid
  }
  return lo
}

describe('smallPrimes / bases', () => {
  test('π(2^16) = 6542 and the bases are the first 32 primes', () => {
    const primes = smallPrimes()
    expect(primes).toHaveLength(6542)
    expect(primes[0]).toBe(2)
    expect(primes.at(-1)).toBe(65_521)
    expect(TRIAL_DIVISION_BOUND).toBe(65_536)
    expect(MILLER_RABIN_BASES.map(Number)).toEqual(primes.slice(0, 32))
  })
})

describe('isProbablePrime', () => {
  test('small numbers match trial division exactly (including the 2000² boundary)', () => {
    const naive = (v: number): boolean => {
      if (v < 2) return false
      for (let d = 2; d * d <= v; d++) if (v % d === 0) return false
      return true
    }
    for (let v = 0; v < 3000; v++) expect(isProbablePrime(BigInt(v))).toBe(naive(v))
    for (const v of [3_996_001, 3_999_971, 4_000_037, 4_000_039, 4_000_041]) {
      expect(isProbablePrime(BigInt(v))).toBe(naive(v))
    }
  })

  test('known primes: Mersenne 2^61−1, 2^89−1, 2^127−1, 2^521−1, 2^607−1; 2^255−19; 2^256−189; the test primes', () => {
    for (const p of [
      2n ** 61n - 1n,
      2n ** 89n - 1n,
      2n ** 127n - 1n,
      2n ** 521n - 1n,
      2n ** 607n - 1n,
      2n ** 255n - 19n,
      2n ** 256n - 189n,
      P,
      Q,
    ]) {
      expect(isProbablePrime(p)).toBe(true)
    }
  })

  test('Carmichael numbers and strong pseudoprimes to many prime bases are rejected', () => {
    // Chernick Carmichael 2221·4441·6661 (no factor below 2000, a^(n−1) ≡ 1 for base 2).
    const carmichael = 2221n * 4441n * 6661n
    expect(modPow(2n, carmichael - 1n, carmichael)).toBe(1n)
    expect(isProbablePrime(carmichael)).toBe(false)
    // Strong pseudoprimes to all prime bases ≤ 23, ≤ 37, ≤ 41 (Jaeschke 1993; Sorenson–Webster 2017).
    expect(isProbablePrime(149_491n * 747_451n * 34_233_211n)).toBe(false)
    expect(isProbablePrime(399_165_290_221n * 798_330_580_441n)).toBe(false)
    expect(isProbablePrime(1_287_836_182_261n * 2_575_672_364_521n)).toBe(false)
    expect(isProbablePrime(P * Q)).toBe(false)
    expect(isProbablePrime((2n ** 127n - 1n) * (2n ** 61n - 1n))).toBe(false)
    expect(isProbablePrime(2n ** 256n - 187n)).toBe(false)
  })
})

describe('integerRoot', () => {
  test('agrees with bisection across sizes and exponents', () => {
    let v = 0x9e37_79b9_7f4a_7c15n
    for (let i = 0; i < 60; i++) {
      v = (v * 6_364_136_223_846_793_005n + 1_442_695_040_888_963_407n) % 2n ** 700n
      for (const k of [1, 2, 3, 5, 7, 31, 101, 699]) {
        expect(integerRoot(v, k)).toBe(bisectRoot(v, BigInt(k)))
      }
    }
    expect(integerRoot(0n, 3)).toBe(0n)
    expect(integerRoot(1n, 3)).toBe(1n)
    expect(integerRoot(2n ** 300n, 3)).toBe(2n ** 100n)
    expect(integerRoot(2n ** 300n - 1n, 3)).toBe(2n ** 100n - 1n)
  })
})

describe('perfectPowerExponent', () => {
  test('finds the smallest prime exponent, or undefined', () => {
    expect(perfectPowerExponent(4n)).toBe(2)
    expect(perfectPowerExponent(8n)).toBe(3)
    expect(perfectPowerExponent(2n ** 64n)).toBe(2)
    expect(perfectPowerExponent(3n ** 40n)).toBe(2)
    expect(perfectPowerExponent(7n ** 15n)).toBe(3)
    expect(perfectPowerExponent(P ** 7n)).toBe(7)
    expect(perfectPowerExponent(2n ** 1021n)).toBe(1021)
    for (const v of [0n, 1n, 2n, 3n, 6n, 12n, P, P * Q, 2n ** 64n + 1n]) {
      expect(perfectPowerExponent(v)).toBeUndefined()
    }
  })
})
