/**
 * Alphabetic numeral ciphers of six further scripts. Each script wrote numbers
 * with its letters on the Greek/Semitic pattern — one letter per unit, ten and
 * hundred (and, for Armenian and Georgian, thousand) — and a word's value is
 * the sum of its letters, exactly as in isopsephy. All are `modern: false` and
 * the sole cipher of their script. Each canonical alphabet is the numeral
 * letters in value order, so reverse mirrors the numeral positions; glyphs that
 * stand for the same numeral fold to one canonical letter and share its value.
 *
 * How far each tradition *summed words* (rather than merely writing numbers)
 * varies: letter-sum gematria is well attested in the Greek, Hebrew, Arabic,
 * Syriac and Coptic milieus; for Cyrillic, Armenian, Georgian and Gothic these
 * ciphers apply the numeral values mechanically.
 *
 * - **Cyrillic / Church Slavonic** (`cu-cyrillic`) — the Greek-order Cyrillic
 *   numerals: а1 в2 г3 д4 е5 ѕ6 з7 и8 ѳ9, і10 к20 л30 м40 н50 ѯ60 о70 п80 ч90,
 *   р100 с200 т300 у400 ф500 х600 ѱ700 ѡ800 ц900. Variants: є = е (5), ҁ
 *   (koppa) = ч (90), ѵ (izhitsa) and ꙋ (monograph uk) = у (400), ѿ (ot) and ꙍ
 *   (broad omega) = ѡ (800), ѧ (little yus) = ц (900). Б, Ж and the letters
 *   without a numeral value score 0; the titlo and the thousands sign ҂ carry
 *   no value (the Western Cyrillic use of ч for 60 is not modelled).
 * - **Armenian** (`hy-numerals`) — the 36 Mesropian letters in alphabet order,
 *   ա1…թ9, ժ10…ղ90, ճ100…ջ900, ռ1000…ք9000, plus the later additions օ = 10000
 *   and ֆ = 20000 (added to the alphabet after Arabic numerals were in use; the
 *   values are sometimes assigned).
 * - **Georgian** (`ka-numerals`) — ა1 ბ2 გ3 დ4 ე5 ვ6 ზ7 ჱ8 თ9, ი10 კ20 ლ30 მ40
 *   ნ50 ჲ60 ო70 პ80 ჟ90, რ100 ს200 ტ300 ჳ400 ფ500 ქ600 ღ700 ყ800 შ900, ჩ1000
 *   ც2000 ძ3000 წ4000 ჭ5000 ხ6000 ჴ7000 ჯ8000 ჰ9000, ჵ10000; უ also = 400.
 *   Mkhedruli is canonical; Mtavruli capitals and the older Asomtavruli /
 *   Nuskhuri forms (in which the numerals were historically written) fold to it.
 * - **Coptic** (`cop-numerals`) — the Greek values on the Coptic letters: ⲁ1 ⲃ2
 *   ⲅ3 ⲇ4 ⲉ5 ⲋ(sou)6 ⲍ7 ⲏ8 ⲑ9, ⲓ10 ⲕ20 ⲗ30 ⲙ40 ⲛ50 ⲝ60 ⲟ70 ⲡ80 ϥ(fai)90, ⲣ100
 *   ⲥ200 ⲧ300 ⲩ400 ⲫ500 ⲭ600 ⲯ700 ⲱ800 ⳁ(sampi)900. The other Demotic-derived
 *   letters (ϣ ϧ ϩ ϫ ϭ ϯ) score 0; numeral overlines are stripped.
 * - **Syriac** (`syr-numerals`) — the 22 letters with the Hebrew values: ܐ1 ܒ2
 *   ܓ3 ܕ4 ܗ5 ܘ6 ܙ7 ܚ8 ܛ9, ܝ10 ܟ20 ܠ30 ܡ40 ܢ50 ܣ60 ܥ70 ܦ80 ܨ90, ܩ100 ܪ200 ܫ300
 *   ܬ400; final semkath ܤ = ܣ. The Garshuni letters, reversed pe and the
 *   ambiguous dotless dalath/rish score 0.
 * - **Gothic** (`got-numerals`) — Wulfila's alphabet in numeral order: 𐌰1 𐌱2 𐌲3
 *   𐌳4 𐌴5 𐌵6 𐌶7 𐌷8 𐌸9, 𐌹10 𐌺20 𐌻30 𐌼40 𐌽50 𐌾60 𐌿70 𐍀80 𐍁90, 𐍂100 𐍃200 𐍄300
 *   𐍅400 𐍆500 𐍇600 𐍈700 𐍉800 𐍊900 (𐍁 and 𐍊 are pure numeral signs).
 *
 * Sources: Wikipedia, "Cyrillic numerals" (after Chrisomalis, *Numerical
 * Notation*, and Lunt, *Old Church Slavonic Grammar*), "Armenian numerals",
 * "Georgian numerals", "Coptic script" (letter values), "Syriac alphabet" and
 * "Gothic alphabet"; *The Coptic Encyclopedia*, "Numbers" (digamma 6, koppa as
 * fai 90, sampi 900).
 */

import type { Cipher } from '../types.js'
import { defineCipher, glyphs, numeralLadder } from './define.js'

/** `count` consecutive code points from `start` (astral-safe). */
function codePointRun(start: number, count: number): readonly string[] {
  return Object.freeze(Array.from({ length: count }, (_, i) => String.fromCodePoint(start + i)))
}

function ladderOf(alphabet: readonly string[]): (letter: string) => number {
  const index: ReadonlyMap<string, number> = new Map(alphabet.map((ch, i) => [ch, i]))
  return (letter) => {
    const i = index.get(letter)
    return i === undefined ? 0 : numeralLadder(i)
  }
}

const CYRILLIC = glyphs('а в г д е ѕ з и ѳ і к л м н ѯ о п ч р с т у ф х ѱ ѡ ц')
const CYRILLIC_VARIANTS = Object.freeze({
  є: 'е',
  ҁ: 'ч',
  ѵ: 'у',
  ꙋ: 'у',
  ѿ: 'ѡ',
  ꙍ: 'ѡ',
  ѧ: 'ц',
})

/** ա (U+0561) … ք (U+0584), then օ ֆ: the 38 Armenian letters in order. */
const ARMENIAN = codePointRun(0x561, 38)

const GEORGIAN = glyphs('ა ბ გ დ ე ვ ზ ჱ თ ი კ ლ მ ნ ჲ ო პ ჟ რ ს ტ ჳ ფ ქ ღ ყ შ ჩ ც ძ წ ჭ ხ ჴ ჯ ჰ ჵ')

/**
 * Georgian glyph variants: un უ counts as vie ჳ (400), and the Nuskhuri letters
 * U+2D00–U+2D25 (the lowercase of Asomtavruli U+10A0–U+10C5) map one-to-one, in
 * the same order, onto Mkhedruli U+10D0–U+10F5.
 */
const GEORGIAN_VARIANTS: Readonly<Record<string, string>> = (() => {
  const variants: Record<string, string> = { უ: 'ჳ' }
  for (const [nuskhuri, mkhedruli] of codePointRun(0x2d00, 0x26).map(
    (ch, i) => [ch, String.fromCodePoint(0x10d0 + i)] as const,
  )) {
    variants[nuskhuri] = variants[mkhedruli] ?? mkhedruli
  }
  return Object.freeze(variants)
})()

const COPTIC = glyphs('ⲁ ⲃ ⲅ ⲇ ⲉ ⲋ ⲍ ⲏ ⲑ ⲓ ⲕ ⲗ ⲙ ⲛ ⲝ ⲟ ⲡ ϥ ⲣ ⲥ ⲧ ⲩ ⲫ ⲭ ⲯ ⲱ ⳁ')

const SYRIAC = glyphs('ܐ ܒ ܓ ܕ ܗ ܘ ܙ ܚ ܛ ܝ ܟ ܠ ܡ ܢ ܣ ܥ ܦ ܨ ܩ ܪ ܫ ܬ')

/** 𐌰 (U+10330) … 𐍊 (U+1034A): the 27 Gothic letters in numeral order. */
const GOTHIC = codePointRun(0x10330, 27)

/** The six alphabetic numeral ciphers, in registry order. */
export const NUMERAL_CIPHERS: readonly Cipher[] = Object.freeze([
  defineCipher({
    id: 'cu-cyrillic',
    label: 'Cyrillic numerals (Church Slavonic)',
    description:
      'Cyrillic numerals in Greek order: а1…ѳ9, і10…ч90, р100…ц900; є=е, ҁ=ч, ѵ/ꙋ=у, ѿ/ꙍ=ѡ, ' +
      'ѧ=ц; titlo and ҂ carry no value.',
    script: 'cyrillic',
    modern: false,
    alphabet: CYRILLIC,
    variants: CYRILLIC_VARIANTS,
    tableGlyphs: glyphs('а в г д е є ѕ з и ѳ і к л м н ѯ о п ч ҁ р с т у ѵ ꙋ ф х ѱ ѡ ѿ ꙍ ц ѧ'),
    value: ladderOf(CYRILLIC),
  }),
  defineCipher({
    id: 'hy-numerals',
    label: 'Armenian numerals',
    description:
      'Armenian numerals: ա1…թ9, ժ10…ղ90, ճ100…ջ900, ռ1000…ք9000, and the later additions ' +
      'օ10000 ֆ20000.',
    script: 'armenian',
    modern: false,
    alphabet: ARMENIAN,
    value: ladderOf(ARMENIAN),
  }),
  defineCipher({
    id: 'ka-numerals',
    label: 'Georgian numerals',
    description:
      'Georgian numerals: ა1…თ9, ი10…ჟ90, რ100…შ900, ჩ1000…ჰ9000, ჵ10000; უ=ჳ=400; Mtavruli, ' +
      'Asomtavruli and Nuskhuri fold to Mkhedruli.',
    script: 'georgian',
    modern: false,
    alphabet: GEORGIAN,
    variants: GEORGIAN_VARIANTS,
    tableGlyphs: glyphs(
      'ა ბ გ დ ე ვ ზ ჱ თ ი კ ლ მ ნ ჲ ო პ ჟ რ ს ტ ჳ უ ფ ქ ღ ყ შ ჩ ც ძ წ ჭ ხ ჴ ჯ ჰ ჵ',
    ),
    value: ladderOf(GEORGIAN),
  }),
  defineCipher({
    id: 'cop-numerals',
    label: 'Coptic numerals',
    description:
      'Coptic numerals (the Greek values): ⲁ1…ⲑ9 with sou ⲋ6, ⲓ10…ⲡ80 with fai ϥ90, ⲣ100…ⲱ800 ' +
      'with sampi ⳁ900.',
    script: 'coptic',
    modern: false,
    alphabet: COPTIC,
    value: ladderOf(COPTIC),
  }),
  defineCipher({
    id: 'syr-numerals',
    label: 'Syriac numerals',
    description:
      'Syriac numerals, the Hebrew values on the 22 letters: ܐ1…ܛ9, ܝ10…ܨ90, ܩ100 ܪ200 ܫ300 ' +
      'ܬ400; final semkath counts as semkath.',
    script: 'syriac',
    modern: false,
    alphabet: SYRIAC,
    variants: Object.freeze({ ܤ: 'ܣ' }),
    tableGlyphs: glyphs('ܐ ܒ ܓ ܕ ܗ ܘ ܙ ܚ ܛ ܝ ܟ ܠ ܡ ܢ ܣ ܤ ܥ ܦ ܨ ܩ ܪ ܫ ܬ'),
    value: ladderOf(SYRIAC),
  }),
  defineCipher({
    id: 'got-numerals',
    label: 'Gothic numerals',
    description: "Gothic numerals in Wulfila's order: 𐌰1…𐌸9, 𐌹10…𐍀80, 𐍁90, 𐍂100…𐍉800, 𐍊900.",
    script: 'gothic',
    modern: false,
    alphabet: GOTHIC,
    value: ladderOf(GOTHIC),
  }),
])
