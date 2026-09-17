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
import type { SpreadPosition } from '../tarot/data.js'
import type { Rune } from './data.js'
import {
  FUTHARKS,
  type Futhark,
  RUNE_LAYOUTS,
  type RuneLayout,
  type RuneLayoutName,
  runeSet,
} from './rows.js'

/** One drawn rune with its orientation. */
export interface DrawnRune {
  readonly rune: Rune
  /**
   * Upside-down ("dark-stave") orientation. Always `false` for
   * non-invertible runes (the nine point-symmetric Elder runes, every rune
   * of the other rows, the blank) and whenever merkstave was not requested.
   */
  readonly merkstave: boolean
  /** The layout position this rune fills, when the cast used a layout. */
  readonly position?: SpreadPosition
}

export interface RuneCast extends EntropyAccounting {
  /** The row drawn from. */
  readonly futhark: Futhark
  /** Whether the blank rune was in the pouch. */
  readonly blank: boolean
  /** The layout, when one was requested (`castRunes(input, 'norns')`). */
  readonly layout?: RuneLayout
  /** The drawn runes in draw order. Never repeats a rune. */
  readonly runes: readonly DrawnRune[]
}

/**
 * Options shared by `castRunes` and `castRuneSets`. `signal` aborts the cast
 * with an OracleError `'aborted'` (also on a shared reader); `chunkBytes`
 * (default 32) is requested from a `ByteSource` the cast opens. See
 * {@link CastReaderOptions}.
 */
export interface CastRunesOptions extends CastReaderOptions {
  /** Rune row. Default `'elder'` (the 0.1 behaviour). */
  futhark?: Futhark
  /**
   * Add the modern blank rune (Blum 1982) to the pouch: $n + 1$ runes.
   * Default `false`. Must be a boolean when present.
   */
  blank?: boolean
  /**
   * Give each *invertible* drawn rune a merkstave bit (probability exactly
   * $1/2$). Non-invertible runes (and the blank) never consume a bit.
   * Elder Futhark only. Default `false`. Must be a boolean when present.
   */
  merkstave?: boolean
}

/** Validated option values. @internal */
export interface RuneDraw {
  readonly futhark: Futhark
  readonly blank: boolean
  readonly merkstave: boolean
  readonly set: readonly Rune[]
}

/**
 * Validate the rune options shared by the rune casts.
 *
 * @internal
 * @throws OracleError `'invalid_input'` for a non-object `opts`, an unknown
 *   `futhark`, non-boolean flags, or `merkstave: true` outside the Elder Futhark
 */
export function resolveRuneOptions(opts: CastRunesOptions, cast: string): RuneDraw {
  checkCastOptions(opts, cast)
  const futhark: unknown = opts.futhark === undefined ? 'elder' : opts.futhark
  if (typeof futhark !== 'string' || !Object.hasOwn(FUTHARKS, futhark)) {
    throw new OracleError('invalid_input', `unknown futhark '${String(opts.futhark)}'`)
  }
  checkBooleanOption(opts.blank, 'blank')
  checkBooleanOption(opts.merkstave, 'merkstave')
  const merkstave = opts.merkstave === true
  if (merkstave && futhark !== 'elder') {
    throw new OracleError(
      'invalid_input',
      `merkstave is modeled for the Elder Futhark only, not '${futhark}'`,
    )
  }
  const blank = opts.blank === true
  return { futhark: futhark as Futhark, blank, merkstave, set: runeSet(futhark as Futhark, blank) }
}

/**
 * One draw without replacement from `set`: permutation prefix, then one
 * merkstave bit per invertible rune (fresh bit reader). Returns the runes
 * and the bits that entered decisions.
 *
 * @internal
 */
export async function drawRunes(
  reader: ByteReader,
  set: readonly Rune[],
  count: number,
  merkstave: boolean,
  positions?: readonly SpreadPosition[],
): Promise<{ runes: readonly DrawnRune[]; bitsUsed: number }> {
  const startBytes = reader.bytesConsumed
  const indices = await drawWithoutReplacement(reader, set.length, count)
  const drawn = indices.map((i) => set[i] as Rune)
  let bitsUsed = 8 * (reader.bytesConsumed - startBytes)

  const flags: boolean[] = drawn.map(() => false)
  if (merkstave) {
    const bits = bitReader(reader)
    for (let i = 0; i < drawn.length; i++) {
      if ((drawn[i] as Rune).invertible) flags[i] = (await bits.nextBit()) === 1
    }
    bitsUsed += bits.bitsUsed
  }
  const runes = drawn.map((rune, i) =>
    Object.freeze({
      rune,
      merkstave: flags[i] as boolean,
      ...(positions !== undefined ? { position: positions[i] as SpreadPosition } : {}),
    }),
  )
  return { runes: Object.freeze(runes), bitsUsed }
}

/**
 * Draw runes without replacement (Fisher–Yates prefix — uniform over all
 * $n!/(n-c)!$ ordered draws) from a rune row: the 24-rune Elder Futhark
 * (default), the 16-rune Younger Futhark, or a 28/29/33-rune Anglo-Saxon
 * futhorc (see `rows.ts` for sources), optionally with the modern blank rune
 * added ($n + 1$).
 *
 * `countOrLayout` is a count $c$, or a layout name: `'norns'` draws three
 * runes into the positions Urðr, Verðandi, Skuld (each `DrawnRune` carries
 * its `position`).
 *
 * Consumption order (fixed): first the permutation prefix via
 * {@link drawWithoutReplacement}, then — if `merkstave` (Elder Futhark only)
 * — one MSB-first bit per **invertible** drawn rune, in draw order. Because
 * point-symmetric glyphs have no distinct upside-down state, spending a bit
 * on them would be wasted entropy; skipping them keeps `bitsUsed` honest.
 *
 * Lifecycle: a reader the cast opens (e.g. a `ByteSource` stream) is closed
 * before the promise settles; a `ByteReader` you pass in stays open.
 *
 * @throws OracleError `'invalid_input'` unless `countOrLayout` is an integer
 *   in $[1, n]$ ($n$ = row size, +1 with `blank`) or a known layout name;
 *   also for an unknown `futhark`, non-boolean `blank`/`merkstave`,
 *   `merkstave: true` outside the Elder Futhark, a non-object `opts`, or a
 *   reader already used by another cast; plus every {@link ByteReader} read error
 */
export async function castRunes(
  input: OracleInput | ByteReader,
  countOrLayout: number | RuneLayoutName,
  opts: CastRunesOptions = {},
): Promise<RuneCast> {
  const draw = resolveRuneOptions(opts, 'castRunes')
  let layout: RuneLayout | undefined
  let count: number
  if (typeof countOrLayout === 'string') {
    if (!Object.hasOwn(RUNE_LAYOUTS, countOrLayout)) {
      throw new OracleError('invalid_input', `unknown rune layout '${countOrLayout}'`)
    }
    layout = RUNE_LAYOUTS[countOrLayout]
    count = layout.positions.length
  } else {
    count = countOrLayout
    if (!Number.isInteger(count) || count < 1 || count > draw.set.length) {
      throw new OracleError(
        'invalid_input',
        `castRunes count must be an integer in [1, ${draw.set.length}], got ${count}`,
      )
    }
  }
  return withCastReader(input, opts, async (reader) => {
    const accounting = accountingFrom(reader)
    const { runes, bitsUsed } = await drawRunes(
      reader,
      draw.set,
      count,
      draw.merkstave,
      layout?.positions,
    )
    return Object.freeze({
      futhark: draw.futhark,
      blank: draw.blank,
      ...(layout !== undefined ? { layout } : {}),
      runes,
      ...accounting(),
      bitsUsed,
    })
  })
}
