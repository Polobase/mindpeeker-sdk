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
 *   בית = 412, …). See {@link HE_NAMES} for the default spellings, the
 *   `namesVariant: 'plene'` option (gimel גימל = 83, pe פה = 85) and
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
 * Every cipher's canonical alphabet is the 22 base letters and its `fold` maps
 * the finals to their base letter (ך→כ, ם→מ, ן→נ, ף→פ, ץ→צ). In every method
 * except Gadol the finals therefore score as their base letter; Gadol alone
 * gives them their own forward values (500–900). **Reverse** mirrors the 22
 * base letters (א↔ת, ב↔ש, …) for every method: a final takes the value of its
 * base letter's mirror, so `value(w, 'he-hechrachi', true)` equals
 * `value(w, 'he-atbash')` for every word, and a reversed Gadol is the same
 * mirror (the finals' 500–900 values have no mirror partner, so reversed finals
 * score as their base letter's mirror). RTL is irrelevant: a sum is
 * order-independent.
 *
 * Sources: Agrippa, *De Occulta Philosophia* II.xix (the 22 letters, the five
 * finals 500–900); Crowley, *Sepher Sephiroth* (Equinox I.8, 1912: the letter
 * names, Pe as PH = 85, gimel as GML 73 and GYML 83); torahcalc.com (Hebrew
 * method charts); S. L. MacGregor Mathers,
 * *The Kabbalah Unveiled* (Atbash/Albam temurah); Gershom Scholem, *Kabbalah*
 * (the three literal-Kabbalah divisions Gematria/Notariqon/Temurah); Aryeh
 * Kaplan, *Sefer Yetzirah*, and David Godwin, *Cabalistic Encyclopedia* (letter
 * names / Milui and the AB=72, SAG=63, MAH=45, BAN=52 Miluim of the
 * Tetragrammaton, one per Qabalistic world); Lon Milo DuQuette, *Llewellyn's
 * Complete Book of Ceremonial Magick* (Kidmi/Perati/Neelam Mispar methods).
 */

import { GematriaError } from '../errors.js'
import { digitRoot, HEBREW_FINALS, normalizeFor } from '../normalize.js'
import type { Cipher, CipherId, NamesVariant } from '../types.js'
import { isOptionsObject, requireString } from '../validate.js'
import { defineCipher, numeralLadder } from './define.js'

/** The 22 base letters in value order, aleph → tav (frozen). */
export const HE_BASE: readonly string[] = Object.freeze([
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
])

/** Hechrachi (absolute) value of the base letter at each index. */
const HE_STD: readonly number[] = Object.freeze(HE_BASE.map((_, i) => numeralLadder(i)))

/** The five final forms and their Gadol values. */
const HE_GADOL_FINALS: ReadonlyMap<string, number> = new Map([
  ['ך', 500],
  ['ם', 600],
  ['ן', 700],
  ['ף', 800],
  ['ץ', 900],
])
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
 * The default spelling of each base letter's Hebrew name, used by `he-milui`,
 * `he-neelam` and {@link milui}. A letter's Milui (Mispar Shemi) value is the
 * Hechrachi value of its name — `אלף = 1 + 30 + 80 = 111` for aleph. Spellings
 * vary by tradition; this default keeps frontend parity: aleph אלף=111, bet
 * בית=412, gimel גמל=73 (defective spelling), dalet דלת=434, he הה=10, vav
 * וו=12, zayin זין=67, chet חית=418, tet טית=419, yod יוד=20, kaf כף=100, lamed
 * למד=74, mem מם=80, nun נון=106, samekh סמך=120, ayin עין=130, pe פא=81,
 * tsadi צדי=104, qof קוף=186, resh ריש=510, shin שין=360, tav תו=406. The
 * `namesVariant: 'plene'` option spells gimel גימל (83) and pe פה (85) instead
 * (see `NamesVariant`), which raises every he-milui total by 10 per gimel and 4
 * per pe, and every he-neelam total by the same amounts. Its he/vav choices
 * coincide with the BAN Milui; the AB/SAG/MAH variants are selected via
 * {@link milui}.
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

/** The plene letter names: {@link HE_NAMES} with gimel גימל (83) and pe פה (85). */
const HE_NAMES_PLENE: Readonly<Record<string, string>> = Object.freeze({
  ...HE_NAMES,
  ג: 'גימל',
  פ: 'פה',
})

function namesTable(variant: NamesVariant): Readonly<Record<string, string>> {
  return variant === 'plene' ? HE_NAMES_PLENE : HE_NAMES
}

/** The four Miluim of the Tetragrammaton — variant he/vav spellings only. */
export type MiluiVariant = 'ab' | 'sag' | 'mah' | 'ban'

/** Options for {@link milui}. */
export interface MiluiOptions {
  /** One of the four Tetragrammaton fillings (case-insensitive). */
  readonly variant?: MiluiVariant | Uppercase<MiluiVariant>
  /** Letter-name spelling convention. Default `'standard'`. */
  readonly namesVariant?: NamesVariant
}

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

/** Per-letter Milui under a names convention: the value of the letter's name. */
export function miluiLetter(variant: NamesVariant): (ch: string) => number {
  const names = namesTable(variant)
  return (ch) => {
    const name = names[HEBREW_FINALS[ch] ?? ch]
    return name ? nameValue(name) : 0
  }
}

/** Per-letter Neelam under a names convention: Milui minus the letter itself. */
export function neelamLetter(variant: NamesVariant): (ch: string) => number {
  const letterMilui = miluiLetter(variant)
  return (ch) => letterMilui(ch) - hechrachi(ch)
}

function parseMiluiOptions(arg: unknown): { variant?: MiluiVariant; names: NamesVariant } {
  if (arg === undefined) return { names: 'standard' }
  const bag = isOptionsObject(arg) ? arg : { variant: arg }
  const raw = bag.variant
  let variant: MiluiVariant | undefined
  if (raw !== undefined) {
    const key = typeof raw === 'string' ? raw.toLowerCase() : undefined
    if (key === undefined || !Object.hasOwn(MILUI_VARIANTS, key)) {
      throw new GematriaError(
        'invalid_input',
        `milui variant must be one of ab, sag, mah, ban, got ${String(raw)}`,
      )
    }
    variant = key as MiluiVariant
  }
  const names = bag.namesVariant
  if (names !== undefined && names !== 'standard' && names !== 'plene') {
    throw new GematriaError(
      'invalid_input',
      `namesVariant must be 'standard' or 'plene', got ${String(names)}`,
    )
  }
  return {
    ...(variant ? { variant } : {}),
    names: (names as NamesVariant | undefined) ?? 'standard',
  }
}

/**
 * Mispar Shemi (Milui): the summed value of the *spelled-out names* of the
 * Hebrew letters in `text`. With no variant the {@link HE_NAMES} spellings are
 * used; a variant (`'ab'`, `'sag'`, `'mah'`, `'ban'`, case-insensitive) selects
 * one of the four classical Miluim of the Tetragrammaton, which differ only in
 * how he and vav are spelled and which MUST come out exactly $\text{AB}=72$,
 * $\text{SAG}=63$, $\text{MAH}=45$, $\text{BAN}=52$ for יהוה. Pass an options
 * object to combine a variant with `namesVariant: 'plene'` (gimel גימל, pe
 * פה). Non-Hebrew characters score 0.
 *
 * @throws GematriaError `'invalid_input'` if `text` is not a string, or for an
 *   unknown variant or names convention
 */
export function milui(
  text: string,
  variant?: MiluiVariant | Uppercase<MiluiVariant> | MiluiOptions,
): number {
  requireString(text)
  const opts = parseMiluiOptions(variant)
  const names = namesTable(opts.names)
  const override = opts.variant ? MILUI_VARIANTS[opts.variant] : undefined
  let sum = 0
  for (const ch of normalizeFor(text, 'hebrew')) {
    const base = HEBREW_FINALS[ch] ?? ch
    const name = override?.[base] ?? names[base]
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

/** Base 22 letters plus the 5 finals — the table rows of Gadol. */
const HE_GADOL_TABLE: readonly string[] = Object.freeze([...HE_BASE, ...HE_GADOL_FINALS.keys()])

interface HebrewSpec {
  readonly label: string
  readonly description: string
  readonly value: (ch: string) => number
  readonly extended?: boolean
  readonly postSum?: (sum: number) => number
}

function hebrewCipher(id: CipherId, spec: HebrewSpec): Cipher {
  return defineCipher({
    id,
    script: 'hebrew',
    modern: false,
    alphabet: HE_BASE,
    variants: HEBREW_FINALS,
    ...spec,
  })
}

/**
 * The eleven Hebrew ciphers: the six frontend methods first (display order),
 * then the five SDK-added extended Misparim (`extended: true`, omitted from the
 * default `profile`).
 */
export const HEBREW_CIPHERS: readonly Cipher[] = Object.freeze([
  hebrewCipher('he-hechrachi', {
    label: 'Standard (Hechrachi)',
    description: 'Mispar Hechrachi, the absolute value: א1…ט9, י10…צ90, ק100…ת400; finals as base.',
    value: hechrachi,
  }),
  defineCipher({
    id: 'he-gadol',
    label: 'Large (Gadol)',
    description:
      'Mispar Gadol: as Hechrachi, but the five finals continue the hundreds, ך500 ם600 ן700 ף800 ' +
      'ץ900 (Agrippa II.xix).',
    script: 'hebrew',
    modern: false,
    alphabet: HE_BASE,
    variants: HEBREW_FINALS,
    glyphValue: (glyph) => HE_GADOL_FINALS.get(glyph),
    tableGlyphs: HE_GADOL_TABLE,
    value: hechrachi,
  }),
  hebrewCipher('he-siduri', {
    label: 'Ordinal (Siduri)',
    description: 'Mispar Siduri: each letter scores its position, א1 … ת22.',
    value: siduri,
  }),
  hebrewCipher('he-katan', {
    label: 'Reduced (Katan)',
    description: "Mispar Katan: each letter's Hechrachi value reduced to its digital root, summed.",
    value: katan,
  }),
  hebrewCipher('he-atbash', {
    label: 'Atbash',
    description:
      'Atbash temurah (א↔ת, ב↔ש, …) scored with the substituted letter’s Hechrachi value.',
    value: atbash,
  }),
  hebrewCipher('he-albam', {
    label: 'Albam',
    description: 'Albam temurah (letter i → i+11 mod 22) scored with the Hechrachi value.',
    value: albam,
  }),
  hebrewCipher('he-milui', {
    label: 'Full Spelling (Milui / Mispar Shemi)',
    description:
      'Mispar Shemi / Milui: each letter scores the Hechrachi value of its spelled-out name (אלף ' +
      "= 111); option namesVariant: 'plene' spells gimel גימל and pe פה.",
    value: miluiLetter('standard'),
    extended: true,
  }),
  hebrewCipher('he-kidmi', {
    label: 'Triangular (Kidmi)',
    description:
      'Mispar Kidmi: the running sum of Hechrachi values up to each letter, א1 ב3 … ת1495.',
    value: kidmi,
    extended: true,
  }),
  hebrewCipher('he-perati', {
    label: 'Squared (Perati)',
    description: "Mispar Perati: each letter's Hechrachi value squared, א1 … ת160000.",
    value: perati,
    extended: true,
  }),
  hebrewCipher('he-neelam', {
    label: 'Hidden (Neelam)',
    description:
      "Mispar Ne'elam: the Milui of each letter minus the letter itself (the name's hidden part); " +
      'follows namesVariant like he-milui.',
    value: neelamLetter('standard'),
    extended: true,
  }),
  hebrewCipher('he-katan-mispari', {
    label: 'Integral Reduced (Katan Mispari)',
    description: "Mispar Katan Mispari: the digital root of the whole word's Hechrachi total.",
    value: hechrachi,
    extended: true,
    postSum: digitRoot,
  }),
])
