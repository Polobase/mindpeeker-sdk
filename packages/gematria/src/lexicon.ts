/**
 * The `@mindpeeker/gematria/lexicon` subpath — a curated, value-indexed Hebrew
 * + Greek + English reference dictionary, so `lookup(N)` / `matches` /
 * `castByValue` work out of the box instead of requiring a caller-supplied
 * corpus. It is a secondary entry point (kept off the lean, zero-data `.` root,
 * mirroring how `@mindpeeker/negentropy/numerics` is split out).
 *
 * **Edition.** The Hebrew core is transcribed from *Sepher Sephiroth sub figurâ
 * D* by Aleister Crowley & Allan Bennett, published as a special supplement to
 * *The Equinox* vol. I no. 8 (September 1912) — the canonical value-indexed
 * dictionary of Qabalistic gematria. Crowley's ASCII transliteration is read
 * with the key A א, B ב, G ג, D ד, H ה, V ו, Z ז, Ch ח, T ט, Y י, K כ, L ל,
 * M מ, N נ, S ס, a'a ע, P פ, Tz צ, Q ק, R ר, Sh ש, Th ת (so T is teth and Th is
 * tav). Further rows come from Mathers' *The Kabbalah Unveiled* (1887),
 * Stirling's *The Canon* (1897, Greek) and Agrippa's planetary spirits
 * (*De Occulta Philosophia* II.xxii); each entry names its `source`. Nothing is
 * scraped from a live calculator.
 *
 * **Licensing.** All sources are in the public domain: Crowley died in 1947
 * (life + 70 years expired in 2018) and the 1912 publication predates 1929 (US
 * public domain), Bennett died in 1923, Mathers in 1918, Stirling in 1900; the
 * modern editorial notes interleaved in circulating e-texts are excluded. Glosses
 * are short identifications written for this package.
 *
 * **Honest framing** (see the README): this is a *curated historical reference*,
 * deliberately small and not exhaustive. Every stored `value` is recomputed from
 * the package's own cipher in the test suite and asserted equal, so no wrong
 * number ships (Crowley's Hebrew Babalon is באבאלען, BABALa'aN = 156; Stirling's
 * printed ΟΚΤΩ = 1,100 is a misprint for 1190). Equal-value "matches" always
 * carry their `commonness`, because an equal total is a cheap coincidence, not
 * a hidden message.
 *
 * **Registration.** Importing this module registers {@link SEPHER_SEPHIROTH}
 * (with each entry's declared script) as the default lexicon, enabling the bare
 * `lookup(N, cipher)` / `matches(text, cipher)` overloads; the package's
 * `sideEffects` field keeps that import in bundles. {@link defaultLexicon} is
 * the explicit path and registers again.
 */

import { GREEK_ROWS } from './lexicon-data/greek.js'
import { HEBREW_ROWS } from './lexicon-data/hebrew.js'
import type { LexiconRow, LexiconSource } from './lexicon-data/rows.js'
import { admissibleWords, useDefaultLexicon } from './lexicon-registry.js'
import type { CipherId, CipherRef, LexiconWord, Script } from './types.js'

export type { LexiconSource } from './lexicon-data/rows.js'

/** One value-indexed dictionary entry. */
export interface LexiconEntry extends LexiconWord {
  /** The word, as written (accents/finals are handled by normalization). */
  readonly word: string
  /** Which script it belongs to — selects the recompute cipher. */
  readonly script: Script
  /** Its gematria value under {@link SCRIPT_CIPHER} for its script. */
  readonly value: number
  /** A short gloss / translation. */
  readonly gloss: string
  /** Where the entry was taken from. See {@link LexiconSource}. */
  readonly source: LexiconSource
  /** An optional note on significance. */
  readonly note?: string
}

/**
 * The canonical cipher used to compute (and recompute-verify) each script's
 * stored values: Hebrew → Hechrachi, Greek → isopsephy, Latin → Ordinal,
 * Arabic → Abjad, and each numeral script → its numeral cipher.
 */
export const SCRIPT_CIPHER: Readonly<Record<Script, CipherId>> = Object.freeze({
  hebrew: 'he-hechrachi',
  greek: 'gr-isopsephy',
  latin: 'en-ordinal',
  arabic: 'ar-abjad',
  cyrillic: 'cu-cyrillic',
  armenian: 'hy-numerals',
  georgian: 'ka-numerals',
  coptic: 'cop-numerals',
  syriac: 'syr-numerals',
  gothic: 'got-numerals',
})

const LATIN_ROWS: readonly LexiconRow[] = [
  ['Babalon', 47, 'Babalon (English ordinal)', 'curated'],
  ['Abrahadabra', 57, 'Abrahadabra (English ordinal)', 'curated'],
  ['Thelema', 64, 'Thelema — Will (English ordinal)', 'curated'],
]

function entries(script: Script, rows: readonly LexiconRow[]): LexiconEntry[] {
  return rows.map(([word, value, gloss, source, note]) =>
    Object.freeze({ word, script, value, gloss, source, ...(note !== undefined ? { note } : {}) }),
  )
}

/**
 * The curated entries — Hebrew, then Greek, then English/Latin, each ascending
 * by value. Deeply frozen. Every `value` is recomputed by
 * `value(word, SCRIPT_CIPHER[script])` in the test suite and asserted equal.
 */
export const SEPHER_SEPHIROTH: readonly LexiconEntry[] = Object.freeze([
  ...entries('hebrew', HEBREW_ROWS),
  ...entries('greek', GREEK_ROWS),
  ...entries('latin', LATIN_ROWS),
])

/**
 * Famous gematria numbers and short notes — the values worth recognizing on
 * sight in the Qabalistic literature.
 */
export const FAMOUS_NUMBERS: Readonly<Record<number, string>> = Object.freeze({
  31: 'The Key of 31 — LA (לא, "not") and AL (אל, "God"): negation and affirmation.',
  93: 'Θελημα (Thelema, Will) = Αγαπη (Agape, Love) = 93 — the number of the Law.',
  111: 'Aleph spelled in full (אלף = ox / thousand) = 111; also unity written thrice.',
  156: "Babalon — Greek ΒΑΒΑΛΟΝ = Crowley's Hebrew באבאלען = 156; the Scarlet Woman of the Aeon.",
  418: 'ABRAHADABRA (אבראהאדאברא) = 418 — the Great Work accomplished, the Word of the Aeon.',
  666: 'χξϛ — the number of the beast (Rev 13:18); the 36th triangular number; סורת (Sorath), spirit of the Sun.',
  777: 'The Tree of Life mapped by Crowley in Liber 777; the Flaming Sword.',
  888: 'Ἰησοῦς (Iesous, Jesus) = 888 in Greek isopsephy.',
})

const WORDS: readonly string[] = Object.freeze(SEPHER_SEPHIROTH.map((e) => e.word))

/**
 * The bundled corpus as a flat word list, ready to pass to `lookup` / `matches`
 * / `castByValue` — all words, or with `cipher` only those admissible under it
 * (e.g. the Hebrew words for `he-hechrachi`). Calling it also registers
 * {@link SEPHER_SEPHIROTH} as the default lexicon, so the bare
 * `lookup(N, cipher)` overloads resolve against it.
 *
 * @throws GematriaError `'unknown_cipher'` if `cipher` is unknown
 */
export function defaultLexicon(cipher?: CipherRef): readonly string[] {
  useDefaultLexicon(SEPHER_SEPHIROTH)
  return cipher === undefined ? WORDS : admissibleWords(SEPHER_SEPHIROTH, cipher)
}

// Register on import too, so `import '@mindpeeker/gematria/lexicon'` enables the
// bare overloads even before defaultLexicon() is called (package.json lists this
// module in `sideEffects`, so bundlers keep the import).
useDefaultLexicon(SEPHER_SEPHIROTH)
