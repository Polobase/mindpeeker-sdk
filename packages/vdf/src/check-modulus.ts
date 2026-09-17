import { VdfError } from './errors.js'
import { bitLength } from './internal/bigint.js'
import {
  isProbablePrime,
  perfectPowerExponent,
  smallPrimes,
  TRIAL_DIVISION_BOUND,
} from './internal/primes.js'
import { MIN_MODULUS_BITS } from './internal/validate.js'
import type { RsaModulus } from './types.js'

/** Modulus size `checkModulus` requires by default, in bits. */
export const RECOMMENDED_MODULUS_BITS = 2048

/** Why `checkModulus` rejected a modulus. */
export type ModulusIssueCode =
  | 'not_positive' // n ≤ 0
  | 'even' // n is even — never an RSA modulus
  | 'too_small' // fewer bits than required (MIN_MODULUS_BITS hard floor, minBits policy)
  | 'small_factor' // a prime factor below TRIAL_DIVISION_BOUND — order computable, factoring trivial
  | 'perfect_power' // n = r^k, k ≥ 2 — r is found by an integer root, so the order is computable
  | 'prime' // n is (probably) prime — φ(n) = n − 1 is public, no sequentiality at all
  | 'not_1_mod_4' // n ≡ 3 (mod 4): not a product of two safe primes, J_n^+ check is vacuous

/** One failed check. */
export interface ModulusIssue {
  readonly code: ModulusIssueCode
  readonly message: string
}

/** Result of {@link checkModulus}. */
export interface ModulusCheck {
  /** `true` iff no issue was found. */
  readonly ok: boolean
  /** Bit length of $n$ (0 for $n \le 0$). */
  readonly bits: number
  readonly reasons: readonly ModulusIssue[]
}

export interface CheckModulusOptions {
  /**
   * Minimum bit length. Default {@link RECOMMENDED_MODULUS_BITS} (2048); may be
   * lowered for test moduli but never below `MIN_MODULUS_BITS` (64).
   */
  minBits?: number
}

/**
 * Cheap sanity checks that reject moduli whose group order is *obviously* known —
 * any of which silently removes every sequentiality guarantee:
 *
 * 1. $n > 0$, odd, and at least `minBits` bits;
 * 2. no prime factor below {@link TRIAL_DIVISION_BOUND} ($2^{16}$; trial division
 *    by all 6542 such primes);
 * 3. not a perfect power $r^k$ (integer $k$-th roots for every prime
 *    $k \le \mathrm{bitLength}(n)$);
 * 4. not prime (strong Miller–Rabin to the 32 fixed bases $2 \dots 131$; a prime
 *    $n$ has the public order $n - 1$);
 * 5. $n \equiv 1 \pmod 4$, as every product of two safe primes $> 5$ is — for
 *    $n \equiv 3 \pmod 4$ the verifiers' Jacobi check cannot restrict elements to
 *    $QR_n^+$.
 *
 * Scope, stated honestly: these checks **cannot certify** a good modulus. Whether
 * $n = pq$ with safe primes, whether anyone knows the factors, and whether
 * low-order elements exist are undecidable without the factorization (Seres–Burcsi,
 * eprint 2020/402). Passing means "not obviously broken". Cost: dominated by the
 * Miller–Rabin exponentiations — tens of milliseconds for a 2048-bit composite,
 * about a second for a 2048-bit prime.
 *
 * @throws `VdfError('invalid_input')` for a non-bigint modulus or an invalid `minBits`.
 */
export function checkModulus(
  modulus: RsaModulus | bigint,
  opts: CheckModulusOptions = {},
): ModulusCheck {
  const n = typeof modulus === 'bigint' ? modulus : modulus?.n
  if (typeof n !== 'bigint') {
    throw new VdfError('invalid_input', 'checkModulus expects a bigint or { n: bigint }')
  }
  const minBits = opts.minBits ?? RECOMMENDED_MODULUS_BITS
  if (!Number.isInteger(minBits) || minBits < MIN_MODULUS_BITS) {
    throw new VdfError('invalid_input', `minBits must be an integer >= ${MIN_MODULUS_BITS}`)
  }
  const reasons: ModulusIssue[] = []
  if (n <= 0n) {
    reasons.push({ code: 'not_positive', message: 'n must be positive' })
    return Object.freeze({ ok: false, bits: 0, reasons: Object.freeze(reasons) })
  }
  const bits = bitLength(n)
  if ((n & 1n) === 0n) reasons.push({ code: 'even', message: 'n is even' })
  if (bits < minBits) {
    reasons.push({ code: 'too_small', message: `n has ${bits} bits, fewer than ${minBits}` })
  }
  for (const p of smallPrimes()) {
    const bp = BigInt(p)
    if (bp >= n) break
    if (n % bp === 0n) {
      reasons.push({ code: 'small_factor', message: `n is divisible by ${p}` })
      break
    }
  }
  const k = perfectPowerExponent(n)
  if (k !== undefined) {
    reasons.push({ code: 'perfect_power', message: `n is a perfect ${k}-th power` })
  }
  if (isProbablePrime(n)) {
    reasons.push({
      code: 'prime',
      message: 'n is (probably) prime, so its group order n − 1 is known',
    })
  }
  if ((n & 3n) === 3n) {
    reasons.push({
      code: 'not_1_mod_4',
      message: 'n ≡ 3 (mod 4): not a product of two safe primes',
    })
  }
  return Object.freeze({ ok: reasons.length === 0, bits, reasons: Object.freeze(reasons) })
}
