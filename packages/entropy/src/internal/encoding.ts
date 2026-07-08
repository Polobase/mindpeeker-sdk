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

/** Read an unsigned LEB128 varint. Returns [value, nextOffset]. */
export function readVarint(bytes: Uint8Array, offset: number): [number, number] {
  let value = 0
  let shift = 0
  let position = offset
  while (true) {
    if (position >= bytes.length) throw new TypeError('truncated varint')
    const byte = bytes[position] as number
    position++
    value += (byte & 0x7f) * 2 ** shift
    if ((byte & 0x80) === 0) break
    shift += 7
    if (shift > 49) throw new TypeError('varint too large')
  }
  return [value, position]
}

/**
 * Extract the multihash digest bytes from a base32 CIDv1 string (e.g. a CURBy
 * twine block CID). The digest of the block's content hash is CURBy's defined
 * per-pulse randomness.
 */
export function cidDigest(cid: string): Uint8Array {
  if (!cid.startsWith('b')) {
    throw new TypeError(`expected a base32 CIDv1 (multibase prefix 'b'), got '${cid.slice(0, 4)}…'`)
  }
  const bytes = base32Decode(cid.slice(1))
  let offset = 0
  let version: number
  ;[version, offset] = readVarint(bytes, offset)
  if (version !== 1) throw new TypeError(`unsupported CID version ${version}`)
  ;[, offset] = readVarint(bytes, offset) // content codec — irrelevant here
  ;[, offset] = readVarint(bytes, offset) // multihash function code — irrelevant here
  let digestLength: number
  ;[digestLength, offset] = readVarint(bytes, offset)
  if (offset + digestLength > bytes.length) throw new TypeError('truncated multihash digest')
  return bytes.slice(offset, offset + digestLength)
}
