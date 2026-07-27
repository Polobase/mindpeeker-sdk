/**
 * Shared primitives for the Latin/English cipher family, split out so
 * `english.ts` (the historical + ×6 set) and `english-modern.ts` (the
 * gematriaq-parity calculator set) can both build on `ordinal`/`reverse`
 * without importing each other.
 */

import type { Cipher, CipherId, LetterValue } from '../types.js'

/** a … z, the domain of every Latin cipher table. */
export const LATIN_ALPHABET: readonly string[] = 'abcdefghijklmnopqrstuvwxyz'.split('')

/** Ordinal A=1 … Z=26 (lowercased input), or 0 for a non-letter. */
export function ordinal(ch: string): number {
  const code = ch.codePointAt(0) ?? 0
  return code >= 97 && code <= 122 ? code - 96 : 0
}

/** Reverse ordinal Z=1 … A=26 (i.e. $27 - n$), or 0 for a non-letter. */
export function reverse(ch: string): number {
  const o = ordinal(ch)
  return o > 0 ? 27 - o : 0
}

/** Build the frozen alphabet→value table for a Latin cipher. */
export function table(fn: (ch: string) => number): readonly LetterValue[] {
  return Object.freeze(LATIN_ALPHABET.map((char) => Object.freeze({ char, value: fn(char) })))
}

/** Build one frozen Latin {@link Cipher} sharing this file's table builder. */
export function latinCipher(
  id: CipherId,
  label: string,
  description: string,
  letterValue: (ch: string) => number,
  modern: boolean,
  extended = false,
): Cipher {
  return Object.freeze({
    id,
    label,
    description,
    script: 'latin',
    modern,
    extended,
    letterValue,
    table: table(letterValue),
  })
}
