import { bitReader } from '../../core/bits.js'
import {
  accountingFrom,
  type CastReaderOptions,
  checkCastOptions,
  withCastReader,
} from '../../core/cast-reader.js'
import type { ByteReader } from '../../core/reader.js'
import { uniformInt } from '../../core/uniform.js'
import { weightedIndex } from '../../core/weighted.js'
import { OracleError } from '../../errors.js'
import type { EntropyAccounting, OracleInput } from '../../types.js'
import { type Hexagram, hexagramFromBinary } from './data.js'

/** The two line-by-line probability models, each with a {@link LINE_WEIGHTS} entry. */
export type LineMethod = 'coins' | 'yarrow'

/**
 * How the six lines are generated: the line-by-line models `'coins'` and
 * `'yarrow'`, or `'singleLine'` — six independent yang/yin lines plus
 * exactly one moving line (Crowley, *Liber CCXVI*).
 */
export type CastMethod = LineMethod | 'singleLine'

/**
 * Exact line-value distributions, as integer weights over a power-of-two
 * denominator (index $i$ ↦ line value $6 + i$):
 *
 * - `coins` — three-coin method, $2^3$ outcomes:
 *   $$P(6,7,8,9) = \tfrac{1}{8}, \tfrac{3}{8}, \tfrac{3}{8}, \tfrac{1}{8}$$
 * - `yarrow` — traditional yarrow-stalk method, $2^4$ outcomes:
 *   $$P(6,7,8,9) = \tfrac{1}{16}, \tfrac{5}{16}, \tfrac{7}{16}, \tfrac{3}{16}$$
 *
 * The counts 1/3/3/1 of 8 and 4/20/28/12 of 64 are stated by Hellmut
 * Wilhelm ("The Concept of Time in the Book of Changes", *Man and Time*,
 * 1957); the 49-stalk, count-by-fours procedure is Legge's Great Appendix
 * I.9 (1899). Both are dyadic, so {@link weightedIndex} realizes them
 * exactly: 3 bits per coin line, 4 bits per yarrow line, no rejection.
 *
 * Physical methods built to reproduce the yarrow odds from 16 equiprobable
 * outcomes — the 16-token method, two coins thrown twice, four coins —
 * realize this same $1/16, 5/16, 7/16, 3/16$ table, so they are
 * probability-identical to `'yarrow'`. `'singleLine'` has no per-line
 * table (see {@link castHexagram}).
 */
export const LINE_WEIGHTS: Readonly<Record<LineMethod, readonly number[]>> = Object.freeze({
  coins: Object.freeze([1, 3, 3, 1]),
  yarrow: Object.freeze([1, 5, 7, 3]),
})

/** Traditional line values: 6 old yin, 7 young yang, 8 young yin, 9 old yang. */
export type LineValue = 6 | 7 | 8 | 9

/** One cast line (same shape as the mindpeeker frontend's `CastLine`). */
export interface CastLine {
  /** 1 (bottom) … 6 (top). */
  readonly position: number
  readonly value: LineValue
  /** Yang iff the value is odd (7 or 9). */
  readonly yang: boolean
  /** Moving/changing iff old yin (6) or old yang (9). */
  readonly changing: boolean
}

export interface HexagramCast extends EntropyAccounting {
  readonly method: CastMethod
  /** Six lines, bottom → top. */
  readonly lines: readonly CastLine[]
  readonly primary: Hexagram
  /**
   * The relating hexagram — the primary with every changing line inverted.
   * Absent when no line moves.
   */
  readonly relating?: Hexagram
  /** Positions (1–6) of the changing lines. */
  readonly changing: readonly number[]
}

/**
 * `signal` aborts the cast with an OracleError `'aborted'` (also on a shared
 * reader); `chunkBytes` (default 32) is requested from a `ByteSource` the
 * cast opens. See {@link CastReaderOptions}.
 */
export interface CastHexagramOptions extends CastReaderOptions {
  /** Probability model. Default `'coins'`. */
  method?: CastMethod
}

/**
 * Cast a full hexagram, resolved against the King Wen table. When any line
 * is old (6 or 9) the changed lines yield the `relating` hexagram,
 * $\text{relating}_i = \text{primary}_i \oplus \text{changing}_i$.
 *
 * - `'coins'` / `'yarrow'` — six lines bottom-up, each drawn with the exact
 *   distribution of {@link LINE_WEIGHTS}. Consumption is exact and
 *   deterministic: 18 bits (3 bytes) for `coins`, 24 bits (3 bytes) for
 *   `yarrow`.
 * - `'singleLine'` — Crowley's six coins or sticks, one of them "especial"
 *   (*Liber CCXVI*, "The Apparatus" and "The Method"): six independent fair
 *   yang/yin bits (lines 1–6, MSB-first), then the moving line
 *   $1 + $ {@link uniformInt}`(6)`. Each of the $2^6 \cdot 6 = 384$
 *   (primary, moving line) outcomes has probability exactly $1/384$ and
 *   exactly one line moves (value 9 if yang, 6 if yin; the others are 7/8),
 *   whereas the traditional methods move anywhere from zero to six lines.
 *   Consumption: 6 bits from one byte (2 buffered bits discarded), then one
 *   rejection-sampled byte per attempt (accepted with probability
 *   $252/256$) — `bytesConsumed` $\ge 2$, `bitsUsed` $= 6 + 8 \cdot$ attempts.
 *
 * Lifecycle: a reader the cast opens (e.g. a `ByteSource` stream) is closed
 * before the promise settles; a `ByteReader` you pass in stays open.
 *
 * @throws OracleError `'invalid_input'` for an unknown `method` (inherited
 *   keys such as `'constructor'` included), a non-object `opts`, or a reader
 *   already used by another cast; plus every {@link ByteReader} read error
 */
export async function castHexagram(
  input: OracleInput | ByteReader,
  opts: CastHexagramOptions = {},
): Promise<HexagramCast> {
  checkCastOptions(opts, 'castHexagram')
  const method: unknown = opts.method === undefined ? 'coins' : opts.method
  if (
    typeof method !== 'string' ||
    (method !== 'singleLine' && !Object.hasOwn(LINE_WEIGHTS, method))
  ) {
    throw new OracleError('invalid_input', `unknown cast method '${String(opts.method)}'`)
  }
  return withCastReader(input, opts, (reader) => hexagramFrom(reader, method as CastMethod))
}

const line = (position: number, value: LineValue): CastLine =>
  Object.freeze({ position, value, yang: value % 2 === 1, changing: value === 6 || value === 9 })

/** Draw the six line values; returns them with the bits the draw used. */
async function drawLines(
  reader: ByteReader,
  method: CastMethod,
): Promise<{ lines: CastLine[]; bitsUsed: number }> {
  const bits = bitReader(reader)
  const lines: CastLine[] = []
  if (method === 'singleLine') {
    const yang: boolean[] = []
    for (let i = 0; i < 6; i++) yang.push((await bits.nextBit()) === 1)
    const before = reader.bytesConsumed
    const moving = 1 + (await uniformInt(reader, 6))
    yang.forEach((isYang, i) => {
      const value = i + 1 === moving ? (isYang ? 9 : 6) : isYang ? 7 : 8
      lines.push(line(i + 1, value))
    })
    return { lines, bitsUsed: bits.bitsUsed + 8 * (reader.bytesConsumed - before) }
  }
  const weights = LINE_WEIGHTS[method]
  for (let position = 1; position <= 6; position++) {
    lines.push(line(position, (6 + (await weightedIndex(bits, weights))) as LineValue))
  }
  return { lines, bitsUsed: bits.bitsUsed }
}

async function hexagramFrom(reader: ByteReader, method: CastMethod): Promise<HexagramCast> {
  const accounting = accountingFrom(reader)
  const { lines, bitsUsed } = await drawLines(reader, method)

  const primaryBinary = lines.map((l) => (l.yang ? '1' : '0')).join('')
  const primary = hexagramFromBinary(primaryBinary) as Hexagram
  const changing = lines.filter((l) => l.changing).map((l) => l.position)
  let relating: Hexagram | undefined
  if (changing.length > 0) {
    const relatingBinary = lines.map((l) => ((l.changing ? !l.yang : l.yang) ? '1' : '0')).join('')
    relating = hexagramFromBinary(relatingBinary) as Hexagram
  }

  return Object.freeze({
    method,
    lines: Object.freeze(lines),
    primary,
    ...(relating !== undefined ? { relating } : {}),
    changing: Object.freeze(changing),
    ...accounting(),
    bitsUsed,
  })
}
