/**
 * Shared primitives for the Latin/English cipher family (`english.ts`,
 * `english-modern.ts`, `latin-extra.ts`), split out so the files can build on
 * the same alphabet, `ordinal` and cipher builder without importing each other.
 */

import type { Cipher, CipherId } from '../types.js'
import { defineCipher } from './define.js'

/** a … z, the canonical alphabet of the 26-letter Latin ciphers. */
export const LATIN_ALPHABET: readonly string[] = Object.freeze(
  'abcdefghijklmnopqrstuvwxyz'.split(''),
)

/** Ordinal A=1 … Z=26 (lowercased input), or 0 for a non-letter. */
export function ordinal(ch: string): number {
  const code = ch.codePointAt(0) ?? 0
  return ch.length === 1 && code >= 97 && code <= 122 ? code - 96 : 0
}

/** Freeze `[glyph, value]` rows into a lookup function (0 for anything else). */
export function rowsValue(rows: readonly (readonly [string, number])[]): (ch: string) => number {
  const map: ReadonlyMap<string, number> = new Map(rows)
  return (ch) => map.get(ch) ?? 0
}

/**
 * Build one frozen 26-letter Latin {@link Cipher} over {@link LATIN_ALPHABET}
 * (a↔z under reverse).
 */
export function latinCipher(
  id: CipherId,
  label: string,
  description: string,
  letterValue: (ch: string) => number,
  modern: boolean,
  extended = false,
): Cipher {
  return defineCipher({
    id,
    label,
    description,
    script: 'latin',
    modern,
    extended,
    alphabet: LATIN_ALPHABET,
    value: letterValue,
  })
}
