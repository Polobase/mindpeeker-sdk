import { LedgerError } from './errors.js'
import { bytesToHex, hexToBytes, toBytes } from './internal/bytes.js'
import { digest256 } from './internal/subtle.js'

/** 64 zero hex digits: the default chain genesis (also psi's `ZERO_HASH`). */
export const ZERO_HASH = '0'.repeat(64)

const HASH_HEX = /^[0-9a-f]{64}$/

/**
 * SHA-256 (FIPS 180-4) through WebCrypto. A string is hashed as its UTF-8
 * bytes (a lone surrogate, which UTF-8 cannot encode, is rejected).
 *
 * @throws {LedgerError} `invalid_input` for anything but a `Uint8Array` or a
 *   well-formed string; `crypto_unavailable` without `crypto.subtle`.
 */
export async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  return digest256(toBytes(data, 'data'))
}

/** Lower-case hex SHA-256 of `data` (see {@link sha256}). */
export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  return bytesToHex(await sha256(data))
}

/** True for a lower-case 64-digit hex string — the form every record in this package uses. */
export function isHashHex(value: unknown): value is string {
  return typeof value === 'string' && HASH_HEX.test(value)
}

/** Lower-case hex encoding of bytes. */
export function toHex(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) {
    throw new LedgerError('invalid_input', 'toHex expects a Uint8Array')
  }
  return bytesToHex(bytes)
}

/**
 * Decode an even-length hex string (upper or lower case) to bytes.
 *
 * @throws {LedgerError} `invalid_input` for odd length or a non-hex digit.
 */
export function fromHex(hex: string): Uint8Array {
  return hexToBytes(hex, 'hex')
}
