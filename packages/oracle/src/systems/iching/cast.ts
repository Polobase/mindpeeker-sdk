import { bitReader } from '../../core/bits.js'
import { type ByteReader, byteReader } from '../../core/reader.js'
import { weightedIndex } from '../../core/weighted.js'
import { OracleError } from '../../errors.js'
import type { EntropyAccounting, OracleInput } from '../../types.js'
import { type Hexagram, hexagramFromBinary } from './data.js'

/** How the six lines are generated — two traditional probability models. */
export type CastMethod = 'coins' | 'yarrow'

/**
 * Exact line-value distributions, as integer weights over a power-of-two
 * denominator (index $i$ ↦ line value $6 + i$):
 *
 * - `coins` — three-coin method, $2^3$ outcomes:
 *   $$P(6,7,8,9) = \tfrac{1}{8}, \tfrac{3}{8}, \tfrac{3}{8}, \tfrac{1}{8}$$
 * - `yarrow` — traditional yarrow-stalk method, $2^4$ outcomes:
 *   $$P(6,7,8,9) = \tfrac{1}{16}, \tfrac{5}{16}, \tfrac{7}{16}, \tfrac{3}{16}$$
 *
 * Probabilities per the standard analyses of both procedures (Hacker,
 * *The I Ching Handbook*, 1993; Wilhelm & Baynes, 1950). Both are dyadic,
 * so {@link weightedIndex} realizes them exactly: 3 bits per coin line,
 * 4 bits per yarrow line, no rejection.
 */
export const LINE_WEIGHTS: Readonly<Record<CastMethod, readonly number[]>> = Object.freeze({
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

export interface CastHexagramOptions {
  /** Probability model for each line. Default `'coins'`. */
  method?: CastMethod
  /** Aborts the cast with an OracleError `'aborted'`. */
  signal?: AbortSignal
}

/**
 * Cast a full hexagram: six lines bottom-up, each drawn with the exact
 * distribution of the chosen method, then resolved against the King Wen
 * table. When any line is old (6 or 9) the changed lines yield the
 * `relating` hexagram, $\text{relating}_i = \text{primary}_i \oplus
 * \text{changing}_i$.
 *
 * Consumption is exact and deterministic: 18 bits (3 bytes) for `coins`,
 * 24 bits (3 bytes) for `yarrow`.
 */
export async function castHexagram(
  input: OracleInput | ByteReader,
  opts: CastHexagramOptions = {},
): Promise<HexagramCast> {
  const method = opts.method ?? 'coins'
  const weights = LINE_WEIGHTS[method]
  if (weights === undefined) {
    throw new OracleError('invalid_input', `unknown cast method '${String(opts.method)}'`)
  }
  const reader = byteReader(input, { signal: opts.signal })
  const startBytes = reader.bytesConsumed
  const bits = bitReader(reader)

  const lines: CastLine[] = []
  for (let position = 1; position <= 6; position++) {
    const value = (6 + (await weightedIndex(bits, weights))) as LineValue
    lines.push(
      Object.freeze({
        position,
        value,
        yang: value % 2 === 1,
        changing: value === 6 || value === 9,
      }),
    )
  }

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
    bytesConsumed: reader.bytesConsumed - startBytes,
    bitsUsed: bits.bitsUsed,
  })
}
