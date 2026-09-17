/**
 * Synchronous SHA-256 (FIPS 180-4, §6.2) on `Uint8Array`s.
 *
 * The package hashes only short transcripts, so a small portable implementation
 * replaces `crypto.subtle.digest`: it is synchronous (wire formats and modulus
 * fingerprints stay sync), deterministic, and also works where WebCrypto is
 * unavailable (browsers restrict `crypto.subtle` to secure contexts). The test
 * suite pins it to the FIPS 180-4 example vectors, re-derives the round constants
 * from the cube/square roots of the first primes, and cross-checks it against
 * `crypto.subtle` for every length 0–300 plus random inputs.
 */

/** First 32 bits of the fractional parts of the cube roots of the first 64 primes (FIPS 180-4 §4.2.2). */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/** First 32 bits of the fractional parts of the square roots of the first 8 primes (FIPS 180-4 §5.3.3). */
const H0 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
])

/** Exposed for the constant re-derivation test only. */
export const SHA256_CONSTANTS = Object.freeze({ K, H0 })

const W = new Uint32Array(64)

function compress(h: Uint32Array, block: Uint8Array, offset: number): void {
  for (let t = 0; t < 16; t++) {
    const o = offset + 4 * t
    W[t] =
      (((block[o] as number) << 24) |
        ((block[o + 1] as number) << 16) |
        ((block[o + 2] as number) << 8) |
        (block[o + 3] as number)) >>>
      0
  }
  for (let t = 16; t < 64; t++) {
    const w15 = W[t - 15] as number
    const w2 = W[t - 2] as number
    const s1 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3)
    const s2 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10)
    W[t] = ((W[t - 16] as number) + s1 + (W[t - 7] as number) + s2) >>> 0
  }
  let a = h[0] as number
  let b = h[1] as number
  let c = h[2] as number
  let d = h[3] as number
  let e = h[4] as number
  let f = h[5] as number
  let g = h[6] as number
  let hh = h[7] as number
  for (let t = 0; t < 64; t++) {
    const s = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
    const ch = (e & f) ^ (~e & g)
    const t1 = (hh + s + ch + (K[t] as number) + (W[t] as number)) | 0
    const r = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
    const maj = (a & b) ^ (a & c) ^ (b & c)
    const t2 = (r + maj) | 0
    hh = g
    g = f
    f = e
    e = (d + t1) | 0
    d = c
    c = b
    b = a
    a = (t1 + t2) | 0
  }
  h[0] = ((h[0] as number) + a) >>> 0
  h[1] = ((h[1] as number) + b) >>> 0
  h[2] = ((h[2] as number) + c) >>> 0
  h[3] = ((h[3] as number) + d) >>> 0
  h[4] = ((h[4] as number) + e) >>> 0
  h[5] = ((h[5] as number) + f) >>> 0
  h[6] = ((h[6] as number) + g) >>> 0
  h[7] = ((h[7] as number) + hh) >>> 0
}

/** SHA-256 digest (32 bytes) of `data`. Does not modify its argument. */
export function sha256(data: Uint8Array): Uint8Array {
  const h = Uint32Array.from(H0)
  const len = data.length
  const fullBlocks = Math.floor(len / 64)
  for (let i = 0; i < fullBlocks; i++) compress(h, data, i * 64)
  // Tail: remaining bytes, 0x80, zero padding, 64-bit big-endian bit length.
  const rest = len - fullBlocks * 64
  const tail = new Uint8Array(rest + 9 <= 64 ? 64 : 128)
  tail.set(data.subarray(fullBlocks * 64), 0)
  tail[rest] = 0x80
  const bitsHigh = Math.floor(len / 0x2000_0000)
  const bitsLow = (len * 8) >>> 0
  const end = tail.length
  tail[end - 8] = (bitsHigh >>> 24) & 0xff
  tail[end - 7] = (bitsHigh >>> 16) & 0xff
  tail[end - 6] = (bitsHigh >>> 8) & 0xff
  tail[end - 5] = bitsHigh & 0xff
  tail[end - 4] = (bitsLow >>> 24) & 0xff
  tail[end - 3] = (bitsLow >>> 16) & 0xff
  tail[end - 2] = (bitsLow >>> 8) & 0xff
  tail[end - 1] = bitsLow & 0xff
  for (let o = 0; o < end; o += 64) compress(h, tail, o)
  const out = new Uint8Array(32)
  for (let i = 0; i < 8; i++) {
    const v = h[i] as number
    out[4 * i] = v >>> 24
    out[4 * i + 1] = (v >>> 16) & 0xff
    out[4 * i + 2] = (v >>> 8) & 0xff
    out[4 * i + 3] = v & 0xff
  }
  return out
}
