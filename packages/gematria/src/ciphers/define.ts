/**
 * The one cipher builder every table goes through, so all ciphers share the
 * same alphabet/fold/table contract (see {@link Cipher}): a canonical alphabet,
 * a fold from accepted glyphs to canonical letters, a forward letter function
 * that folds before lookup, and a frozen table of every value-bearing glyph.
 */

import type { Cipher, CipherId, LetterValue, Script } from '../types.js'

/** Everything needed to define one cipher. */
export interface CipherSpec {
  readonly id: CipherId
  readonly label: string
  readonly description: string
  readonly script: Script
  readonly modern: boolean
  readonly extended?: boolean
  /** Canonical letters in traditional order (the domain of reverse). */
  readonly alphabet: readonly string[]
  /** Forward value of a canonical letter, called only for alphabet letters. */
  readonly value: (letter: string) => number
  /** Glyph → canonical letter, applied after lowercasing. */
  readonly variants?: Readonly<Record<string, string>>
  /**
   * Glyphs whose own forward value differs from their canonical letter's (the
   * Gadol finals). Consulted before folding; `undefined` falls through.
   */
  readonly glyphValue?: (glyph: string) => number | undefined
  /** Glyph rows listed in `table`, in order. Default: the alphabet. */
  readonly tableGlyphs?: readonly string[]
  readonly postSum?: (sum: number) => number
}

/** Lowercase one character, keeping it when lowercasing would change its length (İ). */
function lower(ch: string): string {
  const lc = ch.toLowerCase()
  return lc.length === ch.length ? lc : ch
}

/**
 * Build a deeply frozen {@link Cipher} from a {@link CipherSpec}. Glyphs of the
 * table with value 0 are omitted, so every table row carries a positive value.
 */
export function defineCipher(spec: CipherSpec): Cipher {
  const alphabet = Object.freeze([...spec.alphabet])
  const letters: ReadonlySet<string> = new Set(alphabet)
  const variants = spec.variants ?? {}
  const values = new Map<string, number>(alphabet.map((letter) => [letter, spec.value(letter)]))

  const fold = (ch: string): string => {
    const lc = lower(ch)
    return Object.hasOwn(variants, lc) ? (variants[lc] as string) : lc
  }
  const glyphValue = spec.glyphValue
  const letterValue = (ch: string): number => {
    if (glyphValue) {
      const own = glyphValue(lower(ch))
      if (own !== undefined) return own
    }
    const letter = fold(ch)
    return letters.has(letter) ? (values.get(letter) as number) : 0
  }

  const table: readonly LetterValue[] = Object.freeze(
    (spec.tableGlyphs ?? alphabet)
      .map((char) => ({ char, value: letterValue(char) }))
      .filter((row) => row.value > 0)
      .map((row) => Object.freeze(row)),
  )

  return Object.freeze({
    id: spec.id,
    label: spec.label,
    description: spec.description,
    script: spec.script,
    modern: spec.modern,
    extended: spec.extended ?? false,
    alphabet,
    fold,
    letterValue,
    table,
    ...(spec.postSum ? { postSum: spec.postSum } : {}),
  })
}

/**
 * Split a whitespace-separated list of glyphs into an array. Astral-plane glyphs
 * (Gothic) survive intact because splitting is on spaces, not code units.
 */
export function glyphs(list: string): readonly string[] {
  return Object.freeze(list.trim().split(/\s+/))
}

/**
 * The standard alphabetic-numeral ladder shared by the Greek, Semitic and
 * derived numeral alphabets: 1…9, 10…90, 100…900, 1000…9000, 10000… — the
 * value of 0-based position `i` is $(i \bmod 9 + 1) \cdot 10^{\lfloor i / 9 \rfloor}$.
 */
export function numeralLadder(index: number): number {
  return ((index % 9) + 1) * 10 ** Math.floor(index / 9)
}
