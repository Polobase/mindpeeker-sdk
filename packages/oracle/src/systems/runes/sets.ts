import { accountingFrom, withCastReader } from '../../core/cast-reader.js'
import type { ByteReader } from '../../core/reader.js'
import { OracleError } from '../../errors.js'
import type { EntropyAccounting, OracleInput } from '../../types.js'
import { type CastRunesOptions, type DrawnRune, drawRunes, resolveRuneOptions } from './cast.js'
import type { Futhark } from './rows.js'

/** Result of {@link castRuneSets}. */
export interface RuneSetsCast extends EntropyAccounting {
  readonly futhark: Futhark
  readonly blank: boolean
  /** One draw per requested set size, in order. A rune may recur across sets, never within one. */
  readonly sets: readonly (readonly DrawnRune[])[]
}

/** Upper bound on the number of sets in one cast. */
const MAX_SETS = 64

/**
 * Draw several sets of runes **with replacement between sets**: the pouch
 * is refilled after each set, so every set is an independent draw without
 * replacement. The default `[3, 3, 1]` is the three-sets reading reported by
 * Arcarti (*A Beginner's Guide to Runes*, 1993): three runes for the
 * circumstances, returned to the pouch; three for courses of action or
 * outcomes, returned; one for the influence on the problem as a whole.
 *
 * Exactly equivalent to consecutive {@link castRunes} calls with the same
 * options on one reader: set $j$ consumes a permutation prefix of $s_j$ from
 * $n$ (then its merkstave bits), so the sets are independent and
 * $$P(\text{sets}) = \prod_j \frac{(n - s_j)!}{n!} \cdot 2^{-(\text{merkstave bits})},$$
 * e.g. $1/(24 \cdot 23 \cdot 22)^2 / 24$ per ordered 3+3+1 Elder reading
 * without merkstave.
 *
 * @throws OracleError `'invalid_input'` unless `sizes` is a non-empty array
 *   of at most 64 integers in $[1, n]$; plus every option error of
 *   {@link castRunes} and every {@link ByteReader} read error
 */
export async function castRuneSets(
  input: OracleInput | ByteReader,
  sizes: readonly number[] = [3, 3, 1],
  opts: CastRunesOptions = {},
): Promise<RuneSetsCast> {
  const draw = resolveRuneOptions(opts, 'castRuneSets')
  if (!Array.isArray(sizes) || sizes.length === 0 || sizes.length > MAX_SETS) {
    throw new OracleError(
      'invalid_input',
      `castRuneSets sizes must be an array of 1 to ${MAX_SETS} set sizes`,
    )
  }
  for (const size of sizes) {
    if (!Number.isInteger(size) || size < 1 || size > draw.set.length) {
      throw new OracleError(
        'invalid_input',
        `castRuneSets set sizes must be integers in [1, ${draw.set.length}], got ${String(size)}`,
      )
    }
  }
  const frozenSizes = [...sizes]
  return withCastReader(input, opts, async (reader) => {
    const accounting = accountingFrom(reader)
    const sets: (readonly DrawnRune[])[] = []
    let bitsUsed = 0
    for (const size of frozenSizes) {
      const drawn = await drawRunes(reader, draw.set, size, draw.merkstave)
      sets.push(drawn.runes)
      bitsUsed += drawn.bitsUsed
    }
    return Object.freeze({
      futhark: draw.futhark,
      blank: draw.blank,
      sets: Object.freeze(sets),
      ...accounting(),
      bitsUsed,
    })
  })
}
