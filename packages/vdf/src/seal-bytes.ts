import type { BeaconSeal } from './beacon.js'
import { verifySeal } from './beacon.js'
import { VdfError } from './errors.js'
import { byteLength, bytesToBigInt, u32be } from './internal/bigint.js'
import { sha256 } from './internal/sha256.js'
import { assertModulus, assertProofShape, assertT, toBytes } from './internal/validate.js'
import {
  encodeElement,
  KIND,
  PREFIX_BYTES,
  readPrefix,
  readT,
  writePrefix,
} from './internal/wire.js'
import { RSA2048 } from './moduli.js'
import { pietrzakRounds } from './prove.js'
import type { SerializeOptions } from './serialize.js'
import type { VerifyOptions } from './verify.js'

/** Seal header: version, kind, fingerprint (10) + SHA-256(pulse) (32) + u32 $T$ (4). */
const SEAL_HEADER = PREFIX_BYTES + 32 + 4

/** A parsed seal plus the pulse digest it commits to. */
export interface DecodedSeal {
  readonly seal: BeaconSeal
  /** SHA-256 of the pulse bytes the seal was made for (32 bytes). */
  readonly pulseDigest: Uint8Array
}

/**
 * Serialize a {@link BeaconSeal} together with the SHA-256 of its pulse, making
 * the seal self-describing and portable. Layout (big-endian, $w$ = modulus
 * byte length):
 *
 * | offset | size | field |
 * |---|---|---|
 * | 0 | 1 | version `0x02` |
 * | 1 | 1 | kind `0x53` (`'S'`) |
 * | 2 | 8 | modulus fingerprint |
 * | 10 | 32 | $\mathrm{SHA256}(\mathrm{pulse})$ (plain SHA-256 of the pulse bytes) |
 * | 42 | 4 | $T$ as u32 |
 * | 46 | $w$ | $y$ |
 * | $46 + w(1+i)$ | $w$ | $\mu_{i+1}$, $i < \lceil \log_2 T \rceil$ |
 *
 * Total $46 + w(1 + \lceil \log_2 T \rceil)$ bytes. Throws
 * `VdfError('invalid_input')` for a structurally broken seal, a `seal.T` /
 * `seal.proof.T` or `seal.y` / `seal.proof.y` disagreement, a wrong midpoint count,
 * or elements outside $[0, n)$.
 */
export function sealToBytes(
  seal: BeaconSeal,
  pulse: Uint8Array | ArrayLike<number>,
  opts: SerializeOptions = {},
): Uint8Array {
  const n = assertModulus(opts.modulus ?? RSA2048)
  if (typeof seal !== 'object' || seal === null) {
    throw new VdfError('invalid_input', 'seal must be an object { T, y, proof }')
  }
  assertProofShape(seal.proof)
  assertT(seal.T)
  if (seal.T !== seal.proof.T || seal.y !== seal.proof.y) {
    throw new VdfError('invalid_input', 'seal T/y must restate its proof')
  }
  const rounds = pietrzakRounds(seal.T)
  if (seal.proof.mus.length !== rounds) {
    throw new VdfError('invalid_input', `seal proof for T=${seal.T} must have ${rounds} midpoints`)
  }
  const width = byteLength(n)
  const out = new Uint8Array(SEAL_HEADER + width * (1 + rounds))
  writePrefix(out, KIND.seal, n)
  out.set(sha256(toBytes(pulse, 'pulse')), PREFIX_BYTES)
  out.set(u32be(seal.T), PREFIX_BYTES + 32)
  out.set(encodeElement(seal.y, n, width, 'y'), SEAL_HEADER)
  seal.proof.mus.forEach((mu, i) => {
    out.set(encodeElement(mu, n, width, `mus[${i}]`), SEAL_HEADER + width * (1 + i))
  })
  return out
}

/**
 * Parse bytes produced by {@link sealToBytes}. Strict: length checked against the
 * largest possible seal ($46 + 33w$) before allocating, version `0x02` (else
 * `unsupported_version`), kind `'S'`, modulus fingerprint (else
 * `modulus_mismatch`), $T \ge 1$, exact length. Values are not range-checked
 * (verification's job). Compare `pulseDigest` with the SHA-256 of a candidate pulse
 * — or call {@link verifySealBytes} — before spending group arithmetic.
 */
export function sealFromBytes(
  bytes: Uint8Array | ArrayLike<number>,
  opts: SerializeOptions = {},
): DecodedSeal {
  const n = assertModulus(opts.modulus ?? RSA2048)
  const width = byteLength(n)
  const buf = readPrefix(bytes, KIND.seal, n, SEAL_HEADER, SEAL_HEADER + width * 33)
  const pulseDigest = buf.slice(PREFIX_BYTES, PREFIX_BYTES + 32)
  const T = readT(buf, PREFIX_BYTES + 32)
  const rounds = pietrzakRounds(T)
  const expected = SEAL_HEADER + width * (1 + rounds)
  if (buf.length !== expected) {
    throw new VdfError(
      'invalid_input',
      `seal for T=${T} must be ${expected} bytes at this modulus width, got ${buf.length}`,
    )
  }
  const y = bytesToBigInt(buf.subarray(SEAL_HEADER, SEAL_HEADER + width))
  const mus: bigint[] = []
  for (let i = 0; i < rounds; i++) {
    const start = SEAL_HEADER + width * (1 + i)
    mus.push(bytesToBigInt(buf.subarray(start, start + width)))
  }
  const proof = Object.freeze({ T, y, mus: Object.freeze(mus) })
  return Object.freeze({ seal: Object.freeze({ T, y, proof }), pulseDigest })
}

/**
 * Parse serialized seal bytes and verify them against `pulse`: returns `false`
 * when the embedded pulse digest differs from $\mathrm{SHA256}(\mathrm{pulse})$
 * (without touching the group) or when `verifySeal` rejects. Malformed bytes
 * throw exactly as {@link sealFromBytes} does.
 */
export async function verifySealBytes(
  pulse: Uint8Array | ArrayLike<number>,
  bytes: Uint8Array | ArrayLike<number>,
  opts: VerifyOptions = {},
): Promise<boolean> {
  const { seal, pulseDigest } = sealFromBytes(bytes, opts)
  const digest = sha256(toBytes(pulse, 'pulse'))
  for (let i = 0; i < 32; i++) {
    if (digest[i] !== pulseDigest[i]) return false
  }
  return verifySeal(pulse, seal, opts)
}
