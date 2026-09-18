// Cipher metadata for the gematria page. CLIENT-ONLY: it imports
// `@mindpeeker/gematria` (package source through the Vite aliases), so only
// `*.client.vue` components may import it.
//
// The package is the source of truth for ids, labels, descriptions, alphabets
// and flags; everything here is presentation — grouping by script, the lineage
// notes the README carries in prose, and sample texts.

import type { Cipher, CipherId, Script } from '@mindpeeker/gematria'
import { CIPHERS, CIPHERS_BY_SCRIPT, getCipher } from '@mindpeeker/gematria'

/** Display order of the ten scripts — the registry's own order. */
export const SCRIPT_ORDER: readonly Script[] = [
  'hebrew',
  'greek',
  'arabic',
  'latin',
  'cyrillic',
  'armenian',
  'georgian',
  'coptic',
  'syriac',
  'gothic',
]

export const SCRIPT_LABELS: Readonly<Record<Script, string>> = {
  hebrew: 'Hebrew',
  greek: 'Greek',
  arabic: 'Arabic',
  latin: 'Latin / English',
  cyrillic: 'Cyrillic',
  armenian: 'Armenian',
  georgian: 'Georgian',
  coptic: 'Coptic',
  syriac: 'Syriac',
  gothic: 'Gothic',
}

/** The flagship cipher of each script — what a script switch selects. */
export const SCRIPT_DEFAULT_CIPHER: Readonly<Record<Script, CipherId>> = {
  hebrew: 'he-hechrachi',
  greek: 'gr-isopsephy',
  arabic: 'ar-abjad',
  latin: 'en-ordinal',
  cyrillic: 'cu-cyrillic',
  armenian: 'hy-numerals',
  georgian: 'ka-numerals',
  coptic: 'cop-numerals',
  syriac: 'syr-numerals',
  gothic: 'got-numerals',
}

/** The nine ids that match the mindpeeker frontend engine row-for-row. */
export const FRONTEND_PARITY: ReadonlySet<string> = new Set([
  'he-hechrachi',
  'he-gadol',
  'he-siduri',
  'he-katan',
  'he-atbash',
  'he-albam',
  'gr-isopsephy',
  'en-ordinal',
  'en-reduction',
])

export type CipherSelectItem =
  | { readonly type: 'label'; readonly label: string }
  | { readonly label: string; readonly value: CipherId }

export interface CipherFilter {
  readonly scripts?: readonly Script[]
  readonly includeModern?: boolean
  readonly includeExtended?: boolean
}

/** Ciphers passing a filter, in registry order. */
export function filterCiphers(filter: CipherFilter = {}): readonly Cipher[] {
  const scripts = filter.scripts
  return CIPHERS.filter(
    (c) =>
      (!scripts || scripts.includes(c.script)) &&
      (filter.includeModern !== false || !c.modern) &&
      (filter.includeExtended !== false || !c.extended),
  )
}

/** USelect items for the ciphers, grouped under one `type: 'label'` per script. */
export function cipherSelectItems(filter: CipherFilter = {}): CipherSelectItem[] {
  const out: CipherSelectItem[] = []
  for (const script of SCRIPT_ORDER) {
    const group = filterCiphers({ ...filter, scripts: [script] })
    if (group.length === 0) continue
    out.push({ type: 'label', label: `${SCRIPT_LABELS[script]} — ${group.length}` })
    for (const c of group) out.push({ label: c.label, value: c.id })
  }
  return out
}

/** How many ciphers each script has (for the catalogue header). */
export function scriptCounts(): { script: Script; label: string; count: number }[] {
  return SCRIPT_ORDER.map((script) => ({
    script,
    label: SCRIPT_LABELS[script],
    count: CIPHERS_BY_SCRIPT[script].length,
  }))
}

/** `keepTen` is rejected (`invalid_input`) on every other cipher. */
export function supportsKeepTen(id: CipherId): boolean {
  return id === 'en-reduction'
}

/** `namesVariant` applies to the two Milui-derived ciphers only. */
export function supportsNamesVariant(id: CipherId): boolean {
  return id === 'he-milui' || id === 'he-neelam'
}

/**
 * Lineage and provenance the README carries in prose — what the cipher's own
 * one-line `description` does not say. Only the ciphers with a story have one.
 */
export const LINEAGE: Readonly<Partial<Record<CipherId, string>>> = {
  'he-atbash':
    'The cipher scores the substituted word, so value(atbash(x), "he-hechrachi") equals value(x, "he-atbash") — and, since 0.2.0 mirrors over the canonical alphabet, it also equals value(x, "he-hechrachi", true).',
  'he-albam':
    'Albam pairs the two halves of the alphabet (i → i + 11). Like Atbash it is scored Hechrachi after substitution.',
  'he-gadol':
    'The only method where the five finals carry their own hundreds. Under reverse a final mirrors like its base letter, so value("את", "he-gadol", true) is 401.',
  'he-milui':
    'Agrippa II.xix and the torahcalc charts. namesVariant: "plene" spells gimel גימל (83) and pe פה (85) as in Crowley’s Sepher Sephiroth and Godwin’s Cabalistic Encyclopedia — +10 per gimel, +4 per pe.',
  'he-neelam':
    'The “hidden” part of a letter: its Milui minus the letter itself. It follows the same namesVariant switch.',
  'gr-isopsephy':
    'The 27 Milesian numerals, archaic decade letters included (digamma/stigma 6, koppa 90, sampi 900). Reverse therefore pairs α↔ϡ, ζ↔τ, η↔σ … with ν fixed, and σ/ς share a value.',
  'gr-ordinal':
    'Agrippa’s “first manner” of Greek numeration (De Occulta Philosophia II.xviii): the 24 classical letters score their place and the archaic numerals score 0.',
  'ar-abjad':
    'Ḥisāb al-Jummal in the Eastern (Mashriqi) order. A hamza counts as its seat (أ إ آ → ا, ؤ → و, ئ → ي), ة counts as ه and ى as ي, so موسى is 116 — 0.1 gave 106. The Maghribi order is not shipped.',
  'en-ordinal':
    'Kept modern: false for frontend parity, although English-letter gematria is itself a modern convention — Latin never had native alphabetic numerals.',
  'en-reduction':
    'Hubbard’s keepTen rule lets S (ordinal 19) count 10 instead of 1; under reverse the rule falls on H, the mirror of S. “Trump Heights” is 65 plainly and 74 with keepTen.',
  'la-agrippa':
    'De Occulta Philosophia II.xx (1533): A1 … T100, the vowel V = 200, X300 Y400 Z500, then consonantal I = 600, consonantal V = 700, HI = 800 and HV = 900 — in modern letters U200, J600, V700, W900. 0.1 swapped U and V; 0.2.0 follows the printed key.',
  'la-jewish':
    'The same table as la-agrippa under the name gematrix.org and Gematrinator use. Despite “Jewish Gematria” it is an English-letter convention, not Hebrew gematria — for that, value Hebrew text under Hechrachi.',
  'en-naeq':
    'The ALW cipher, discovered by James Lees in November 1976 and derived from Liber AL vel Legis. It is not the cipher of Liber Trigrammaton — that is R. Leo Gillis’s Trigrammaton Qabalah (en-tq).',
  'en-tq': 'R. Leo Gillis (1996) read base-3 values off Liber Trigrammaton; the alphabet ends in &.',
  'en-aq':
    'Ccru / Nick Land’s Alphanumeric Qabbala — base-36 digit values, and the only cipher here that scores the digits 0–9 themselves.',
  'en-english':
    'The ×6 family: the ordinal multiplied by six. “English” and “Sumerian” are two names for one table, popularized by online calculators and unrelated to Sumerian numerals.',
  'en-sumerian':
    'Identical values to en-english. The name is calculator folklore: Sumerian numerals were sexagesimal cuneiform, not alphabetic.',
  'en-chaldean':
    'The traditional 1–8 table, in which 9 is held sacred and never assigned — a modern reconstruction of an older numerological system.',
  'en-keypad': 'The E.161 telephone keypad: ABC = 2 … WXYZ = 9. Wordplay, not a numeral system.',
  'en-cross':
    'Peter Plichta, God’s Secret Formula (1997): the integers on a 24-spoke wheel where every prime > 3 has the form 6n ± 1. The Cross keeps the whole lattice, composites 25, 35, 49, 65 and 77 included.',
  'en-prime-cross':
    'Only the numbers on Plichta’s cross that are actually prime, keeping the central 1. Cross and Prime Cross agree A–H and diverge at I (25 vs 29) — the cross’s own distinction between candidates and primes.',
  'la-elizabethan-simple':
    'The Baconian 24-letter alphabet with I/J = 9 and U/V = 20, so BACON = 33. Manly P. Hall’s “Reverse” cipher is this table mirrored (Z1 … A24).',
  'la-elizabethan-kaye':
    'The Kaye cipher: K10 … Z24, & 25, then A27 … I/J 35. The “et” sign at 26 is not scored.',
  'la-roman':
    'The polemical isopsephy of Andreas Helwig (1612) and Uriah Smith (1866): VICARIVS FILII DEI = 666 — a title that was never an official papal title, and “VICARIUS” with a U gives 661.',
  'cu-cyrillic':
    'Church Slavonic numerals in Greek order; titlo and the thousands sign ҂ carry no value. Anchor from the source: ѰЗ = 707.',
  'hy-numerals': 'Armenian numerals run to 9000 and the later letters օ, ֆ. Anchor: ՌՋՀԵ = 1975.',
  'ka-numerals':
    'Georgian numerals run to 10000; Mtavruli, Asomtavruli and Nuskhuri fold to Mkhedruli. Anchor: ჩყმვ = 1846.',
  'cop-numerals': 'The Greek values on the Coptic letters, with sou ⲋ 6, fai ϥ 90 and sampi ⳁ 900.',
  'syr-numerals': 'The Hebrew values on the 22 Syriac letters; final semkath counts as semkath.',
  'got-numerals': 'Wulfila’s alphabet with its two numeral-only letters. Anchor: •𐌹𐌱• = 12.',
}

export interface SampleText {
  readonly text: string
  readonly script: Script
  /** What the word is — never what its number means. */
  readonly gloss: string
}

/** Sample texts for the calculator; every value shown is computed live. */
export const SAMPLES: readonly SampleText[] = [
  { text: 'gematria', script: 'latin', gloss: 'the word itself, 17 default Latin rows' },
  { text: 'wisdom', script: 'latin', gloss: 'plain English' },
  { text: 'VICARIVS FILII DEI', script: 'latin', gloss: 'Helwig’s Roman-numeral reading' },
  { text: 'אהבה', script: 'hebrew', gloss: 'ahavah — love' },
  { text: 'אחד', script: 'hebrew', gloss: 'echad — One' },
  { text: 'שלום', script: 'hebrew', gloss: 'shalom — peace' },
  { text: 'יהוה', script: 'hebrew', gloss: 'the Tetragrammaton' },
  { text: 'θελημα', script: 'greek', gloss: 'Thelema — Will' },
  { text: 'αγαπη', script: 'greek', gloss: 'Agape — Love' },
  { text: 'χξϛ', script: 'greek', gloss: 'Revelation 13:18, chi-xi-stigma' },
  { text: 'موسى', script: 'arabic', gloss: 'Mūsā — Moses' },
  { text: 'ѰЗ', script: 'cyrillic', gloss: 'a Church Slavonic numeral' },
  { text: 'ՌՋՀԵ', script: 'armenian', gloss: 'an Armenian numeral' },
  { text: 'ჩყმვ', script: 'georgian', gloss: 'a Georgian numeral' },
  { text: 'ⲁⲅⲁⲡⲏ', script: 'coptic', gloss: 'agape in Coptic letters' },
  { text: 'ܡܫܝܚܐ', script: 'syriac', gloss: 'mshiḥa — Messiah' },
  { text: '𐌹𐌱', script: 'gothic', gloss: 'a Gothic numeral' },
]

/** Human label for a cipher id (throws only for an unknown id). */
export function cipherLabel(id: CipherId): string {
  return getCipher(id).label
}
