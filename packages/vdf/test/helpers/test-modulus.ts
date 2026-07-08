import { modPow } from '../../src/internal/bigint.js'
import type { RsaModulus } from '../../src/types.js'

/**
 * Known-factorization test modulus: two fixed 128-bit safe primes (generated
 * once with `openssl prime -generate -bits 128 -safe`), both ≡ 3 (mod 4), so
 * n = pq is a 256-bit Blum integer. Must match scripts/fixtures/generate.py.
 */
export const P = 273352122251145161663493244090143900227n
export const Q = 300502300844854219335184493716718087999n

/** φ(n) = (p − 1)(q − 1) — the group order the VDF adversary must not know. */
export const PHI = (P - 1n) * (Q - 1n)

export const TEST_MODULUS: RsaModulus = Object.freeze({ n: P * Q })

/**
 * Euler shortcut the tests cheat with: x^(2^T) mod n = x^(2^T mod φ(n)) mod n
 * for gcd(x, n) = 1 — O(log T) work instead of T sequential squarings.
 */
export function shortcutPower(x: bigint, T: number): bigint {
  return modPow(x, modPow(2n, BigInt(T), PHI), TEST_MODULUS.n)
}

/**
 * Euler's criterion in each prime field: x is a quadratic residue mod n = pq
 * iff x^((p−1)/2) ≡ 1 (mod p) and x^((q−1)/2) ≡ 1 (mod q).
 */
export function isQuadraticResidue(x: bigint): boolean {
  return modPow(x % P, (P - 1n) / 2n, P) === 1n && modPow(x % Q, (Q - 1n) / 2n, Q) === 1n
}
