import type { Rate } from '@mindpeeker/rate'
import type { SignatureOptions } from '../types.js'

/** UTF-8 encode a string into an `ArrayBuffer`-backed view (browser + Node global). */
function utf8(s: string): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder().encode(s)
  const buf = new Uint8Array(enc.length)
  buf.set(enc)
  return buf
}

/** Lowercase hex of a byte buffer. */
function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

/** SHA-256 of a string via the Web Crypto API (`crypto.subtle`, browser-safe). */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', utf8(input))
  return toHex(new Uint8Array(digest))
}

/**
 * Deterministically map a signature string to a radionic {@link Rate} by
 * hashing it with SHA-256 and partitioning each digest byte into a base-`base`
 * digit:
 *
 * $$d_i = \left\lfloor \frac{\mathrm{digest}_i}{256}\,\cdot\,\mathrm{base}
 *   \right\rfloor \in [0,\ \mathrm{base}),$$
 *
 * taking the first `length` bytes. The partition map keeps every digit in
 * range without a biased `% base` reduction — and because it is a fixed
 * function of a cryptographic hash (not a draw from an entropy source), the
 * rate is stable: the same signature always yields the same rate. This is the
 * SDK-honest analogue of AetherOne's "Broadcast of Hashed Signatures".
 *
 * @example
 * await signatureToRate('John Doe')            // 6-digit base-44 rate
 * await signatureToRate('John Doe', { length: 5, base: 44 })
 */
export async function signatureToRate(
  signature: string,
  opts: SignatureOptions = {},
): Promise<Rate> {
  const length = opts.length ?? 6
  const base = opts.base ?? 44
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(signature)))
  const digits: number[] = []
  for (let i = 0; i < length; i++) {
    const byte = digest[i % digest.length] as number
    digits.push(Math.floor((byte / 256) * base))
  }
  return { digits, base }
}

/**
 * AetherOne's char-code rate: the square root of the sum of the signature's
 * UTF-16 char codes, rounded to two decimals.
 *
 * $$\mathrm{rate}(s) = \operatorname{round}_{2}\!\Big(\sqrt{\textstyle\sum_k
 *   \mathrm{charCode}(s_k)}\,\Big).$$
 *
 * Ported for parity with AetherOnePi's Pi-hardware broadcast, which blinks the
 * digits of this number on coloured LEDs. Returns a **number**, not a `Rate`.
 *
 * @example
 * rateFromCharCodes('abc') // sqrt(97+98+99)=17.146… → 17.15
 */
export function rateFromCharCodes(s: string): number {
  let sum = 0
  for (let i = 0; i < s.length; i++) sum += s.charCodeAt(i)
  return Math.round(Math.sqrt(sum) * 100) / 100
}
