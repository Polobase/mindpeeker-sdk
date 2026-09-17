import { bitReader } from '../../core/bits.js'
import {
  accountingFrom,
  type CastReaderOptions,
  checkBooleanOption,
  checkCastOptions,
  withCastReader,
} from '../../core/cast-reader.js'
import { drawWithoutReplacement } from '../../core/draw.js'
import type { ByteReader } from '../../core/reader.js'
import { OracleError } from '../../errors.js'
import type { EntropyAccounting, OracleInput } from '../../types.js'
import { ELDER_FUTHARK, type Rune } from './data.js'

/** One drawn rune with its orientation. */
export interface DrawnRune {
  readonly rune: Rune
  /**
   * Upside-down ("dark-stave") orientation. Always `false` for the nine
   * non-invertible runes and whenever merkstave was not requested.
   */
  readonly merkstave: boolean
}

export interface RuneCast extends EntropyAccounting {
  /** The drawn runes in draw order. Never repeats a rune. */
  readonly runes: readonly DrawnRune[]
}

/**
 * `signal` aborts the cast with an OracleError `'aborted'` (also on a shared
 * reader); `chunkBytes` (default 32) is requested from a `ByteSource` the
 * cast opens. See {@link CastReaderOptions}.
 */
export interface CastRunesOptions extends CastReaderOptions {
  /**
   * Give each *invertible* drawn rune a merkstave bit (probability exactly
   * $1/2$). Non-invertible runes never consume a bit. Default `false`.
   * Must be a boolean when present.
   */
  merkstave?: boolean
}

/**
 * Draw `count` runes from the 24-rune Elder Futhark without replacement
 * (Fisher–Yates prefix — uniform over all $24!/(24-\texttt{count})!$
 * ordered draws).
 *
 * Consumption order (fixed): first the permutation prefix via
 * {@link drawWithoutReplacement}, then — if `merkstave` — one MSB-first bit
 * per **invertible** drawn rune, in draw order. Because point-symmetric
 * glyphs have no distinct upside-down state, spending a bit on them would
 * be wasted entropy; skipping them keeps `bitsUsed` honest.
 *
 * Lifecycle: a reader the cast opens (e.g. a `ByteSource` stream) is closed
 * before the promise settles; a `ByteReader` you pass in stays open.
 *
 * @throws OracleError `'invalid_input'` unless `count` is an integer in
 *   $[1, 24]$; also for a non-boolean `merkstave`, a non-object `opts`, or a
 *   reader already used by another cast; plus every {@link ByteReader} read error
 */
export async function castRunes(
  input: OracleInput | ByteReader,
  count: number,
  opts: CastRunesOptions = {},
): Promise<RuneCast> {
  if (!Number.isInteger(count) || count < 1 || count > ELDER_FUTHARK.length) {
    throw new OracleError(
      'invalid_input',
      `castRunes count must be an integer in [1, ${ELDER_FUTHARK.length}], got ${count}`,
    )
  }
  checkCastOptions(opts, 'castRunes')
  checkBooleanOption(opts.merkstave, 'merkstave')
  const merkstave = opts.merkstave === true
  return withCastReader(input, opts, (reader) => runesFrom(reader, count, merkstave))
}

async function runesFrom(reader: ByteReader, count: number, merkstave: boolean): Promise<RuneCast> {
  const accounting = accountingFrom(reader)
  const startBytes = reader.bytesConsumed
  const indices = await drawWithoutReplacement(reader, ELDER_FUTHARK.length, count)
  const drawn = indices.map((i) => ELDER_FUTHARK[i] as Rune)
  let bitsUsed = 8 * (reader.bytesConsumed - startBytes)

  const flags: boolean[] = drawn.map(() => false)
  if (merkstave) {
    const bits = bitReader(reader)
    for (let i = 0; i < drawn.length; i++) {
      if ((drawn[i] as Rune).invertible) flags[i] = (await bits.nextBit()) === 1
    }
    bitsUsed += bits.bitsUsed
  }

  return Object.freeze({
    runes: Object.freeze(
      drawn.map((rune, i) => Object.freeze({ rune, merkstave: flags[i] as boolean })),
    ),
    ...accounting(),
    bitsUsed,
  })
}
