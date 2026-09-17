import { VdfError } from '../errors.js'
import { FINGERPRINT_BYTES, fingerprintSync } from '../hash.js'
import { bigIntToBytes, readU32be } from './bigint.js'
import { toBytes } from './validate.js'

/** Version byte opening every serialized proof and seal. `0x01` was the 0.1.0 format. */
export const WIRE_VERSION = 0x02

/** Second byte: what the bytes encode. */
export const KIND = Object.freeze({ pietrzak: 0x50, wesolowski: 0x57, seal: 0x53 }) // 'P' 'W' 'S'

const KIND_NAMES: Record<number, string> = {
  [KIND.pietrzak]: 'a Pietrzak proof',
  [KIND.wesolowski]: 'a Wesolowski proof',
  [KIND.seal]: 'a beacon seal',
}

/** version (1) + kind (1) + modulus fingerprint (8). */
export const PREFIX_BYTES = 2 + FINGERPRINT_BYTES

/** Write `[version][kind][fingerprint]` at offset 0. */
export function writePrefix(out: Uint8Array, kind: number, n: bigint): void {
  out[0] = WIRE_VERSION
  out[1] = kind
  out.set(fingerprintSync(n), 2)
}

/** Range-check an element for encoding: a bigint in $[0, n)$, else `invalid_input`. */
export function encodeElement(value: bigint, n: bigint, width: number, what: string): Uint8Array {
  if (value < 0n || value >= n) {
    throw new VdfError('invalid_input', `${what} must be in [0, n) to serialize`)
  }
  return bigIntToBytes(value, width)
}

/**
 * Copy untrusted bytes and validate the common prefix, in this order: declared
 * length $\le$ `maxLength` (before any allocation), version byte
 * (`unsupported_version`, with a pointer to 0.1.0 for `0x01`), minimum length,
 * kind byte (`invalid_input`), modulus fingerprint (`modulus_mismatch`).
 */
export function readPrefix(
  bytes: Uint8Array | ArrayLike<number>,
  kind: number,
  n: bigint,
  minLength: number,
  maxLength: number,
): Uint8Array {
  const what = KIND_NAMES[kind] ?? 'wire bytes'
  const buf = toBytes(bytes, `${what} bytes`, maxLength)
  if (buf.length === 0) throw new VdfError('invalid_input', `${what}: empty input`)
  const version = buf[0] as number
  if (version !== WIRE_VERSION) {
    const hint =
      version === 0x01
        ? ' — version 0x01 is the @mindpeeker/vdf 0.1.0 format, which 0.2.0 no longer accepts (canonical QR_n^+ elements and a modulus-bound transcript changed every proof); re-prove from the input'
        : ''
    throw new VdfError(
      'unsupported_version',
      `${what}: unsupported wire version 0x${version.toString(16).padStart(2, '0')}, expected 0x02${hint}`,
    )
  }
  if (buf.length < minLength) {
    throw new VdfError('invalid_input', `${what}: too short (${buf.length} < ${minLength} bytes)`)
  }
  if (buf[1] !== kind) {
    const found =
      KIND_NAMES[buf[1] as number] ?? `unknown kind 0x${(buf[1] as number).toString(16)}`
    throw new VdfError('invalid_input', `expected ${what}, found ${found}`)
  }
  const expected = fingerprintSync(n)
  for (let i = 0; i < FINGERPRINT_BYTES; i++) {
    if (buf[2 + i] !== expected[i]) {
      throw new VdfError(
        'modulus_mismatch',
        `${what} was produced under a different modulus (fingerprint mismatch)`,
      )
    }
  }
  return buf
}

/** Read a header $T$ at `offset` and require $T \ge 1$. */
export function readT(buf: Uint8Array, offset: number): number {
  const T = readU32be(buf, offset)
  if (T < 1) throw new VdfError('invalid_input', 'header T must be >= 1')
  return T
}
