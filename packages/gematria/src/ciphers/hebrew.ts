/**
 * The Hebrew ciphers. Twenty-two letters, aleph … tav, with the classical
 * absolute values א=1 … י=10 … ק=100 … ת=400 (Mispar Hechrachi). The methods:
 *
 * - **Hechrachi** (`he-hechrachi`) — the standard/absolute value.
 * - **Gadol** (`he-gadol`) — as Hechrachi, but the five final ("sofit") forms
 *   take the continued values ך=500 ם=600 ן=700 ף=800 ץ=900.
 * - **Siduri** (`he-siduri`) — ordinal position, א=1 … ת=22.
 * - **Katan** (`he-katan`) — each letter reduced to its digital root
 *   (ק=100→1, ר=200→2), then summed (per-letter reduction, the frontend rule).
 * - **Atbash** (`he-atbash`) — the temurah cipher mapping letter $i$ (0-based
 *   over the 22) to letter $21 - i$ (א↔ת, ב↔ש, …), scored with its Hechrachi
 *   value.
 * - **Albam** (`he-albam`) — the temurah cipher mapping letter $i$ to
 *   $(i + 11) \bmod 22$, scored with its Hechrachi value.
 *
 * The SDK-added *extended* methods (`extended: true`, kept out of the default
 * {@link profile}), each a distinct classical "Mispar":
 *
 * - **Milui / Mispar Shemi** (`he-milui`) — the "filling": each letter scores
 *   the Hechrachi value of its *spelled-out name* (aleph = אלף = 111, bet =
 *   בית = 412, …). See {@link HE_NAMES} for the standard plene table and
 *   {@link milui} for the four divine-name variants AB/SAG/MAH/BAN of יהוה.
 * - **Kidmi** (`he-kidmi`) — triangular/cumulative: each letter scores the
 *   running sum of Hechrachi values up to and including it (א1 ב3 ג6 … ת1495).
 * - **Perati** (`he-perati`) — squared: each letter scores its Hechrachi value
 *   squared (א1 ב4 … ק10000 ר40000 ש90000 ת160000).
 * - **Neelam** (`he-neelam`) — "hidden": each letter scores its Milui value
 *   minus its own Hechrachi value (the name with the letter itself removed).
 * - **Katan Mispari** (`he-katan-mispari`) — integral reduced: the digital
 *   root of the *whole word's* Hechrachi total (a word-level {@link
 *   Cipher.postSum}), as opposed to `he-katan`'s per-letter reduction.
 *
 * In every method except Gadol the final forms fold to their base letter
 * (ך→כ, ם→מ, ן→נ, ף→פ, ץ→צ). RTL is irrelevant: a sum is order-independent.
 *
 * Sources: torahcalc.com (Hebrew method charts); S. L. MacGregor Mathers,
 * *The Kabbalah Unveiled* (Atbash/Albam temurah); Gershom Scholem, *Kabbalah*
 * (the three literal-Kabbalah divisions Gematria/Notariqon/Temurah); Aryeh
 * Kaplan, *Sefer Yetzirah*, and David Godwin, *Cabalistic Encyclopedia* (letter
 * names / Milui and the AB=72, SAG=63, MAH=45, BAN=52 Miluim of the
 * Tetragrammaton, one per Qabalistic world); Lon Milo DuQuette, *Llewellyn's
 * Complete Book of Ceremonial Magick* (Kidmi/Perati/Neelam Mispar methods).
 */

import { digitRoot, HEBREW_FINALS, normalizeFor } from '../normalize.js'
import type { Cipher, LetterValue } from '../types.js'

/** The 22 base letters in value order, aleph → tav. */
export const HE_BASE: readonly string[] = [
  'א',
  'ב',
  'ג',
  'ד',
  'ה',
  'ו',
  'ז',
  'ח',
  'ט',
  'י',
  'כ',
  'ל',
  'מ',
  'נ',
  'ס',
  'ע',
  'פ',
  'צ',
  'ק',
  'ר',
  'ש',
  'ת',
]

/** Hechrachi (absolute) value of the base letter at each index. */
const HE_STD: readonly number[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 300, 400,
]

/** The five final forms and their Gadol values. */
const HE_FINALS: readonly (readonly [string, number])[] = [
  ['ך', 500],
  ['ם', 600],
  ['ן', 700],
  ['ף', 800],
  ['ץ', 900],
]

const HE_GADOL_FINALS: ReadonlyMap<string, number> = new Map(HE_FINALS)
const HE_INDEX: ReadonlyMap<string, number> = new Map(HE_BASE.map((ch, i) => [ch, i]))

/** 0-based index of a Hebrew letter (finals folded to base), or `-1`. */
export function heIndex(ch: string): number {
  const base = HEBREW_FINALS[ch] ?? ch
  return HE_INDEX.get(base) ?? -1
}

function hechrachi(ch: string): number {
  const i = heIndex(ch)
  return i >= 0 ? (HE_STD[i] as number) : 0
}

function gadol(ch: string): number {
  return HE_GADOL_FINALS.get(ch) ?? hechrachi(ch)
}

function siduri(ch: string): number {
  const i = heIndex(ch)
  return i >= 0 ? i + 1 : 0
}

function katan(ch: string): number {
  const v = hechrachi(ch)
  return v > 0 ? digitRoot(v) : 0
}

function atbash(ch: string): number {
  const i = heIndex(ch)
  return i >= 0 ? (HE_STD[21 - i] as number) : 0
}

function albam(ch: string): number {
  const i = heIndex(ch)
  return i >= 0 ? (HE_STD[(i + 11) % 22] as number) : 0
}

/**
 * The standard plene ("full") spelling of each base letter's Hebrew name. A
 * letter's Milui (Mispar Shemi) value is the Hechrachi value of this name — so
 * `nameValue('אלף') = 1 + 30 + 80 = 111` for aleph. Spellings vary by tradition;
 * this is the common plene table (aleph אלף=111, bet בית=412, gimel גמל=73,
 * dalet דלת=434, he הה=10, vav וו=12, zayin זין=67, chet חית=418, tet טית=419,
 * yod יוד=20, kaf כף=100, lamed למד=74, mem מם=80, nun נון=106, samekh סמך=120,
 * ayin עין=130, pe פא=81, tsadi צדי=104, qof קוף=186, resh ריש=510, shin שין=360,
 * tav תו=406). Its he/vav choices coincide with the BAN Milui; the AB/SAG/MAH
 * variants are selected via {@link milui}.
 */
export const HE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  א: 'אלף',
  ב: 'בית',
  ג: 'גמל',
  ד: 'דלת',
  ה: 'הה',
  ו: 'וו',
  ז: 'זין',
  ח: 'חית',
  ט: 'טית',
  י: 'יוד',
  כ: 'כף',
  ל: 'למד',
  מ: 'מם',
  נ: 'נון',
  ס: 'סמך',
  ע: 'עין',
  פ: 'פא',
  צ: 'צדי',
  ק: 'קוף',
  ר: 'ריש',
  ש: 'שין',
  ת: 'תו',
})

/** The four Miluim of the Tetragrammaton — variant he/vav spellings only. */
export type MiluiVariant = 'ab' | 'sag' | 'mah' | 'ban'

const MILUI_VARIANTS: Readonly<Record<MiluiVariant, Readonly<Record<string, string>>>> =
  Object.freeze({
    ab: Object.freeze({ ה: 'הי', ו: 'ויו' }), // yod הי=15, vav ויו=22 → יהוה = 72
    sag: Object.freeze({ ה: 'הי', ו: 'ואו' }), // he הי=15, vav ואו=13 → יהוה = 63
    mah: Object.freeze({ ה: 'הא', ו: 'ואו' }), // he הא=6, vav ואו=13 → יהוה = 45
    ban: Object.freeze({ ה: 'הה', ו: 'וו' }), // he הה=10, vav וו=12 → יהוה = 52
  })

/** The Hechrachi value of a whole spelled-out name (finals fold to base). */
function nameValue(name: string): number {
  let s = 0
  for (const ch of name) s += hechrachi(ch)
  return s
}

/** Per-letter Milui: the Hechrachi value of the letter's standard name. */
function milui1(ch: string): number {
  const base = HEBREW_FINALS[ch] ?? ch
  const name = HE_NAMES[base]
  return name ? nameValue(name) : 0
}

/**
 * Mispar Shemi (Milui): the summed value of the *spelled-out names* of the
 * Hebrew letters in `text`. With no `variant` the standard {@link HE_NAMES}
 * table is used; a `variant` selects one of the four classical Miluim of the
 * Tetragrammaton, which differ only in how he and vav are spelled and which
 * MUST come out exactly $\text{AB}=72$, $\text{SAG}=63$, $\text{MAH}=45$,
 * $\text{BAN}=52$ for יהוה. Non-Hebrew characters score 0.
 */
export function milui(text: string, variant?: MiluiVariant): number {
  const norm = normalizeFor(text, 'hebrew')
  const override = variant ? MILUI_VARIANTS[variant] : undefined
  let sum = 0
  for (const ch of norm) {
    const base = HEBREW_FINALS[ch] ?? ch
    const name = override?.[base] ?? HE_NAMES[base]
    if (name) sum += nameValue(name)
  }
  return sum
}

/** Cumulative (triangular) Hechrachi value at each base index: א1 ב3 … ת1495. */
const HE_KIDMI: readonly number[] = Object.freeze(
  HE_STD.reduce<number[]>((acc, v, i) => {
    acc.push((acc[i - 1] ?? 0) + v)
    return acc
  }, []),
)

function kidmi(ch: string): number {
  const i = heIndex(ch)
  return i >= 0 ? (HE_KIDMI[i] as number) : 0
}

function perati(ch: string): number {
  const v = hechrachi(ch)
  return v * v
}

function neelam(ch: string): number {
  return milui1(ch) - hechrachi(ch)
}

function table(alphabet: readonly string[], fn: (ch: string) => number): readonly LetterValue[] {
  return Object.freeze(alphabet.map((char) => Object.freeze({ char, value: fn(char) })))
}

/** Base 22 letters plus the 5 finals — the domain of the Gadol table. */
const HE_ALPHABET: readonly string[] = [...HE_BASE, ...HE_FINALS.map(([ch]) => ch)]

function hebrewCipher(
  id: Cipher['id'],
  label: string,
  letterValue: (ch: string) => number,
  alphabet: readonly string[] = HE_BASE,
  extended = false,
  postSum?: (sum: number) => number,
): Cipher {
  return Object.freeze({
    id,
    label,
    script: 'hebrew',
    modern: false,
    extended,
    letterValue,
    table: table(alphabet, letterValue),
    ...(postSum ? { postSum } : {}),
  })
}

/**
 * The eleven Hebrew ciphers: the six frontend methods first (display order),
 * then the five SDK-added extended Miluim (`extended: true`, omitted from the
 * default {@link profile}).
 */
export const HEBREW_CIPHERS: readonly Cipher[] = Object.freeze([
  hebrewCipher('he-hechrachi', 'Standard (Hechrachi)', hechrachi),
  hebrewCipher('he-gadol', 'Large (Gadol)', gadol, HE_ALPHABET),
  hebrewCipher('he-siduri', 'Ordinal (Siduri)', siduri),
  hebrewCipher('he-katan', 'Reduced (Katan)', katan),
  hebrewCipher('he-atbash', 'Atbash', atbash),
  hebrewCipher('he-albam', 'Albam', albam),
  hebrewCipher('he-milui', 'Full Spelling (Milui / Mispar Shemi)', milui1, HE_BASE, true),
  hebrewCipher('he-kidmi', 'Triangular (Kidmi)', kidmi, HE_BASE, true),
  hebrewCipher('he-perati', 'Squared (Perati)', perati, HE_BASE, true),
  hebrewCipher('he-neelam', 'Hidden (Neelam)', neelam, HE_BASE, true),
  hebrewCipher(
    'he-katan-mispari',
    'Integral Reduced (Katan Mispari)',
    hechrachi,
    HE_BASE,
    true,
    digitRoot,
  ),
])
