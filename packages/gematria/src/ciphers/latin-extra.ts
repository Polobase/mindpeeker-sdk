/**
 * SDK-added Latin-script tables with a documented provenance, all `extended:
 * true` so the default `profile()` stays a row-for-row frontend match. Each has
 * its own canonical alphabet, so reverse mirrors over *that* alphabet:
 *
 * - **Trigrammaton Qabalah** (`en-tq`) — R. Leo Gillis (1996), derived in base 3
 *   from Crowley's *Liber Trigrammaton* (Liber XXVII); calculators often
 *   mislabel it "LCH Kabbalah". The 27 trigrams take the values 0–26 in the
 *   order I L C H P A X J W T O G F E R S Q K Y Z B M V D N U &, i.e. A5 B20 C2
 *   D23 E13 F12 G11 H3 I0 J7 K17 L1 M21 N24 O10 P4 Q16 R14 S15 T9 U25 V22 W8 X6
 *   Y18 Z19 and & = 26. The canonical alphabet is a…z followed by `&` (27
 *   symbols), so reverse pairs a↔&, b↔z, …; I scores 0 by definition.
 * - **Alphanumeric Qabbala** (`en-aq`, `modern: true`) — the Ccru / Nick Land
 *   "AQ" (after Barrow): the base-36 digit values, digits 0–9 keep their value
 *   and A=10 … Z=35. It is the only cipher here that scores digits; the
 *   canonical alphabet is 0…9 a…z (36 symbols).
 * - **Elizabethan Simple** (`la-elizabethan-simple`) — the 24-letter
 *   Elizabethan alphabet with I/J and U/V merged: A1 … H8, I/J 9, K10 … T19,
 *   U/V 20, W21 X22 Y23 Z24 (Manly P. Hall, *The Secret Teachings of All Ages*;
 *   the Baconian authorship literature: BACON = 33, SHAKESPEARE = 103). Reverse
 *   mirrors over the 24 letters (Z=1 … A=24, Hall's "Reverse" cipher); J folds
 *   to I and V to U.
 * - **Kaye** (`la-elizabethan-kaye`) — the Baconian "Kay(e)" count over the same
 *   24 letters, starting at K = 10: K10 … T19, U/V 20, W21 X22 Y23 Z24, & = 25,
 *   then A27 … H34, I/J 35 (26 is the "et" sign, which is not scored: the
 *   sources do not fix which glyph — the Tironian ⁊ or an et ligature — it
 *   denotes). The canonical alphabet is the 24 letters followed by `&`.
 * - **Roman numerals** (`la-roman`) — I1 V5 X10 L50 C100 D500 M1000, every
 *   other letter 0 (U and J included — write the classical V and I). This is
 *   the polemical isopsephy of Andreas Helwig (1612) and Uriah Smith (1866):
 *   VICARIVS FILII DEI = 666, a title that was never an official papal title.
 *   The canonical alphabet is the seven numeral letters in value order, so
 *   reverse pairs I↔M, V↔D, X↔C and L with itself. Unicode Roman numeral signs
 *   spell out under normalization (Ⅷ → viii = 8).
 *
 * Sources: yuriceschin/GematriaCalculator and gematriaresearch.blogspot.com,
 * "History of Ciphers" parts 2 (Baconian) and 4b (Thelemic); Nick Land,
 * *Fanged Noumena* / Hyperstition archive (AQ); Wikipedia, "Vicarius Filii Dei".
 */

import type { Cipher } from '../types.js'
import { defineCipher, glyphs } from './define.js'
import { LATIN_ALPHABET, ordinal, rowsValue } from './latin-shared.js'

/** Trigrammaton order: the symbol at index v has TQ value v. */
const TQ_ORDER = 'ilchpaxjwtogfersqkyzbmvdnu&'
const tqValue = rowsValue([...TQ_ORDER].map((ch, v) => [ch, v] as const))

/** Base-36 digit value: 0–9 → 0–9, a–z → 10–35. */
function aqValue(ch: string): number {
  if (ch.length !== 1) return 0
  const code = ch.charCodeAt(0)
  if (code >= 48 && code <= 57) return code - 48
  const o = ordinal(ch)
  return o > 0 ? o + 9 : 0
}

/** The 24-letter Elizabethan alphabet (I/J and U/V merged). */
const ELIZABETHAN_ALPHABET = glyphs('a b c d e f g h i k l m n o p q r s t u w x y z')
const ELIZABETHAN_VARIANTS = Object.freeze({ j: 'i', v: 'u' })
const ELIZABETHAN_TABLE = Object.freeze([...LATIN_ALPHABET])

function elizabethanSimple(letter: string): number {
  return ELIZABETHAN_ALPHABET.indexOf(letter) + 1
}

function kaye(letter: string): number {
  if (letter === '&') return 25
  const position = ELIZABETHAN_ALPHABET.indexOf(letter) + 1 // 1..24
  if (position === 0) return 0
  return position >= 10 ? position : position + 26
}

const ROMAN = rowsValue([
  ['i', 1],
  ['v', 5],
  ['x', 10],
  ['l', 50],
  ['c', 100],
  ['d', 500],
  ['m', 1000],
])

/** The five SDK-added Latin tables, in registry order. */
export const LATIN_EXTRA_CIPHERS: readonly Cipher[] = Object.freeze([
  defineCipher({
    id: 'en-tq',
    label: 'Trigrammaton Qabalah (TQ)',
    description:
      'Trigrammaton Qabalah (R. Leo Gillis, 1996), from Liber Trigrammaton in base 3: I0 L1 C2 H3 ' +
      'P4 A5 X6 J7 W8 T9 O10 G11 F12 E13 R14 S15 Q16 K17 Y18 Z19 B20 M21 V22 D23 N24 U25 &26.',
    script: 'latin',
    modern: false,
    extended: true,
    alphabet: [...LATIN_ALPHABET, '&'],
    value: tqValue,
  }),
  defineCipher({
    id: 'en-aq',
    label: 'Alphanumeric Qabbala (AQ)',
    description:
      'Alphanumeric Qabbala (Ccru / Nick Land): base-36 digit values, digits 0–9 as themselves ' +
      'and A=10 … Z=35; a modern (21st-century) invention.',
    script: 'latin',
    modern: true,
    extended: true,
    alphabet: glyphs('0 1 2 3 4 5 6 7 8 9').concat(LATIN_ALPHABET),
    value: aqValue,
  }),
  defineCipher({
    id: 'la-elizabethan-simple',
    label: 'Elizabethan Simple (24 letters)',
    description:
      'Elizabethan Simple cipher over the 24-letter alphabet (I/J and U/V merged): A1 … H8, I/J 9, ' +
      'K10 … T19, U/V 20, W21 X22 Y23 Z24 (Manly P. Hall; Baconian literature).',
    script: 'latin',
    modern: false,
    extended: true,
    alphabet: ELIZABETHAN_ALPHABET,
    variants: ELIZABETHAN_VARIANTS,
    tableGlyphs: ELIZABETHAN_TABLE,
    value: elizabethanSimple,
  }),
  defineCipher({
    id: 'la-elizabethan-kaye',
    label: 'Kaye (Elizabethan)',
    description:
      'Baconian Kaye cipher over the 24-letter alphabet: K10 … T19, U/V 20, W21 X22 Y23 Z24, &25, ' +
      "then A27 … H34, I/J 35 (26 is the unscored 'et' sign).",
    script: 'latin',
    modern: false,
    extended: true,
    alphabet: [...ELIZABETHAN_ALPHABET, '&'],
    variants: ELIZABETHAN_VARIANTS,
    tableGlyphs: [...ELIZABETHAN_TABLE, '&'],
    value: kaye,
  }),
  defineCipher({
    id: 'la-roman',
    label: 'Roman numerals',
    description:
      'Roman-numeral letters I1 V5 X10 L50 C100 D500 M1000, all other letters 0 — the polemical ' +
      'isopsephy of Helwig (1612) and Uriah Smith (1866); VICARIVS FILII DEI = 666 was never an ' +
      'official papal title.',
    script: 'latin',
    modern: false,
    extended: true,
    alphabet: glyphs('i v x l c d m'),
    value: ROMAN,
  }),
])
