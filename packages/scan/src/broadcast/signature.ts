import type { Rate } from '@mindpeeker/rate'
import { ScanError } from '../errors.js'
import { Sha256, toHex } from '../internal/sha256.js'
import { integerIn, optionsObject } from '../internal/validate.js'
import type { SignatureOptions } from '../types.js'

/** UTF-8 encode a string. */
function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

function requireString(input: unknown, what: string): string {
  if (typeof input !== 'string') {
    throw new ScanError('invalid_target', `${what} must be a string`)
  }
  return input
}

/** SHA-256 hex of a string's UTF-8 bytes (exactly as given — not normalized). */
export async function sha256Hex(input: string): Promise<string> {
  return toHex(new Sha256().update(utf8(requireString(input, 'sha256Hex input'))).digest())
}

/** MSB-first bits of `digest ‖ SHA-256(digest ‖ 1) ‖ SHA-256(digest ‖ 2) ‖ …` (counter: 4-byte big-endian). */
class DigestBits {
  readonly #digest: Uint8Array
  #block: Uint8Array
  #counter = 0
  #bit = 0

  constructor(digest: Uint8Array) {
    this.#digest = digest
    this.#block = digest
  }

  #nextBit(): number {
    if (this.#bit === 256) {
      this.#counter++
      const c = this.#counter
      const suffix = new Uint8Array([c >>> 24, (c >>> 16) & 0xff, (c >>> 8) & 0xff, c & 0xff])
      this.#block = new Sha256().update(this.#digest).update(suffix).digest()
      this.#bit = 0
    }
    const byte = this.#block[this.#bit >>> 3] as number
    const bit = (byte >>> (7 - (this.#bit & 7))) & 1
    this.#bit++
    return bit
  }

  /** `width` bits as a big-endian unsigned integer (`width` ≤ 32). */
  next(width: number): number {
    let v = 0
    for (let i = 0; i < width; i++) v = v * 2 + this.#nextBit()
    return v
  }
}

/**
 * Deterministically map a signature string to a radionic {@link Rate} by
 * hashing it and reading each digit from the hash **by rejection**:
 *
 * 1. Normalize the signature to Unicode NFC (so a precomposed "é" and
 *    "e" + combining acute — the same text a person typed — give the same
 *    rate) and take $D = \mathrm{SHA\text{-}256}(\mathrm{UTF\text{-}8})$.
 * 2. Read the bit stream $D \,\|\, H_1 \,\|\, H_2 \,\|\, \dots$ MSB-first, with
 *    $H_i = \mathrm{SHA\text{-}256}(D \,\|\, i)$ ($i$ as 4-byte big-endian) —
 *    extended only as far as needed.
 * 3. For each digit take $w = \lceil \log_2 \mathrm{base} \rceil$ bits as an
 *    integer $v$; accept $d = v$ if $v < \mathrm{base}$, else discard the $w$
 *    bits and read the next $w$.
 *
 * Modeling SHA-256 as a random function, every digit is **exactly** uniform
 * on $[0, \mathrm{base})$ and independent — for base 44 ($w = 6$, acceptance
 * $44/64$) as for Combe's base 336 ($w = 9$), whose every digit is reachable.
 * (0.1 used $\lfloor \mathrm{byte} \cdot \mathrm{base}/256 \rfloor$, which is as
 * non-uniform as `% base` for 44, reached only 256 of 336 digits, and repeated
 * the digest past 32 digits.)
 *
 * Because the rate is a fixed function of a hash — not a draw from an entropy
 * source — the same signature always yields the same rate. This is the
 * SDK-honest analogue of AetherOne's "Broadcast of Hashed Signatures"; using a
 * signature as a witness goes back to Abrams' handwriting claims (Hudgings
 * 1923). Nothing is transmitted.
 *
 * @example
 * await signatureToRate('John Doe')            // 6-digit base-44 rate
 * await signatureToRate('John Doe', { length: 5, base: 336 })
 *
 * @throws {ScanError} `invalid_target` for a non-string signature;
 *   `invalid_options` for `length` outside $[1, 4096]$ or `base` outside
 *   $[2, 2^{32}]$
 */
export async function signatureToRate(
  signature: string,
  opts: SignatureOptions = {},
): Promise<Rate> {
  const text = requireString(signature, 'signature').normalize('NFC')
  const o = optionsObject(opts, 'signatureToRate options')
  const length = integerIn(o.length ?? 6, 'length', 1, 4096)
  const base = integerIn(o.base ?? 44, 'base', 2, 2 ** 32)
  const width = 32 - Math.clz32(base - 1)
  const bits = new DigestBits(new Sha256().update(utf8(text)).digest())
  const digits: number[] = []
  while (digits.length < length) {
    const v = bits.next(width)
    if (v < base) digits.push(v)
  }
  return Object.freeze({ digits: Object.freeze(digits), base })
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
 *
 * @throws {ScanError} `invalid_target` for a non-string input
 */
export function rateFromCharCodes(s: string): number {
  const text = requireString(s, 'rateFromCharCodes input')
  let sum = 0
  for (let i = 0; i < text.length; i++) sum += text.charCodeAt(i)
  return Math.round(Math.sqrt(sum) * 100) / 100
}
