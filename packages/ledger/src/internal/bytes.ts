import { LedgerError } from '../errors.js'

const encoder = new TextEncoder()

/** UTF-8 bytes of a string, or a private copy of a byte array (callers cannot mutate our input). */
export function toBytes(value: Uint8Array | string, what: string): Uint8Array<ArrayBuffer> {
  if (typeof value === 'string') {
    checkWellFormed(value, what)
    return encoder.encode(value)
  }
  if (value instanceof Uint8Array) return new Uint8Array(value)
  throw new LedgerError('invalid_input', `${what} must be a Uint8Array or a string`)
}

/** A private copy of a byte array; rejects anything else. */
export function requireBytes(value: unknown, what: string): Uint8Array<ArrayBuffer> {
  if (!(value instanceof Uint8Array)) {
    throw new LedgerError('invalid_input', `${what} must be a Uint8Array`)
  }
  return new Uint8Array(value)
}

/** Strings are hashed as UTF-8, so a lone surrogate (which UTF-8 cannot encode) is rejected. */
function checkWellFormed(value: string, what: string): void {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++
        continue
      }
      throw new LedgerError('invalid_input', `${what} contains a lone surrogate`)
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new LedgerError('invalid_input', `${what} contains a lone surrogate`)
    }
  }
}

/** Concatenate byte arrays. */
export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  let length = 0
  for (const part of parts) length += part.length
  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** Unsigned 64-bit big-endian encoding of a safe integer ≥ 0. */
export function u64be(value: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(8)
  let rest = value
  for (let i = 7; i >= 0; i--) {
    out[i] = rest % 256
    rest = Math.floor(rest / 256)
  }
  return out
}

/** `LP(x) = u64be(len(x)) ‖ x` — the length prefix that makes concatenations unambiguous. */
export function lengthPrefixed(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return concatBytes(u64be(bytes.length), bytes)
}

/** Byte-wise equality (examines every byte of equal-length inputs). */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number)
  return diff === 0
}

/** Lower-case hex of a byte array. */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

const HEX = /^(?:[0-9a-fA-F]{2})*$/

/** Decode even-length hex (either case). */
export function hexToBytes(hex: string, what: string): Uint8Array<ArrayBuffer> {
  if (typeof hex !== 'string' || !HEX.test(hex)) {
    throw new LedgerError('invalid_input', `${what} must be an even-length hex string`)
  }
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16)
  return out
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_INDEX = new Map([...B64].map((ch, i) => [ch, i]))

/** Standard base64 (RFC 4648 §4) with padding. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += B64[(triple >> 18) & 63]
    out += B64[(triple >> 12) & 63]
    out += b === undefined ? '=' : B64[(triple >> 6) & 63]
    out += c === undefined ? '=' : B64[triple & 63]
  }
  return out
}

/**
 * Strict standard base64 decoding: length a multiple of 4, alphabet
 * `A–Z a–z 0–9 + /`, at most two `=` only at the end, and zero padding bits —
 * so every byte string has exactly one accepted encoding. Returns `undefined`
 * for anything else.
 */
export function base64ToBytes(text: string): Uint8Array<ArrayBuffer> | undefined {
  if (typeof text !== 'string' || text.length % 4 !== 0) return undefined
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0
  const out = new Uint8Array((text.length / 4) * 3 - padding)
  let o = 0
  for (let i = 0; i < text.length; i += 4) {
    const last = i + 4 === text.length
    let triple = 0
    for (let j = 0; j < 4; j++) {
      const ch = text[i + j] as string
      const pad = last && j >= 4 - padding
      const v = pad ? 0 : B64_INDEX.get(ch)
      if (v === undefined || (pad && ch !== '=')) return undefined
      triple = (triple << 6) | v
    }
    if (last && padding === 2 && (triple & 0xffff) !== 0) return undefined
    if (last && padding === 1 && (triple & 0xff) !== 0) return undefined
    out[o++] = (triple >> 16) & 0xff
    if (o < out.length) out[o++] = (triple >> 8) & 0xff
    if (o < out.length) out[o++] = triple & 0xff
  }
  return out
}

/** Throw unless `value` is a safe integer ≥ `min`. */
export function requireSafeInteger(value: unknown, what: string, min = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
    throw new LedgerError('invalid_input', `${what} must be a safe integer ≥ ${min}`)
  }
  return value
}
