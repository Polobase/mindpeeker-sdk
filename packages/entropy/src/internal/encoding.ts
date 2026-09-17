/** Zero-dep decoders for blockchain hashes (base58) and IPLD CIDs (base32/varint). */

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const BASE58_MAP = new Map([...BASE58_ALPHABET].map((c, i) => [c, i]))

/** Decode base58btc (Bitcoin/Solana alphabet). Leading '1's become 0x00 bytes. */
export function base58Decode(input: string): Uint8Array {
  const bytes: number[] = []
  for (const char of input) {
    const value = BASE58_MAP.get(char)
    if (value === undefined) throw new TypeError(`invalid base58 character '${char}'`)
    // long multiplication: bytes = bytes * 58 + value
    let carry = value
    for (let i = bytes.length - 1; i >= 0; i--) {
      const acc = (bytes[i] as number) * 58 + carry
      bytes[i] = acc & 0xff
      carry = acc >> 8
    }
    while (carry > 0) {
      bytes.unshift(carry & 0xff)
      carry >>= 8
    }
  }
  let leadingZeros = 0
  while (leadingZeros < input.length && input[leadingZeros] === '1') leadingZeros++
  return new Uint8Array([...new Array(leadingZeros).fill(0), ...bytes])
}

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'
const BASE32_MAP = new Map([...BASE32_ALPHABET].map((c, i) => [c, i]))

/** Decode RFC 4648 base32, lowercase and unpadded (the CIDv1 default encoding). */
export function base32Decode(input: string): Uint8Array {
  const out: number[] = []
  let buffer = 0
  let bits = 0
  for (const char of input) {
    const value = BASE32_MAP.get(char)
    if (value === undefined) throw new TypeError(`invalid base32 character '${char}'`)
    buffer = (buffer << 5) | value
    bits += 5
    if (bits >= 8) {
      bits -= 8
      out.push((buffer >> bits) & 0xff)
    }
  }
  return new Uint8Array(out)
}

/**
 * Read an unsigned LEB128 varint. Returns [value, nextOffset]. Throws
 * `TypeError` when truncated or when the value exceeds 2⁵³ − 1 (it could not
 * be represented exactly).
 */
export function readVarint(bytes: Uint8Array, offset: number): [number, number] {
  let value = 0
  let shift = 0
  let position = offset
  while (true) {
    if (position >= bytes.length) throw new TypeError('truncated varint')
    const byte = bytes[position] as number
    position++
    value += (byte & 0x7f) * 2 ** shift
    if (value > Number.MAX_SAFE_INTEGER) throw new TypeError('varint too large')
    if ((byte & 0x80) === 0) break
    shift += 7
    if (shift > 49) throw new TypeError('varint too large')
  }
  return [value, position]
}

/** Digest sizes (bytes) of common multihash function codes. */
const MULTIHASH_DIGEST_BYTES: Readonly<Record<number, number>> = Object.freeze({
  18: 32, // sha2-256
  19: 64, // sha2-512
  20: 64, // sha3-512
  21: 48, // sha3-384
  22: 32, // sha3-256
  23: 28, // sha3-224
  27: 32, // keccak-256
})

/**
 * Decode the multihash of a base32 CIDv1 string (e.g. a CURBy twine block
 * CID): its hash function `code` (0x14 = sha3-512 for the CURBy-RNG chain) and
 * the digest bytes. Throws `TypeError` when malformed, including a digest
 * whose length contradicts a known hash function.
 */
export function cidMultihash(cid: string): { code: number; digest: Uint8Array } {
  if (!cid.startsWith('b')) {
    throw new TypeError(`expected a base32 CIDv1 (multibase prefix 'b'), got '${cid.slice(0, 4)}…'`)
  }
  const bytes = base32Decode(cid.slice(1))
  const [version, afterVersion] = readVarint(bytes, 0)
  if (version !== 1) throw new TypeError(`unsupported CID version ${version}`)
  const [, afterCodec] = readVarint(bytes, afterVersion) // content codec — irrelevant here
  const [code, afterCode] = readVarint(bytes, afterCodec)
  const [digestLength, offset] = readVarint(bytes, afterCode)
  if (offset + digestLength > bytes.length) throw new TypeError('truncated multihash digest')
  const known = MULTIHASH_DIGEST_BYTES[code]
  if (known !== undefined && known !== digestLength) {
    throw new TypeError(
      `multihash 0x${code.toString(16)} has ${known}-byte digests, CID carries ${digestLength}`,
    )
  }
  return { code, digest: bytes.slice(offset, offset + digestLength) }
}

/** The multihash digest bytes of a base32 CIDv1 string (see `cidMultihash`). */
export function cidDigest(cid: string): Uint8Array {
  return cidMultihash(cid).digest
}
