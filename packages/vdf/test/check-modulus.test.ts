import { describe, expect, test } from 'bun:test'
import type { ModulusIssueCode } from '../src/check-modulus.js'
import { checkModulus, RECOMMENDED_MODULUS_BITS } from '../src/check-modulus.js'
import { MIN_MODULUS_BITS } from '../src/internal/validate.js'
import { RSA2048 } from '../src/moduli.js'
import { expectVdfThrow } from './helpers/expect.js'
import { loadFixture } from './helpers/fixture.js'
import { P, Q, TEST_MODULUS } from './helpers/test-modulus.js'

const fixture = loadFixture()
const codes = (n: bigint, minBits = MIN_MODULUS_BITS): ModulusIssueCode[] =>
  checkModulus(n, { minBits }).reasons.map((r) => r.code)

// 2^127 − 1 and 2^521 − 1 are Mersenne primes; 2^255 − 19 is prime (Bernstein, Curve25519).
const M127 = 2n ** 127n - 1n
const M521 = 2n ** 521n - 1n
const C25519 = 2n ** 255n - 19n

describe('checkModulus', () => {
  test('RSA-2048 passes with the default 2048-bit policy', () => {
    const result = checkModulus(RSA2048)
    expect(result).toEqual({ ok: true, bits: 2048, reasons: [] })
    expect(RECOMMENDED_MODULUS_BITS).toBe(2048)
  })

  test('the safe-prime test modulus passes a lowered bit policy but not the default', () => {
    expect(checkModulus(TEST_MODULUS, { minBits: 256 }).ok).toBe(true)
    expect(checkModulus(TEST_MODULUS).reasons.map((r) => r.code)).toEqual(['too_small'])
    expect(checkModulus(BigInt(fixture.oddWidth.n), { minBits: 512 }).ok).toBe(true)
  })

  test('primes are rejected', () => {
    expect(codes(M127)).toEqual(['prime', 'not_1_mod_4']) // M127 ≡ 3 (mod 4)
    expect(codes(C25519)).toEqual(['prime'])
    expect(codes(M521)).toEqual(['prime', 'not_1_mod_4'])
    expect(codes(P)).toEqual(['prime', 'not_1_mod_4'])
  })

  test('perfect powers are rejected (squares, cubes, and higher prime powers)', () => {
    expect(codes(P * P)).toContain('perfect_power')
    expect(codes(M127 ** 3n)).toContain('perfect_power')
    expect(codes(C25519 ** 5n)).toContain('perfect_power')
    const r = checkModulus(M127 ** 3n, { minBits: 64 }).reasons.find(
      (x) => x.code === 'perfect_power',
    )
    expect(r?.message).toContain('3')
  })

  test('small factors, even moduli, and n ≡ 3 (mod 4) are reported', () => {
    expect(codes(65_521n * P * Q)).toContain('small_factor') // 65521 is the largest prime < 2^16
    expect(codes(65_537n * P * Q)).not.toContain('small_factor') // just above the bound
    expect(codes(P * Q * 2n)).toEqual(expect.arrayContaining(['even', 'small_factor']))
    expect(codes(P * Q * 3n)).toContain('small_factor')
    // P ≡ 3 (mod 4) and M127 ≡ 3 (mod 4) → P·M127 ≡ 1; P·C25519 with C25519 ≡ 1 (mod 4) → ≡ 3.
    expect(C25519 % 4n).toBe(1n)
    expect(codes(P * C25519)).toEqual(['not_1_mod_4'])
    expect(codes(P * M127)).toEqual([])
  })

  test('size policy: too_small below minBits; nonpositive moduli short-circuit', () => {
    expect(codes(P * Q, 512)).toEqual(['too_small'])
    expect(checkModulus(0n)).toEqual({
      ok: false,
      bits: 0,
      reasons: [{ code: 'not_positive', message: 'n must be positive' }],
    })
    expect(checkModulus(-P * Q).ok).toBe(false)
  })

  test('invalid arguments throw', () => {
    expectVdfThrow(() => checkModulus({} as unknown as bigint), 'invalid_input')
    expectVdfThrow(() => checkModulus(P * Q, { minBits: 32 }), 'invalid_input')
    expectVdfThrow(() => checkModulus(P * Q, { minBits: 100.5 }), 'invalid_input')
  })
})
