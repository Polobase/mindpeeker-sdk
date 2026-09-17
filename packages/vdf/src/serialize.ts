import { VdfError } from './errors.js'
import { byteLength, bytesToBigInt, u32be } from './internal/bigint.js'
import {
  assertModulus,
  assertProofShape,
  assertT,
  assertWesolowskiShape,
} from './internal/validate.js'
import {
  encodeElement,
  KIND,
  PREFIX_BYTES,
  readPrefix,
  readT,
  WIRE_VERSION,
  writePrefix,
} from './internal/wire.js'
import { RSA2048 } from './moduli.js'
import { pietrzakRounds } from './prove.js'
import type { PietrzakProof, RsaModulus, WesolowskiProof } from './types.js'

/** Version byte opening every serialized proof and seal (`0x02` since 0.2.0; 0.1.0 wrote `0x01`). */
export const PROOF_VERSION = WIRE_VERSION

/** Header of a serialized proof: version, kind, 8-byte modulus fingerprint, u32 $T$. */
const HEADER = PREFIX_BYTES + 4

/** Most halving rounds any $T \le 2^{32} - 1$ needs. */
const MAX_ROUNDS = 32

export interface SerializeOptions {
  /**
   * Group the proof lives in — the element width on the wire is the modulus
   * byte length and the header carries its fingerprint, so both sides must
   * agree on it. Default {@link RSA2048}.
   */
  modulus?: RsaModulus
}

/**
 * Serialize a Pietrzak proof. Fixed layout, integers big-endian, element width
 * $w = \lceil \mathrm{bitLength}(n)/8 \rceil$:
 *
 * | offset | size | field |
 * |---|---|---|
 * | 0 | 1 | version {@link PROOF_VERSION} (`0x02`) |
 * | 1 | 1 | kind `0x50` (`'P'`) |
 * | 2 | 8 | modulus fingerprint (`modulusFingerprint`) |
 * | 10 | 4 | $T$ as u32 |
 * | 14 | $w$ | $y$ |
 * | $14 + w(1+i)$ | $w$ | $\mu_{i+1}$, for $i = 0 \dots \lceil \log_2 T \rceil - 1$ |
 *
 * Total: $14 + w(1 + \lceil \log_2 T \rceil)$ bytes. Throws
 * `VdfError('invalid_input')` when the midpoint count does not match $T$ or any
 * element is outside $[0, n)$ (canonical form is the verifier's check).
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
  const out = new Uint8Array(HEADER + width * (1 + rounds))
  writePrefix(out, KIND.pietrzak, n)
  out.set(u32be(proof.T), PREFIX_BYTES)
  out.set(encodeElement(proof.y, n, width, 'y'), HEADER)
  proof.mus.forEach((mu, i) => {
    out.set(encodeElement(mu, n, width, `mus[${i}]`), HEADER + width * (1 + i))
  })
  return out
}

/**
 * Parse bytes produced by {@link proofToBytes}. Strict, in this order: the input
 * length must not exceed the largest possible proof ($14 + 33w$ bytes) — checked
 * before anything is allocated; version `0x02` (else `unsupported_version`,
 * including every 0.1.0 proof); kind `'P'`; fingerprint of the given modulus
 * (else `modulus_mismatch`); header $T \ge 1$; total length exactly
 * $14 + w(1 + \lceil \log_2 T \rceil)$. Any other defect throws
 * `VdfError('invalid_input')`. Decoded *values* are not range-checked — that is
 * `pietrzakVerify`'s job (a bit-flipped element should verify `false`).
 */
export function proofFromBytes(
  bytes: Uint8Array | ArrayLike<number>,
  opts: SerializeOptions = {},
): PietrzakProof {
  const n = assertModulus(opts.modulus ?? RSA2048)
  const width = byteLength(n)
  const buf = readPrefix(bytes, KIND.pietrzak, n, HEADER, HEADER + width * (1 + MAX_ROUNDS))
  const T = readT(buf, PREFIX_BYTES)
  const rounds = pietrzakRounds(T)
  const expected = HEADER + width * (1 + rounds)
  if (buf.length !== expected) {
    throw new VdfError(
      'invalid_input',
      `proof for T=${T} must be ${expected} bytes at this modulus width, got ${buf.length}`,
    )
  }
  const y = bytesToBigInt(buf.subarray(HEADER, HEADER + width))
  const mus: bigint[] = []
  for (let i = 0; i < rounds; i++) {
    const start = HEADER + width * (1 + i)
    mus.push(bytesToBigInt(buf.subarray(start, start + width)))
  }
  return Object.freeze({ T, y, mus: Object.freeze(mus) })
}

/**
 * Serialize a Wesolowski proof: the same 14-byte header with kind `0x57`
 * (`'W'`), then $y$ and $\pi$ at width $w$ — $14 + 2w$ bytes in total (526 bytes
 * at 2048 bits, independent of $T$).
 */
export function wesolowskiToBytes(proof: WesolowskiProof, opts: SerializeOptions = {}): Uint8Array {
  const n = assertModulus(opts.modulus ?? RSA2048)
  assertWesolowskiShape(proof)
  assertT(proof.T)
  const width = byteLength(n)
  const out = new Uint8Array(HEADER + 2 * width)
  writePrefix(out, KIND.wesolowski, n)
  out.set(u32be(proof.T), PREFIX_BYTES)
  out.set(encodeElement(proof.y, n, width, 'y'), HEADER)
  out.set(encodeElement(proof.pi, n, width, 'pi'), HEADER + width)
  return out
}

/**
 * Parse bytes produced by {@link wesolowskiToBytes}, with the same strictness as
 * {@link proofFromBytes} (length checked before allocation, `unsupported_version`,
 * kind `'W'`, `modulus_mismatch`, $T \ge 1$, exact length $14 + 2w$).
 */
export function wesolowskiFromBytes(
  bytes: Uint8Array | ArrayLike<number>,
  opts: SerializeOptions = {},
): WesolowskiProof {
  const n = assertModulus(opts.modulus ?? RSA2048)
  const width = byteLength(n)
  const length = HEADER + 2 * width
  const buf = readPrefix(bytes, KIND.wesolowski, n, HEADER, length)
  const T = readT(buf, PREFIX_BYTES)
  if (buf.length !== length) {
    throw new VdfError(
      'invalid_input',
      `Wesolowski proof must be ${length} bytes, got ${buf.length}`,
    )
  }
  const y = bytesToBigInt(buf.subarray(HEADER, HEADER + width))
  const pi = bytesToBigInt(buf.subarray(HEADER + width, length))
  return Object.freeze({ T, y, pi })
}
