import { bitReader } from '../../core/bits.js'
import { drawWithoutReplacement } from '../../core/draw.js'
import { type ByteReader, byteReader } from '../../core/reader.js'
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

export interface CastRunesOptions {
  /**
   * Give each *invertible* drawn rune a merkstave bit (probability exactly
   * $1/2$). Non-invertible runes never consume a bit. Default `false`.
   */
  merkstave?: boolean
  /** Aborts the cast with an OracleError `'aborted'`. */
  signal?: AbortSignal
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
 * @throws OracleError `'invalid_input'` unless `count` is an integer in $[1, 24]$
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
  const reader = byteReader(input, { signal: opts.signal })
  const startBytes = reader.bytesConsumed
  const indices = await drawWithoutReplacement(reader, ELDER_FUTHARK.length, count)
  const drawn = indices.map((i) => ELDER_FUTHARK[i] as Rune)
  let bitsUsed = 8 * (reader.bytesConsumed - startBytes)

  const flags: boolean[] = drawn.map(() => false)
  if (opts.merkstave === true) {
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
    bytesConsumed: reader.bytesConsumed - startBytes,
    bitsUsed,
  })
}
