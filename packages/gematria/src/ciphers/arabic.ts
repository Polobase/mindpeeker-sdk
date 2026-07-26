/**
 * Arabic Abjad — *Ḥisāb al-Jummal*, the numeral use of the Arabic alphabet.
 * This is the Eastern / Mashriqi order (the order used across the Arab East and
 * in most magical/occult sources), whose 28 letters fill the ones, tens,
 * hundreds and a final thousand:
 *
 * $$\text{ا}1\,\text{ب}2\,\text{ج}3\,\text{د}4\,\text{ه}5\,\text{و}6\,\text{ز}7\,
 * \text{ح}8\,\text{ط}9\;\text{ي}10\,\text{ك}20\,\text{ل}30\,\text{م}40\,\text{ن}50\,
 * \text{س}60\,\text{ع}70\,\text{ف}80\,\text{ص}90\;\text{ق}100\,\text{ر}200\,
 * \text{ش}300\,\text{ت}400\,\text{ث}500\,\text{خ}600\,\text{ذ}700\,\text{ض}800\,
 * \text{ظ}900\,\text{غ}1000.$$
 *
 * Normalization (see {@link normalizeFor}) folds the alef variants آ أ إ ٱ to
 * bare alef ا, folds tāʾ marbūṭa ة to hāʾ ه (5), drops the free-standing hamza
 * ء and the harakāt/tatwīl marks, and leaves the isolated/medial/final glyph
 * shapes to Unicode canonical form (they share one code point per letter). As
 * with Hebrew, summing is order-independent, so right-to-left needs no special
 * handling. This is `modern: false`: the Abjad numerals are the historical
 * pre-Hindu-Arabic number system of the script.
 *
 * Sources: standard *Ḥisāb al-Jummal* Abjad tables (Mashriqi order); Andrew
 * Chumbley, *Qutub* (the 28-letter Arabic values); H. P. Blavatsky and the
 * comparative-alphabet literature (alif = 1 … ghayn = 1000).
 */

import type { Cipher, LetterValue } from '../types.js'

// [glyph, value] in Mashriqi (Eastern) Abjad order.
const ARABIC_ROWS: readonly (readonly [string, number])[] = [
  ['ا', 1],
  ['ب', 2],
  ['ج', 3],
  ['د', 4],
  ['ه', 5],
  ['و', 6],
  ['ز', 7],
  ['ح', 8],
  ['ط', 9],
  ['ي', 10],
  ['ك', 20],
  ['ل', 30],
  ['م', 40],
  ['ن', 50],
  ['س', 60],
  ['ع', 70],
  ['ف', 80],
  ['ص', 90],
  ['ق', 100],
  ['ر', 200],
  ['ش', 300],
  ['ت', 400],
  ['ث', 500],
  ['خ', 600],
  ['ذ', 700],
  ['ض', 800],
  ['ظ', 900],
  ['غ', 1000],
]

const ARABIC_VALUES: ReadonlyMap<string, number> = new Map(ARABIC_ROWS)

function abjad(ch: string): number {
  return ARABIC_VALUES.get(ch) ?? 0
}

const ARABIC_TABLE: readonly LetterValue[] = Object.freeze(
  ARABIC_ROWS.map(([char, value]) => Object.freeze({ char, value })),
)

/** The single Arabic cipher (Abjad, Mashriqi order). */
export const ARABIC_CIPHERS: readonly Cipher[] = Object.freeze([
  Object.freeze({
    id: 'ar-abjad',
    label: 'Abjad (Mashriqi)',
    script: 'arabic',
    modern: false,
    letterValue: abjad,
    table: ARABIC_TABLE,
  }),
])
