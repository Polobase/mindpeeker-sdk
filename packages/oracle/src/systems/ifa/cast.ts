import { bitReader } from '../../core/bits.js'
import {
  accountingFrom,
  type CastReaderOptions,
  checkCastOptions,
  withCastReader,
} from '../../core/cast-reader.js'
import type { ByteReader } from '../../core/reader.js'
import { OracleError } from '../../errors.js'
import type { EntropyAccounting, OracleInput } from '../../types.js'
import { type OduFigure, oduFromBinary } from './data.js'

/**
 * The physical procedure being modeled. Both yield eight binary marks; they
 * differ in the order the marks are produced (Bascom 1969):
 *
 * - `'opele'` — the divining chain of eight half seed shells, held in the
 *   middle and tossed once: four shells on the right, four on the left, each
 *   read from the middle of the chain (top) to its open end (bottom).
 *   Concave side up = single mark.
 * - `'ikin'` — sixteen palm nuts grasped eight times; two nuts left in the
 *   hand = a single mark, one nut = a double mark (grasps leaving none or
 *   more than two are repeated). Marks are made row by row, **right then
 *   left** (Figure 2: 1 top right, 2 top left, 3 second row right, …).
 */
export type OduMethod = 'opele' | 'ikin'

export interface OduCast extends EntropyAccounting {
  readonly method: OduMethod
  /** Right half (male, read first; Bascom: "more powerful"). */
  readonly right: OduFigure
  /** Left half (female). */
  readonly left: OduFigure
  /**
   * Compound name, right half first: `'Okanran Irete'`, or `'<Name> Meji'`
   * when both halves agree (Bascom also gives *Eji Ogbe* etc. and notes
   * alternative names for some combinations; those are not modeled).
   */
  readonly name: string
  /** `true` for the 16 paired figures (*meji*), `false` for the 240 combinations. */
  readonly meji: boolean
  /**
   * The eight marks in production order (`1` = single, `0` = double): for
   * `'opele'` right shells top → bottom then left shells; for `'ikin'`
   * row 1 right, row 1 left, row 2 right, … — i.e. the eight input bits.
   */
  readonly marks: readonly (0 | 1)[]
}

/**
 * `signal` aborts the cast with an OracleError `'aborted'` (also on a shared
 * reader); `chunkBytes` (default 32) is requested from a `ByteSource` the
 * cast opens. See {@link CastReaderOptions}.
 */
export interface CastOduOptions extends CastReaderOptions {
  /** Procedure whose mark order is modeled. Default `'opele'`. */
  method?: OduMethod
}

/**
 * Cast one of the 256 Ifá figures (16 × 16: 16 paired *meji* + 240
 * combinations) from exactly **8 MSB-first bits** (one byte), each bit one
 * mark (`1` = single). Every figure has probability exactly $1/256$ — the
 * value Bascom states for "a good divining chain" (1969, p. 30).
 *
 * Mark order per `method` (see {@link OduMethod}): with bits
 * $b_0 \dots b_7$, `'opele'` reads the right half as $b_0 b_1 b_2 b_3$ and
 * the left as $b_4 b_5 b_6 b_7$; `'ikin'` reads the right half as
 * $b_0 b_2 b_4 b_6$ and the left as $b_1 b_3 b_5 b_7$. Both maps are
 * bijections of the byte onto the 256 figures, so the distribution is the
 * same; the same byte gives different figures under the two methods.
 *
 * Modeled, not measured: a fair chain shell is an idealization, and for
 * palm nuts the chance that two rather than one remain is not a physical
 * 1/2 — the fair-mark model is the stated null.
 *
 * Accounting: `bytesConsumed: 1`, `bitsUsed: 8`, always.
 *
 * @throws OracleError `'invalid_input'` for an unknown `method` (inherited
 *   keys such as `'constructor'` included), a non-object `opts`, or a reader
 *   already used by another cast; plus every {@link ByteReader} read error
 */
export async function castOdu(
  input: OracleInput | ByteReader,
  opts: CastOduOptions = {},
): Promise<OduCast> {
  checkCastOptions(opts, 'castOdu')
  const method: unknown = opts.method === undefined ? 'opele' : opts.method
  if (method !== 'opele' && method !== 'ikin') {
    throw new OracleError('invalid_input', `unknown Ifá method '${String(opts.method)}'`)
  }
  return withCastReader(input, opts, async (reader) => {
    const accounting = accountingFrom(reader)
    const bits = bitReader(reader)
    const marks: (0 | 1)[] = []
    for (let i = 0; i < 8; i++) marks.push(await bits.nextBit())
    const [rightBits, leftBits] =
      method === 'opele'
        ? [marks.slice(0, 4), marks.slice(4)]
        : [marks.filter((_, i) => i % 2 === 0), marks.filter((_, i) => i % 2 === 1)]
    const right = oduFromBinary(rightBits.join('')) as OduFigure
    const left = oduFromBinary(leftBits.join('')) as OduFigure
    const meji = right === left
    return Object.freeze({
      method,
      right,
      left,
      name: meji ? `${right.name} Meji` : `${right.name} ${left.name}`,
      meji,
      marks: Object.freeze(marks),
      ...accounting(),
      bitsUsed: bits.bitsUsed,
    })
  })
}
