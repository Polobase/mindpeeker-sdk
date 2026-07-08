import { VdfError } from './errors.js'
import { bigIntToBytes, byteLength, bytesToBigInt, readU32be, u32be } from './internal/bigint.js'
import { assertModulus, assertProofShape, assertT, toBytes } from './internal/validate.js'
import { RSA2048 } from './moduli.js'
import { pietrzakRounds } from './prove.js'
import type { PietrzakProof, RsaModulus } from './types.js'

/** Version byte opening every serialized proof. Bump on any wire-format change. */
export const PROOF_VERSION = 0x01

export interface SerializeOptions {
  /**
   * Group the proof lives in — the element width on the wire is the modulus
   * byte length, so both sides must agree on it. Default {@link RSA2048}.
   */
  modulus?: RsaModulus
}

/**
 * Serialize a proof to bytes. Fixed layout, all integers big-endian, element
 * width $w = \lceil \mathrm{bitLength}(n)/8 \rceil$:
 *
 * | offset | size | field |
 * |---|---|---|
 * | 0 | 1 | version ({@link PROOF_VERSION}) |
 * | 1 | 4 | $T$ as u32 |
 * | 5 | $w$ | $y$ |
 * | $5 + w(1+i)$ | $w$ | $\mu_{i+1}$, for $i = 0 \dots \lceil \log_2 T \rceil - 1$ |
 *
 * Total: $5 + w(1 + \lceil \log_2 T \rceil)$ bytes. Throws
 * `VdfError('invalid_input')` when the proof's midpoint count does not match
 * its own $T$, or any element is outside $[0, n)$.
 */
export function proofToBytes(proof: PietrzakProof, opts: SerializeOptions = {}): Uint8Array {
  const n = assertModulus(opts.modulus ?? RSA2048)
  assertProofShape(proof)
  assertT(proof.T)
  const rounds = pietrzakRounds(proof.T)
  if (proof.mus.length !== rounds) {
    throw new VdfError(
      'invalid_input',
      `proof has ${proof.mus.length} midpoints but T=${proof.T} requires ${rounds}`,
    )
  }
  const width = byteLength(n)
  const check = (value: bigint, what: string): bigint => {
    if (value < 0n || value >= n) {
      throw new VdfError('invalid_input', `${what} must be in [0, n) to serialize`)
    }
    return value
  }
  const out = new Uint8Array(5 + width * (1 + rounds))
  out[0] = PROOF_VERSION
  out.set(u32be(proof.T), 1)
  out.set(bigIntToBytes(check(proof.y, 'y'), width), 5)
  for (let i = 0; i < rounds; i++) {
    out.set(bigIntToBytes(check(proof.mus[i] as bigint, `mus[${i}]`), width), 5 + width * (1 + i))
  }
  return out
}

/**
 * Parse bytes produced by {@link proofToBytes}. Strict: the version byte must
 * be {@link PROOF_VERSION}, the header $T$ must be $\ge 1$, and the total
 * length must be exactly $5 + w(1 + \lceil \log_2 T \rceil)$ for the given
 * modulus — anything else throws `VdfError('invalid_input')`. Decoded
 * *values* are not range-checked against $n$; that is `pietrzakVerify`'s job
 * (a bit-flipped element should verify `false`, not explode here).
 */
export function proofFromBytes(
  bytes: Uint8Array | ArrayLike<number>,
  opts: SerializeOptions = {},
): PietrzakProof {
  const n = assertModulus(opts.modulus ?? RSA2048)
  const buf = toBytes(bytes, 'proof bytes')
  if (buf.length < 5) {
    throw new VdfError('invalid_input', `proof bytes too short: ${buf.length} < 5`)
  }
  if (buf[0] !== PROOF_VERSION) {
    throw new VdfError('invalid_input', `unsupported proof version ${buf[0]}`)
  }
  const T = readU32be(buf, 1)
  if (T < 1) throw new VdfError('invalid_input', 'proof header T must be >= 1')
  const width = byteLength(n)
  const rounds = pietrzakRounds(T)
  const expected = 5 + width * (1 + rounds)
  if (buf.length !== expected) {
    throw new VdfError(
      'invalid_input',
      `proof for T=${T} must be ${expected} bytes at this modulus width, got ${buf.length}`,
    )
  }
  const y = bytesToBigInt(buf.subarray(5, 5 + width))
  const mus: bigint[] = []
  for (let i = 0; i < rounds; i++) {
    const start = 5 + width * (1 + i)
    mus.push(bytesToBigInt(buf.subarray(start, start + width)))
  }
  return Object.freeze({ T, y, mus: Object.freeze(mus) })
}
