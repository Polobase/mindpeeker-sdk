import { VdfError } from '../errors.js'
import type { PietrzakProof, RsaModulus } from '../types.js'
import { bitLength } from './bigint.js'

/**
 * Smallest modulus the public API accepts, in bits. Generous on purpose so
 * unit tests can run fast known-factorization moduli; production deployments
 * must use $\ge 2048$ bits (see the README's security section).
 */
export const MIN_MODULUS_BITS = 64

/** Largest supported $T$: the serialization format stores $T$ as an unsigned 32-bit integer. */
export const MAX_T = 0xffff_ffff

/**
 * Validate a pluggable modulus and return its `n`. Rejects anything that is
 * not `{ n: bigint }` with $n$ odd and at least {@link MIN_MODULUS_BITS} bits
 * (an RSA modulus $n = pq$ is always odd) with `VdfError('invalid_modulus')`.
 */
export function assertModulus(modulus: RsaModulus): bigint {
  if (typeof modulus !== 'object' || modulus === null || typeof modulus.n !== 'bigint') {
    throw new VdfError('invalid_modulus', 'modulus must be an object { n: bigint }')
  }
  const { n } = modulus
  if (n <= 0n || (n & 1n) === 0n) {
    throw new VdfError(
      'invalid_modulus',
      'modulus n must be positive and odd (a product of odd primes)',
    )
  }
  if (bitLength(n) < MIN_MODULUS_BITS) {
    throw new VdfError(
      'invalid_modulus',
      `modulus must be at least ${MIN_MODULUS_BITS} bits (use >= 2048 in production)`,
    )
  }
  return n
}

/** Validate a delay parameter: an integer in $[1, 2^{32} - 1]$, else `VdfError('invalid_input')`. */
export function assertT(T: number): void {
  if (typeof T !== 'number' || !Number.isInteger(T) || T < 1 || T > MAX_T) {
    throw new VdfError('invalid_input', `T must be an integer in [1, ${MAX_T}], got ${T}`)
  }
}

/**
 * Normalize a batch byte input (SDK-wide contract: `Uint8Array` or
 * `ArrayLike<number>` of integer bytes). Returns the original `Uint8Array`
 * unchanged, or a validated copy; anything else throws `invalid_input`.
 */
export function toBytes(input: Uint8Array | ArrayLike<number>, what: string): Uint8Array {
  if (input instanceof Uint8Array) return input
  if (
    input === null ||
    typeof input !== 'object' ||
    typeof (input as ArrayLike<number>).length !== 'number'
  ) {
    throw new VdfError('invalid_input', `${what} must be a Uint8Array or ArrayLike<number>`)
  }
  const { length } = input
  if (!Number.isInteger(length) || length < 0) {
    throw new VdfError('invalid_input', `${what} has an invalid length ${length}`)
  }
  const out = new Uint8Array(length)
  for (let i = 0; i < length; i++) {
    const v = input[i]
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 255) {
      throw new VdfError('invalid_input', `${what}[${i}] must be an integer byte in [0, 255]`)
    }
    out[i] = v
  }
  return out
}

/**
 * Structural check of a proof object: the *types* must match
 * {@link PietrzakProof} or `VdfError('invalid_input')` is thrown. Value-level
 * problems (wrong midpoint count, out-of-range elements, mismatched claims)
 * are deliberately NOT checked here — the verifier reports those as `false`.
 */
export function assertProofShape(proof: PietrzakProof): void {
  if (typeof proof !== 'object' || proof === null) {
    throw new VdfError('invalid_input', 'proof must be an object { T, y, mus }')
  }
  const { T, y, mus } = proof
  if (typeof T !== 'number' || typeof y !== 'bigint' || !Array.isArray(mus)) {
    throw new VdfError('invalid_input', 'proof must have number T, bigint y, and an array mus')
  }
  for (const mu of mus) {
    if (typeof mu !== 'bigint') {
      throw new VdfError('invalid_input', 'every proof midpoint must be a bigint')
    }
  }
}
