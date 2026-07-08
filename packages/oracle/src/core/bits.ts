import { OracleError } from '../errors.js'
import type { ByteReader } from './reader.js'

/**
 * MSB-first bit consumer on top of a {@link ByteReader} — the SDK-wide bit
 * order. Bytes are pulled lazily one at a time; a partially consumed byte
 * stays buffered, so $k$ power-of-two draws of $b$ bits cost exactly
 * $\lceil kb/8 \rceil$ bytes.
 */
export interface BitReader {
  /** The underlying byte reader (shared `bytesConsumed` accounting). */
  readonly reader: ByteReader
  /** Bits handed out so far. `bitsUsed` $\le 8 \cdot$ bytes this reader pulled. */
  readonly bitsUsed: number
  /** Consume one bit, MSB first within each byte. */
  nextBit(): Promise<0 | 1>
  /**
   * Consume `count` bits ($0 \le \texttt{count} \le 48$) as a big-endian
   * unsigned integer in $[0, 2^{\texttt{count}})$. 48 keeps every value
   * exactly representable in a float64 ($2^{48} < 2^{53}$).
   */
  nextBits(count: number): Promise<number>
}

class MsbBitReader implements BitReader {
  readonly reader: ByteReader
  #buffer = 0
  #remaining = 0
  #bitsUsed = 0

  constructor(reader: ByteReader) {
    this.reader = reader
  }

  get bitsUsed(): number {
    return this.#bitsUsed
  }

  async nextBit(): Promise<0 | 1> {
    if (this.#remaining === 0) {
      this.#buffer = await this.reader.next()
      this.#remaining = 8
    }
    this.#remaining--
    this.#bitsUsed++
    return ((this.#buffer >>> this.#remaining) & 1) as 0 | 1
  }

  async nextBits(count: number): Promise<number> {
    if (!Number.isInteger(count) || count < 0 || count > 48) {
      throw new OracleError(
        'invalid_input',
        `nextBits count must be an integer in [0, 48], got ${count}`,
      )
    }
    let value = 0
    for (let i = 0; i < count; i++) value = value * 2 + (await this.nextBit())
    return value
  }
}

/**
 * Create a {@link BitReader} over `reader`. Each cast creates its own bit
 * reader, so buffered bits never leak between casts — the price is that up
 * to 7 buffered bits per cast are discarded (visible as the gap between
 * `bitsUsed` and $8\cdot$`bytesConsumed` in the accounting).
 */
export function bitReader(reader: ByteReader): BitReader {
  return new MsbBitReader(reader)
}
