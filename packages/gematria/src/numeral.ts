/**
 * Hebrew letter numerals — writing an integer with Hebrew letters, the inverse
 * of Mispar Hechrachi for a single number.
 *
 * A number is written greatest value first: hundreds, tens, units. Hundreds
 * above 400 are built from ת (400) — 500 = תק, 600 = תר, 700 = תש, 800 = תת,
 * 900 = תתק — or, with `finals: true`, written with the final forms ך ם ן ף ץ
 * (the Gadol values 500–900). Fifteen and sixteen are written טו (9 + 6) and
 * טז (9 + 7) rather than יה and יו, which spell divine names; Agrippa states the
 * rule for 15, and 16 = טז is the same universal convention. A multiple of a
 * thousand is written as its thousands count followed by a geresh ׳ — Agrippa's
 * letters "marked with a great Character" — so 5784 is ה׳תשפ״ד. With
 * `punctuation` (the default) the part below a thousand carries a gershayim ״
 * before its last letter, or a geresh ׳ after a single letter.
 *
 * Geresh and gershayim are not letters, so they score 0: for $1 \le n \le 999$,
 * `value(toHebrewNumeral(n), 'he-hechrachi') === n` (and with `finals: true`,
 * the same under `he-gadol`). Other avoidances some writers apply (ער for 270,
 * שדמ for 344) are *not* applied.
 *
 * Sources: H. C. Agrippa, *De Occulta Philosophia* II.xix (1533; the fifteen as
 * nine and six, the ת-compounds for 500–900, thousands by marked letters);
 * standard Hebrew numeral orthography (geresh U+05F3, gershayim U+05F4).
 */

import { HE_BASE } from './ciphers/hebrew.js'
import { GematriaError } from './errors.js'
import { isOptionsObject } from './validate.js'

/** The largest number {@link toHebrewNumeral} writes: 999 999. */
export const MAX_HEBREW_NUMERAL = 999_999

/** Options for {@link toHebrewNumeral}. */
export interface HebrewNumeralOptions {
  /** Write 500–900 with the final forms ך ם ן ף ץ instead of ת-compounds. Default `false`. */
  readonly finals?: boolean
  /** Add gershayim ״ / geresh ׳ to the part below a thousand. Default `true`. */
  readonly punctuation?: boolean
}

const GERESH = '׳'
const GERSHAYIM = '״'
const FINAL_HUNDREDS: readonly string[] = ['ך', 'ם', 'ן', 'ף', 'ץ']

/** Letter for units digit `d` (1–9), tens digit (1–9) or hundreds digit (1–4). */
function letter(index: number): string {
  return HE_BASE[index] as string
}

/** The letters of `n` in $[1, 999]$, without punctuation. */
function below1000(n: number, finals: boolean): string {
  let out = ''
  let hundreds = Math.floor(n / 100)
  if (hundreds > 4 && finals) {
    out += FINAL_HUNDREDS[hundreds - 5] as string
    hundreds = 0
  }
  while (hundreds >= 4) {
    out += 'ת'
    hundreds -= 4
  }
  if (hundreds > 0) out += letter(17 + hundreds) // ק ר ש
  const rest = n % 100
  if (rest === 15) return `${out}טו`
  if (rest === 16) return `${out}טז`
  const tens = Math.floor(rest / 10)
  const units = rest % 10
  if (tens > 0) out += letter(8 + tens) // י … צ
  if (units > 0) out += letter(units - 1) // א … ט
  return out
}

function punctuate(letters: string): string {
  const chars = [...letters]
  if (chars.length === 1) return `${letters}${GERESH}`
  return `${chars.slice(0, -1).join('')}${GERSHAYIM}${chars[chars.length - 1] as string}`
}

function flag(opts: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = opts[key]
  if (v === undefined) return fallback
  if (typeof v !== 'boolean') {
    throw new GematriaError('invalid_input', `${key} must be a boolean, got ${typeof v}`)
  }
  return v
}

/**
 * Write the integer `n` ($1 \le n \le 999\,999$) as a Hebrew letter numeral (see
 * the module doc): `toHebrewNumeral(15)` is `'ט״ו'`, `toHebrewNumeral(26)` is
 * `'כ״ו'`, `toHebrewNumeral(5784)` is `'ה׳תשפ״ד'`, and
 * `toHebrewNumeral(15, { punctuation: false })` is `'טו'`.
 *
 * @throws GematriaError `'invalid_input'` unless `n` is an integer in
 *   $[1, 999\,999]$ and the options are booleans
 */
export function toHebrewNumeral(n: number, opts?: HebrewNumeralOptions): string {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_HEBREW_NUMERAL) {
    throw new GematriaError(
      'invalid_input',
      `toHebrewNumeral expects an integer in [1, 999999], got ${String(n)}`,
    )
  }
  if (opts !== undefined && !isOptionsObject(opts)) {
    throw new GematriaError('invalid_input', 'toHebrewNumeral options must be an object')
  }
  const bag = (opts ?? {}) as Record<string, unknown>
  const finals = flag(bag, 'finals', false)
  const punctuation = flag(bag, 'punctuation', true)
  const thousands = Math.floor(n / 1000)
  const rest = n % 1000
  let out = thousands > 0 ? `${below1000(thousands, finals)}${GERESH}` : ''
  if (rest > 0) {
    const letters = below1000(rest, finals)
    out += punctuation ? punctuate(letters) : letters
  }
  return out
}
