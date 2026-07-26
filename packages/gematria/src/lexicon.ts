/**
 * The `@mindpeeker/gematria/lexicon` subpath — a curated, value-indexed Hebrew
 * + Greek + English reference dictionary, so `lookup(N)` / `matches` /
 * `castByValue` work OUT OF THE BOX instead of requiring a caller-supplied
 * corpus. It is a secondary entry point (kept off the lean, zero-data `.` root,
 * mirroring how `@mindpeeker/negentropy/numerics` is split out).
 *
 * The entries are hand-compiled from the **public-domain Sepher Sephiroth**
 * (Aleister Crowley & Allan Bennett, *The Equinox* I(8) / *Liber 500*, 1909) —
 * the canonical value-indexed dictionary of Qabalistic gematria — NOT scraped
 * from any live calculator. Honest framing (see the README): this is a *curated
 * historical reference*, deliberately small and not exhaustive; every stored
 * `value` is recomputed from the package's own cipher in the test suite and
 * asserted equal, so no wrong number ships; and equal-value "matches" always
 * carry their `commonness`, because an equal total is a cheap coincidence, not
 * a hidden message.
 *
 * Importing this module registers its words as the default lexicon (see
 * {@link useDefaultLexicon}), enabling the bare `lookup(N, cipher)` /
 * `matches(text, cipher)` overloads.
 *
 * Sources: Crowley/Bennett, *Sepher Sephiroth* (Equinox I(8), Liber 500); the
 * Key of 31 (LA/AL), 93 (Θελημα/Αγαπη), 111 (אלף), 156 (Babalon), 418
 * (Abrahadabra), 666, 777, 888 (Ἰησοῦς) from the Thelemic literature.
 */

import { useDefaultLexicon } from './match.js'
import type { CipherId, Script } from './types.js'

/** One value-indexed dictionary entry. */
export interface LexiconEntry {
  /** The word, as written (accents/finals are handled by normalization). */
  readonly word: string
  /** Which script it belongs to — selects the recompute cipher. */
  readonly script: Script
  /** Its gematria value under {@link SCRIPT_CIPHER} for its script. */
  readonly value: number
  /** A short gloss / translation. */
  readonly gloss: string
  /** An optional note on significance. */
  readonly note?: string
}

/**
 * The canonical cipher used to compute (and recompute-verify) each script's
 * stored values: Hebrew → Hechrachi, Greek → isopsephy, Latin → Ordinal,
 * Arabic → Abjad.
 */
export const SCRIPT_CIPHER: Readonly<Record<Script, CipherId>> = Object.freeze({
  hebrew: 'he-hechrachi',
  greek: 'gr-isopsephy',
  latin: 'en-ordinal',
  arabic: 'ar-abjad',
})

/**
 * The curated Sepher Sephiroth entries. Every `value` is recomputed by
 * `value(word, SCRIPT_CIPHER[script])` in the test suite and asserted equal.
 */
export const SEPHER_SEPHIROTH: readonly LexiconEntry[] = Object.freeze([
  // — Hebrew (Mispar Hechrachi) —
  Object.freeze({
    word: 'אל',
    script: 'hebrew',
    value: 31,
    gloss: 'El — God',
    note: 'the Key of 31 (with לא/AL)',
  }),
  Object.freeze({
    word: 'לא',
    script: 'hebrew',
    value: 31,
    gloss: 'lo — not',
    note: 'the Key of 31 (LA/AL)',
  }),
  Object.freeze({
    word: 'לב',
    script: 'hebrew',
    value: 32,
    gloss: 'lev — heart',
    note: '32 paths of wisdom',
  }),
  Object.freeze({ word: 'אחד', script: 'hebrew', value: 13, gloss: 'echad — One / Unity' }),
  Object.freeze({
    word: 'אהבה',
    script: 'hebrew',
    value: 13,
    gloss: 'ahavah — love',
    note: 'echad = ahavah = 13',
  }),
  Object.freeze({ word: 'חי', script: 'hebrew', value: 18, gloss: 'chai — life' }),
  Object.freeze({ word: 'יהוה', script: 'hebrew', value: 26, gloss: 'YHVH — the Tetragrammaton' }),
  Object.freeze({
    word: 'אין',
    script: 'hebrew',
    value: 61,
    gloss: 'Ain — Nothing / the Negative',
  }),
  Object.freeze({ word: 'אדני', script: 'hebrew', value: 65, gloss: 'Adonai — Lord' }),
  Object.freeze({
    word: 'חכמה',
    script: 'hebrew',
    value: 73,
    gloss: 'Chokmah — Wisdom (2nd Sephirah)',
  }),
  Object.freeze({ word: 'אלהים', script: 'hebrew', value: 86, gloss: 'Elohim — God (plural)' }),
  Object.freeze({
    word: 'בבלון',
    script: 'hebrew',
    value: 90,
    gloss: 'Babalon (Hebrew form)',
    note: 'cf. Greek ΒΑΒΑΛΟΝ = 156',
  }),
  Object.freeze({
    word: 'אלף',
    script: 'hebrew',
    value: 111,
    gloss: 'aleph spelled in full — ox / thousand',
    note: '111',
  }),
  Object.freeze({ word: 'רוח', script: 'hebrew', value: 214, gloss: 'ruach — spirit / breath' }),
  Object.freeze({ word: 'אור', script: 'hebrew', value: 207, gloss: 'or — light' }),
  Object.freeze({ word: 'משיח', script: 'hebrew', value: 358, gloss: 'Mashiach — Messiah' }),
  Object.freeze({
    word: 'נחש',
    script: 'hebrew',
    value: 358,
    gloss: 'nachash — serpent',
    note: 'nachash = Mashiach = 358',
  }),
  Object.freeze({ word: 'שלום', script: 'hebrew', value: 376, gloss: 'shalom — peace' }),
  Object.freeze({
    word: 'אבראהאדאברא',
    script: 'hebrew',
    value: 418,
    gloss: 'ABRAHADABRA',
    note: 'the Word of the Aeon; 418',
  }),
  Object.freeze({ word: 'אמת', script: 'hebrew', value: 441, gloss: 'emeth — truth' }),
  Object.freeze({ word: 'תורה', script: 'hebrew', value: 611, gloss: 'Torah — the Law' }),
  Object.freeze({
    word: 'כתר',
    script: 'hebrew',
    value: 620,
    gloss: 'Kether — Crown (1st Sephirah)',
  }),

  // — Greek (Milesian isopsephy) —
  Object.freeze({ word: 'Αμην', script: 'greek', value: 99, gloss: 'Amen' }),
  Object.freeze({
    word: 'Αγαπη',
    script: 'greek',
    value: 93,
    gloss: 'Agape — Love',
    note: 'Agape = Thelema = 93',
  }),
  Object.freeze({ word: 'Θελημα', script: 'greek', value: 93, gloss: 'Thelema — Will' }),
  Object.freeze({ word: 'Βαβαλον', script: 'greek', value: 156, gloss: 'Babalon', note: '156' }),
  Object.freeze({ word: 'Ερμης', script: 'greek', value: 353, gloss: 'Hermes' }),
  Object.freeze({
    word: 'Αβραξας',
    script: 'greek',
    value: 365,
    gloss: 'Abraxas',
    note: '365, days of the year',
  }),
  Object.freeze({ word: 'Λογος', script: 'greek', value: 373, gloss: 'Logos — the Word' }),
  Object.freeze({ word: 'Μητηρ', script: 'greek', value: 456, gloss: 'Meter — Mother' }),
  Object.freeze({ word: 'Σοφια', script: 'greek', value: 781, gloss: 'Sophia — Wisdom' }),
  Object.freeze({
    word: 'Ιησους',
    script: 'greek',
    value: 888,
    gloss: 'Iesous — Jesus',
    note: '888',
  }),
  Object.freeze({
    word: 'Χριστος',
    script: 'greek',
    value: 1480,
    gloss: 'Christos — the Anointed',
  }),

  // — English / Latin (Ordinal) —
  Object.freeze({
    word: 'Babalon',
    script: 'latin',
    value: 47,
    gloss: 'Babalon (English ordinal)',
  }),
  Object.freeze({
    word: 'Thelema',
    script: 'latin',
    value: 64,
    gloss: 'Thelema — Will (English ordinal)',
  }),
  Object.freeze({
    word: 'Abrahadabra',
    script: 'latin',
    value: 57,
    gloss: 'Abrahadabra (English ordinal)',
  }),
])

/**
 * Famous gematria numbers and short notes — the values worth recognizing on
 * sight in the Qabalistic literature.
 */
export const FAMOUS_NUMBERS: Readonly<Record<number, string>> = Object.freeze({
  31: 'The Key of 31 — LA (לא, "not") and AL (אל, "God"): negation and affirmation.',
  93: 'Θελημα (Thelema, Will) = Αγαπη (Agape, Love) = 93 — the number of the Law.',
  111: 'Aleph spelled in full (אלף = ox / thousand) = 111; also unity written thrice.',
  156: 'Babalon — Greek ΒΑΒΑΛΟΝ = 156; the Scarlet Woman of the Aeon.',
  418: 'ABRAHADABRA (אבראהאדאברא) = 418 — the Great Work accomplished, the Word of the Aeon.',
  666: 'χξϛ — the number of the beast (Rev 13:18); the 36th triangular number.',
  777: 'The Tree of Life mapped by Crowley in Liber 777; the Flaming Sword.',
  888: 'Ἰησοῦς (Iesous, Jesus) = 888 in Greek isopsephy.',
})

const WORDS: readonly string[] = Object.freeze(SEPHER_SEPHIROTH.map((e) => e.word))

/**
 * The bundled corpus as a flat word list, ready to pass to `lookup` / `matches`
 * / `castByValue`. Calling it also registers it as the default lexicon, so the
 * bare `lookup(N, cipher)` overloads resolve against it.
 */
export function defaultLexicon(): readonly string[] {
  useDefaultLexicon(WORDS)
  return WORDS
}

// Register on import too, so `import '.../lexicon'` enables the bare overloads
// even before defaultLexicon() is called explicitly.
useDefaultLexicon(WORDS)
