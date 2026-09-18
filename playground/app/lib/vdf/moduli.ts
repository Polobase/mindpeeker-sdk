// Groups of unknown order the page works in, and the deliberately broken
// moduli the `checkModulus` section feeds the policy.
//
// CLIENT/WORKER-ONLY: imports @mindpeeker/vdf.

import { RSA2048, type RsaModulus } from '@mindpeeker/vdf'
import type { ModulusId } from './jobs'

/**
 * Two fixed 128-bit safe primes from the package's own test suite
 * (`openssl prime -generate -bits 128 -safe`), both ≡ 3 (mod 4), so n = pq is a
 * 256-bit Blum integer and QR_n^+ has no low-order elements at all.
 *
 * The factors are published right here, which is the point: `checkModulus` still
 * says "not obviously broken", and the VDF built on it has no sequentiality
 * whatsoever — anyone can compute x^(2^T mod φ(n)) in O(log T).
 */
export const DEMO_P = 273352122251145161663493244090143900227n
export const DEMO_Q = 300502300844854219335184493716718087999n

export const DEMO_MODULUS: RsaModulus = Object.freeze({ n: DEMO_P * DEMO_Q })

const REGISTRY: Record<ModulusId, RsaModulus> = {
  rsa2048: RSA2048,
  demo256: DEMO_MODULUS,
}

export function resolveModulus(id: ModulusId): RsaModulus {
  return REGISTRY[id] ?? RSA2048
}

/** Byte width of the modulus — the wire format's `w`. */
export function modulusWidth(n: bigint): number {
  return Math.ceil(n.toString(2).length / 8)
}

export function modulusBits(n: bigint): number {
  return n.toString(2).length
}

export interface ModulusCase {
  readonly id: string
  readonly label: string
  readonly expr: string
  readonly note: string
  readonly n: bigint
}

/** A Mersenne prime — 2^521 − 1, the 13th, prime since Robinson 1952. */
const M521 = (1n << 521n) - 1n

/**
 * One row per failure mode `checkModulus` can report. Every one of these is a
 * modulus whose group order is either known or trivially computable, which
 * removes the sequentiality assumption entirely.
 */
export const MODULUS_CASES: readonly ModulusCase[] = [
  {
    id: 'rsa2048',
    label: 'RSA-2048',
    expr: 'RSA2048',
    note: 'The package default. Passes every check — which means "not obviously broken", not "good".',
    n: RSA2048.n,
  },
  {
    id: 'demo256',
    label: '256-bit demo modulus',
    expr: 'DEMO_P * DEMO_Q',
    note: 'A real Blum integer whose two 128-bit safe primes are printed in this repository. Only the size policy catches it.',
    n: DEMO_MODULUS.n,
  },
  {
    id: 'tiny',
    label: '3233 = 53 × 61',
    expr: '3233n',
    note: 'The textbook RSA toy modulus: 12 bits, and trial division by the primes below 2^16 finds a factor.',
    n: 3233n,
  },
  {
    id: 'square',
    label: 'RSA-2048²',
    expr: 'RSA2048.n ** 2n',
    note: '4096 bits, no small factor, not prime — and still broken: an integer square root recovers r, so φ(r²) = r(r−1) follows from φ(r).',
    n: RSA2048.n ** 2n,
  },
  {
    id: 'prime',
    label: '2⁵²¹ − 1 (Mersenne prime)',
    expr: '(1n << 521n) - 1n',
    note: 'A prime has the public order n − 1, so x^(2^T) collapses to one exponentiation. It is also ≡ 3 (mod 4), where the Jacobi check cannot pin elements to QR_n^+.',
    n: M521,
  },
  {
    id: 'even',
    label: 'RSA-2048 + 1 (even)',
    expr: 'RSA2048.n + 1n',
    note: 'Right size, wrong parity: an even n is never an RSA modulus, and 2 is a factor trial division finds immediately.',
    n: RSA2048.n + 1n,
  },
]
