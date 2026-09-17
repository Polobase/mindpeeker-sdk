import { VdfError } from '../errors.js'
import type { PietrzakProof, RsaModulus, VdfCheckpoints, WesolowskiProof } from '../types.js'
import { bitLength } from './bigint.js'

/**
 * Smallest modulus the public API accepts, in bits. Generous on purpose so
 * unit tests can run fast known-factorization moduli; production deployments
 * must use $\ge 2048$ bits (`checkModulus` enforces that by default).
 */
export const MIN_MODULUS_BITS = 64

/** Largest supported $T$: the wire formats store $T$ as an unsigned 32-bit integer. */
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
 * `ArrayLike<number>` of integer bytes) into a private copy, so later mutation
 * of the caller's buffer cannot affect a computation. When `maxLength` is given
 * the declared length is checked *before* anything is allocated. Anything else
 * throws `invalid_input`.
 */
export function toBytes(
  input: Uint8Array | ArrayLike<number>,
  what: string,
  maxLength = Number.POSITIVE_INFINITY,
): Uint8Array {
  if (
    input === null ||
    typeof input !== 'object' ||
    typeof (input as ArrayLike<number>).length !== 'number'
  ) {
    throw new VdfError('invalid_input', `${what} must be a Uint8Array or ArrayLike<number>`)
  }
  const { length } = input
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new VdfError('invalid_input', `${what} has an invalid length ${length}`)
  }
  if (length > maxLength) {
    throw new VdfError('invalid_input', `${what} is too long: ${length} > ${maxLength} bytes`)
  }
  // `new Uint8Array(view)` always copies; `Buffer#slice` would return an aliasing view.
  if (input instanceof Uint8Array) return new Uint8Array(input)
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
 * Prover-side check of a claimed output: a bigint in the canonical range
 * $[1, (n-1)/2]$ of $QR_n^+$, else `VdfError('invalid_input')`. (Verifiers return
 * `false` for the same condition instead.)
 */
export function assertCanonicalClaim(y: bigint, n: bigint): void {
  if (typeof y !== 'bigint' || y < 1n || y > (n - 1n) >> 1n) {
    throw new VdfError(
      'invalid_input',
      'y must be a canonical group element: a bigint in [1, (n-1)/2] (see QR_n^+ in the README)',
    )
  }
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

/** Structural check of a {@link WesolowskiProof} (types only), else `VdfError('invalid_input')`. */
export function assertWesolowskiShape(proof: WesolowskiProof): void {
  if (
    typeof proof !== 'object' ||
    proof === null ||
    typeof proof.T !== 'number' ||
    typeof proof.y !== 'bigint' ||
    typeof proof.pi !== 'bigint'
  ) {
    throw new VdfError(
      'invalid_input',
      'proof must be an object { T: number, y: bigint, pi: bigint }',
    )
  }
}

/**
 * Validate checkpoints handed to a prover against the statement's $T$ and $n$:
 * matching `T`, integer `interval` in $[1, T]$, exactly
 * $\lfloor T/\mathrm{interval} \rfloor + 1$ canonical bigint powers. (That
 * `powers[0]` equals the hashed input is checked by the prover.)
 */
export function assertCheckpoints(checkpoints: VdfCheckpoints, T: number, n: bigint): void {
  if (typeof checkpoints !== 'object' || checkpoints === null) {
    throw new VdfError('invalid_input', 'checkpoints must be an object { T, interval, powers }')
  }
  const { interval, powers } = checkpoints
  if (checkpoints.T !== T) {
    throw new VdfError(
      'invalid_input',
      `checkpoints were computed for T=${checkpoints.T}, not T=${T}`,
    )
  }
  if (typeof interval !== 'number' || !Number.isInteger(interval) || interval < 1 || interval > T) {
    throw new VdfError('invalid_input', `checkpoint interval must be an integer in [1, ${T}]`)
  }
  if (!Array.isArray(powers) || powers.length !== Math.floor(T / interval) + 1) {
    throw new VdfError(
      'invalid_input',
      `checkpoints must hold floor(T / interval) + 1 = ${Math.floor(T / interval) + 1} powers`,
    )
  }
  const half = (n - 1n) >> 1n
  for (const power of powers) {
    if (typeof power !== 'bigint' || power < 1n || power > half) {
      throw new VdfError('invalid_input', 'every checkpoint power must be a canonical bigint')
    }
  }
}
