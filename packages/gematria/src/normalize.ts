/**
 * Unicode normalization, script detection and the digital-root primitive.
 *
 * **Detection** uses Unicode block ranges, first match wins in this order:
 * Hebrew (U+0590–U+05FF, presentation forms U+FB1D–U+FB4F) › Arabic
 * (U+0600–U+06FF, U+0750–U+077F, U+08A0–U+08FF, presentation forms
 * U+FB50–U+FDFF and U+FE70–U+FEFE) › Syriac (U+0700–U+074F, U+0860–U+086F) ›
 * Coptic (U+2C80–U+2CFF and the Coptic letters U+03E2–U+03EF of the Greek
 * block) › Greek (U+0370–U+03FF, Greek Extended U+1F00–U+1FFF) › Cyrillic
 * (U+0400–U+052F, U+1C80–U+1C8F, U+2DE0–U+2DFF, U+A640–U+A69F) › Armenian
 * (U+0530–U+058F, ligatures U+FB13–U+FB17) › Georgian (U+10A0–U+10FF,
 * Mtavruli U+1C90–U+1CBF, Nuskhuri U+2D00–U+2D2F) › Gothic (U+10330–U+1034F);
 * anything else is Latin. Format controls are ignored by detection.
 *
 * **Normalization policy** — every script first drops the Unicode *format*
 * characters (general category Cf: ZWJ, ZWNJ, LRM/RLM, ALM, bidi embeddings and
 * isolates, the BOM, soft hyphen), so invisible controls never split or hide a
 * letter. Then, per script:
 *
 * - **Hebrew** — compatibility composition (NFKC), then drop the niqqud and
 *   cantillation marks (U+0591–U+05C7), and expand the Yiddish ligatures
 *   װ→וו, ױ→וי, ײ→יי (they have no Unicode decomposition). NFKC folds the
 *   presentation forms (wide letters ﬡ, alternative ayin ﬠ, the alef-lamed
 *   ligature ﭏ→אל) and the letterlike symbols ℵ ℶ ℷ ℸ to their letters. Final
 *   ("sofit") forms are *kept*: only `he-gadol` gives them distinct values.
 * - **Arabic** — compatibility decomposition (NFKD), so the hamza-seated
 *   letters split into seat + hamza mark (ؤ→و, ئ→ي, أ/إ/آ→ا) and the
 *   presentation forms and ligatures (ﻻ→لا, ﷲ→الله) become base letters;
 *   then drop the harakāt/tanwīn/Quranic marks and tatwīl, and fold the letter
 *   conventions of Ḥisāb al-Jummal: alef wasla ٱ→ا, tāʾ marbūṭa ة→ه (5), alef
 *   maqsūra ى→ي (10), and the Persian/Urdu code points keheh ک→ك and farsi
 *   yeh ی→ي (the same letters, encoded differently). The free-standing hamza ء
 *   carries no Abjad value and is dropped. The Persian-only letters پ چ ژ گ are
 *   *not* folded and score 0.
 * - **Greek, Latin, Cyrillic, Armenian, Georgian, Coptic, Syriac, Gothic** —
 *   compatibility decomposition (NFKD), drop every combining mark (category M:
 *   accents, breathings, iota subscript, titlo, Coptic/Gothic numeral
 *   overlines, Syriac vowel points), then lowercase. NFKD is a deliberate
 *   *compatibility policy*: the Greek symbol letters ϐ ϑ ϕ ϖ ϰ ϱ ϲ ϵ and the
 *   micro sign µ score as β θ φ π κ ρ ς ε μ; Latin ligatures (ﬁ→fi), long s
 *   (ſ→s), fullwidth (Ａ→a) and mathematical alphanumerics (𝐀→a) score as their
 *   letters; Roman numeral signs spell out (Ⅷ→viii); ™ becomes "tm" and
 *   superscript digits become digits. Precomposed letters lose their marks
 *   (Й→и, Ё→е, Ї→і, և→եւ).
 *
 * No-break spaces (U+00A0, U+202F, U+2007) fold to an ordinary space under
 * NFKC/NFKD in every script, so they score 0 and still separate words.
 *
 * Sources: Unicode Standard Annex #15 (normalization forms) and the Unicode
 * Character Database (general categories, decompositions); torahcalc.com
 * (Hebrew method charts); the Milesian isopsephy convention of stripping accents
 * before summing; standard Ḥisāb al-Jummal Abjad conventions (hamza on its
 * seat, tāʾ marbūṭa as hāʾ, alef maqsūra as yāʾ).
 */

import { GematriaError } from './errors.js'
import type { Script } from './types.js'

const FORMAT_CONTROLS = /\p{Cf}/gu
const COMBINING_MARKS = /\p{M}/gu
const HEBREW_POINTS = /[\u0591-\u05C7]/g
// Arabic harakāt/tanwīn and hamza marks, superscript alef, Quranic annotation
// marks, and tatwīl.
const ARABIC_MARKS = /[\u0610-\u061A\u0640\u064B-\u0670\u065F\u06D6-\u06ED]/g

const SCRIPT_RANGES: readonly (readonly [Script, RegExp])[] = [
  ['hebrew', /[\u0590-\u05FF\uFB1D-\uFB4F]/],
  ['arabic', /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFE]/],
  ['syriac', /[\u0700-\u074F\u0860-\u086F]/],
  ['coptic', /[\u2C80-\u2CFF\u03E2-\u03EF]/],
  ['greek', /[\u0370-\u03FF\u1F00-\u1FFF]/],
  ['cyrillic', /[\u0400-\u052F\u1C80-\u1C8F\u2DE0-\u2DFF\uA640-\uA69F]/],
  ['armenian', /[\u0530-\u058F\uFB13-\uFB17]/],
  ['georgian', /[\u10A0-\u10FF\u1C90-\u1CBF\u2D00-\u2D2F]/],
  ['gothic', /[\u{10330}-\u{1034F}]/u],
]

const SCRIPTS: ReadonlySet<string> = new Set<string>([
  'latin',
  ...SCRIPT_RANGES.map(([script]) => script),
])

/** Base letter for each Hebrew final ("sofit") form. */
export const HEBREW_FINALS: Readonly<Record<string, string>> = Object.freeze({
  ך: 'כ',
  ם: 'מ',
  ן: 'נ',
  ף: 'פ',
  ץ: 'צ',
})

/** The Yiddish ligatures, which have no Unicode decomposition. */
const YIDDISH_LIGATURES: Readonly<Record<string, string>> = Object.freeze({
  װ: 'וו',
  ױ: 'וי',
  ײ: 'יי',
})

/**
 * Arabic letter conventions folded after decomposition — glyph → the Abjad
 * letter it is counted as. Shared with the `ar-abjad` cipher's `fold`.
 */
export const ARABIC_LETTER_FOLDS: Readonly<Record<string, string>> = Object.freeze({
  آ: 'ا',
  أ: 'ا',
  إ: 'ا',
  ٱ: 'ا',
  ؤ: 'و',
  ئ: 'ي',
  ة: 'ه',
  ى: 'ي',
  ک: 'ك',
  ی: 'ي',
})

const ARABIC_FOLD_PATTERN = /[آأإٱؤئةىکی]/g
const YIDDISH_PATTERN = /[װױײ]/g

/** Whether `script` names a supported {@link Script}. */
export function isScript(script: unknown): script is Script {
  return typeof script === 'string' && SCRIPTS.has(script)
}

/**
 * Detect the script from the first characters that fall inside a known block,
 * in the precedence order of the module doc (Hebrew › Arabic › Syriac › Coptic
 * › Greek › Cyrillic › Armenian › Georgian › Gothic). A string with none of
 * those code points (including empty and pure-punctuation text) is `'latin'`.
 *
 * @throws GematriaError `'invalid_input'` if `text` is not a string
 */
export function detectScript(text: string): Script {
  if (typeof text !== 'string') {
    throw new GematriaError('invalid_input', `text must be a string, got ${typeof text}`)
  }
  const visible = text.replace(FORMAT_CONTROLS, '')
  for (const [script, range] of SCRIPT_RANGES) if (range.test(visible)) return script
  return 'latin'
}

/**
 * Normalize `text` for a given script's ciphers (see the module doc for the
 * exact per-script rule). Idempotent, and safe on mixed input — characters
 * outside the script simply score `0` under that script's ciphers.
 *
 * @throws GematriaError `'invalid_input'` if `text` is not a string
 * @throws GematriaError `'unsupported_script'` if `script` is not a {@link Script}
 */
export function normalizeFor(text: string, script: Script): string {
  if (typeof text !== 'string') {
    throw new GematriaError('invalid_input', `text must be a string, got ${typeof text}`)
  }
  if (!isScript(script)) {
    throw new GematriaError('unsupported_script', `unsupported script: ${String(script)}`)
  }
  const visible = text.replace(FORMAT_CONTROLS, '')
  if (script === 'hebrew') {
    return visible
      .normalize('NFKC')
      .replace(HEBREW_POINTS, '')
      .replace(YIDDISH_PATTERN, (ch) => YIDDISH_LIGATURES[ch] ?? ch)
  }
  if (script === 'arabic') {
    return visible
      .normalize('NFKD')
      .replace(ARABIC_MARKS, '')
      .replace(ARABIC_FOLD_PATTERN, (ch) => ARABIC_LETTER_FOLDS[ch] ?? ch)
      .replace(/ء/g, '') // free-standing hamza carries no Abjad value
  }
  return visible.normalize('NFKD').replace(COMBINING_MARKS, '').toLowerCase()
}

/**
 * The digital root of a number's magnitude: truncate toward zero, take the
 * absolute value, and repeatedly sum the decimal digits until one digit
 * remains. Equivalent to $1 + (n - 1) \bmod 9$ for $n > 0$, with
 * $\operatorname{dr}(0) = 0$. This is the reduction underlying Mispar Katan and
 * the Pythagorean cipher.
 *
 * @throws GematriaError `'invalid_input'` if `n` is not a finite number
 */
export function digitRoot(n: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new GematriaError('invalid_input', `digitRoot expects a finite number, got ${n}`)
  }
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
