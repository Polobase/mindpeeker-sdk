/**
 * Unicode normalization, script detection and the digital-root primitive.
 *
 * Detection uses the Unicode block ranges: Hebrew $\text{U+0590..U+05FF}$,
 * Arabic $\text{U+0600..U+06FF}$, Greek $\text{U+0370..U+03FF}$ plus Greek
 * Extended $\text{U+1F00..U+1FFF}$; anything else is treated as Latin.
 * Per-script normalization strips exactly the marks that do not carry a
 * gematria value:
 *
 * - **Hebrew** — compose (NFC), then drop the niqqud vowel points and te'amim
 *   cantillation marks ($\text{U+0591..U+05C7}$). Final ("sofit") letter forms
 *   are *kept*: only `he-gadol` gives them distinct values (500–900); every
 *   other Hebrew cipher folds them to their base letter at value time.
 * - **Arabic** — compose (NFC), drop the harakāt/tanwīn/Quranic marks and
 *   tatwīl, fold the alef variants آ أ إ ٱ to bare alef ا, fold tāʾ marbūṭa ة
 *   to hāʾ ه, and drop the free-standing hamza ء (it carries no Abjad value).
 * - **Greek / Latin** — decompose (NFD), drop combining diacritics
 *   ($\text{U+0300..U+036F}$), then case-fold to lowercase. So accents,
 *   breathings and iota subscripts vanish (θέλημα → θελημα) and medial vs.
 *   final sigma collapse (both isopsephy value 200).
 *
 * Sources: torahcalc.com (Hebrew method charts); the Milesian isopsephy
 * convention of stripping accents before summing; standard Ḥisāb al-Jummal
 * Abjad normalization (alef/hamza folding, harakāt stripping).
 */

import type { Script } from './types.js'

const HEBREW_RANGE = /[֐-׿]/
const ARABIC_RANGE = /[؀-ۿ]/
const GREEK_RANGE = /[Ͱ-Ͽἀ-῿]/
const COMBINING_MARKS = /[̀-ͯ]/g
const HEBREW_POINTS = /[֑-ׇ]/g
// Arabic harakāt/tanwīn, superscript alef, Quranic annotation marks, and tatwīl.
const ARABIC_MARKS = /[ؐ-ؚـً-ٰٟۖ-ۭ]/g
const ARABIC_ALEFS = /[آأإٱ]/g // آ أ إ ٱ → ا

/** Base letter for each Hebrew final ("sofit") form. */
export const HEBREW_FINALS: Readonly<Record<string, string>> = Object.freeze({
  ך: 'כ',
  ם: 'מ',
  ן: 'נ',
  ף: 'פ',
  ץ: 'צ',
})

/**
 * Detect the script from the first characters that fall inside a known block.
 * Hebrew wins over Arabic wins over Greek wins over Latin. A string with no
 * Hebrew, Arabic or Greek code point (including empty and pure-punctuation) is
 * `'latin'`.
 */
export function detectScript(text: string): Script {
  if (HEBREW_RANGE.test(text)) return 'hebrew'
  if (ARABIC_RANGE.test(text)) return 'arabic'
  if (GREEK_RANGE.test(text)) return 'greek'
  return 'latin'
}

/**
 * Normalize `text` for a given script's ciphers (see the module doc for the
 * exact per-script rule). Idempotent, and safe on mixed input — characters
 * outside the script are passed through untouched and simply score `0`.
 */
export function normalizeFor(text: string, script: Script): string {
  if (script === 'hebrew') return text.normalize('NFC').replace(HEBREW_POINTS, '')
  if (script === 'arabic') {
    return text
      .normalize('NFC')
      .replace(ARABIC_MARKS, '')
      .replace(ARABIC_ALEFS, 'ا')
      .replace(/ة/g, 'ه') // tāʾ marbūṭa → hāʾ (value 5)
      .replace(/ء/g, '') // free-standing hamza carries no Abjad value
  }
  return text.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase()
}

/**
 * The digital root of a non-negative integer: repeatedly sum the decimal
 * digits until one digit remains. Equivalent to $1 + (n - 1) \bmod 9$ for
 * $n > 0$, with $\operatorname{dr}(0) = 0$. This is the reduction underlying
 * Mispar Katan and the Pythagorean cipher.
 */
export function digitRoot(n: number): number {
  let x = Math.abs(Math.trunc(n))
  while (x > 9) {
    let sum = 0
    while (x > 0) {
      sum += x % 10
      x = Math.floor(x / 10)
    }
    x = sum
  }
  return x
}
