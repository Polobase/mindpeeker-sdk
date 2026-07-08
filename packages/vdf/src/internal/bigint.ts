import { VdfError } from '../errors.js'

/**
 * Modular exponentiation $b^e \bmod m$ by right-to-left binary
 * square-and-multiply (Knuth, *TAOCP* vol. 2, §4.6.3): $O(\log e)$ modular
 * multiplications on native bigints. Negative bases are reduced into
 * $[0, m)$; negative exponents are rejected (no modular inverse here).
 */
export function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  if (modulus <= 0n) throw new VdfError('invalid_input', 'modPow: modulus must be positive')
  if (exponent < 0n) throw new VdfError('invalid_input', 'modPow: exponent must be non-negative')
  if (modulus === 1n) return 0n
  let b = base % modulus
  if (b < 0n) b += modulus
  let e = exponent
  let result = 1n
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % modulus
    e >>= 1n
    if (e > 0n) b = (b * b) % modulus
  }
  return result
}

/**
 * Number of bits in the binary expansion of $v \ge 0$:
 * $\lfloor \log_2 v \rfloor + 1$, with `bitLength(0) = 0`. Computed from the
 * hex expansion so it stays $O(\log v)$ without a bigint loop.
 */
export function bitLength(v: bigint): number {
  if (v < 0n) throw new VdfError('invalid_input', 'bitLength: value must be non-negative')
  if (v === 0n) return 0
  const hex = v.toString(16)
  const top = Number.parseInt(hex[0] as string, 16)
  return 4 * (hex.length - 1) + (32 - Math.clz32(top))
}

/**
 * Bytes needed for the big-endian encoding of $v \ge 0$:
 * $\max(1, \lceil \mathrm{bitLength}(v) / 8 \rceil)$ — zero still occupies one byte.
 */
export function byteLength(v: bigint): number {
  return Math.max(1, (bitLength(v) + 7) >> 3)
}

/** Big-endian bytes → non-negative bigint. The empty input decodes to $0$. */
export function bytesToBigInt(bytes: Uint8Array): bigint {
  if (bytes.length === 0) return 0n
  let hex = ''
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return BigInt(`0x${hex}`)
}

/**
 * Non-negative bigint → fixed-width big-endian bytes (left-padded with zeros).
 * Throws `invalid_input` when the value needs more than `width` bytes, so a
 * transcript or serialized proof can never silently truncate a group element.
 */
export function bigIntToBytes(value: bigint, width: number): Uint8Array {
  if (value < 0n) throw new VdfError('invalid_input', 'bigIntToBytes: value must be non-negative')
  if (!Number.isInteger(width) || width < 1) {
    throw new VdfError(
      'invalid_input',
      `bigIntToBytes: width must be a positive integer, got ${width}`,
    )
  }
  const out = new Uint8Array(width)
  let v = value
  for (let i = width - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn)
    v >>= 8n
  }
  if (v !== 0n) {
    throw new VdfError('invalid_input', `bigIntToBytes: value does not fit in ${width} bytes`)
  }
  return out
}

/**
 * $\lceil t/2 \rceil$ — the halving step of the Pietrzak recursion. Uses
 * floating-point division, not `(t + 1) >> 1`, because JS shift operators
 * work in 32-bit signed integers and overflow at the top of the supported
 * $T \le 2^{32} - 1$ range.
 */
export function ceilHalf(t: number): number {
  return Math.ceil(t / 2)
}

/** Encode an integer in $[0, 2^{32})$ as 4 big-endian bytes. */
export function u32be(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new VdfError(
      'invalid_input',
      `u32be: value must be an integer in [0, 2^32), got ${value}`,
    )
  }
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ])
}

/** Read 4 big-endian bytes at `offset` as an unsigned 32-bit integer. */
export function readU32be(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) {
    throw new VdfError('invalid_input', 'readU32be: out of range')
  }
  return (
    (((bytes[offset] as number) << 24) |
      ((bytes[offset + 1] as number) << 16) |
      ((bytes[offset + 2] as number) << 8) |
      (bytes[offset + 3] as number)) >>>
    0
  )
}
