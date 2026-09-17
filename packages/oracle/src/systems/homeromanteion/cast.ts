import {
  accountingFrom,
  type CastReaderOptions,
  checkCastOptions,
  withCastReader,
} from '../../core/cast-reader.js'
import type { ByteReader } from '../../core/reader.js'
import { uniformInt } from '../../core/uniform.js'
import type { EntropyAccounting, OracleInput } from '../../types.js'

export interface HomeromanteionCast extends EntropyAccounting {
  /** The three dice in throw order, each 1–6. */
  readonly dice: readonly [number, number, number]
  /**
   * Entry number 1–216 of the oracle, $36(a-1) + 6(b-1) + c$ for dice
   * $a, b, c$ — the order of the papyrus list, 1-1-1 (#1) … 6-6-6 (#216).
   */
  readonly index: number
}

/**
 * `signal` aborts the cast with an OracleError `'aborted'` (also on a shared
 * reader); `chunkBytes` (default 32) is requested from a `ByteSource` the
 * cast opens. See {@link CastReaderOptions}.
 */
export interface CastHomeromanteionOptions extends CastReaderOptions {}

/**
 * The Homer oracle (*Homeromanteion*, PGM VII.1–148): a list of 216 Homeric
 * verses keyed by three throws of a six-sided die ("one die thrown three
 * times would achieve the same purpose" — Betz, ed., *The Greek Magical
 * Papyri in Translation*, 1986, note to PGM VII.1–148). Returns the dice and
 * the entry number only — no verse text or references are shipped.
 *
 * Three independent {@link uniformInt}`(6)` draws (one byte per attempt,
 * accepted with probability $252/256$), so each of the 216 entries has
 * probability exactly $1/216$ (the list is ordered lexicographically:
 * entries 213–216 are 6-6-3 … 6-6-6). `bitsUsed` $= 8 \cdot$ `bytesConsumed`.
 *
 * @throws OracleError `'invalid_input'` for a non-object `opts` or a reader
 *   already used by another cast; plus every {@link ByteReader} read error
 */
export async function castHomeromanteion(
  input: OracleInput | ByteReader,
  opts: CastHomeromanteionOptions = {},
): Promise<HomeromanteionCast> {
  checkCastOptions(opts, 'castHomeromanteion')
  return withCastReader(input, opts, async (reader) => {
    const accounting = accountingFrom(reader)
    const a = 1 + (await uniformInt(reader, 6))
    const b = 1 + (await uniformInt(reader, 6))
    const c = 1 + (await uniformInt(reader, 6))
    const counts = accounting()
    return Object.freeze({
      dice: Object.freeze([a, b, c]) as readonly [number, number, number],
      index: 36 * (a - 1) + 6 * (b - 1) + c,
      ...counts,
      bitsUsed: 8 * counts.bytesConsumed,
    })
  })
}
