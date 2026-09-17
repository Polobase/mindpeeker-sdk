/**
 * Shared types for @mindpeeker/gematria.
 *
 * A *cipher* is a total map from the letters of one script to non-negative
 * integers (letters outside its alphabet score 0); a word's *value* is the sum of its letters' values. All of it is
 * exact integer arithmetic — the computation is deterministic and never
 * consumes entropy. See the README for why the *interpretation* of equal
 * values is a contested hermeneutic tradition rather than a scientific claim.
 */

/**
 * The scripts this package computes over. Detection and normalization are
 * per script (see `detectScript` / `normalizeFor`); every script has at least
 * one cipher in `CIPHERS_BY_SCRIPT`.
 */
export type Script =
  | 'hebrew'
  | 'greek'
  | 'latin'
  | 'arabic'
  | 'cyrillic'
  | 'armenian'
  | 'georgian'
  | 'coptic'
  | 'syriac'
  | 'gothic'

/**
 * Stable machine ids for every supported cipher. The nine frontend ids
 * (`he-hechrachi`, `he-gadol`, `he-siduri`, `he-katan`, `he-atbash`, `he-albam`,
 * `gr-isopsephy`, `en-ordinal`, `en-reduction`) match the mindpeeker frontend
 * engine (`server/utils/gematria.ts`) — identical ids, labels and values — so
 * `profile()` is a drop-in replacement. The rest are SDK additions: the extended
 * Hebrew Misparim, the Greek ordinal, the Arabic Abjad and the alphabetic
 * numeral ciphers of Cyrillic, Armenian, Georgian, Coptic, Syriac and Gothic,
 * the historical Latin tables (Agrippa, Elizabethan, Roman), the Thelemic
 * NAEQ/TQ, and the modern calculator ciphers (see {@link Cipher.modern}).
 * No id is a *reverse* cipher: reverse is a parameter (`value(text, cipher,
 * true)`), so every cipher here mirrors on demand.
 */
export type CipherId =
  | 'he-hechrachi'
  | 'he-gadol'
  | 'he-siduri'
  | 'he-katan'
  | 'he-atbash'
  | 'he-albam'
  | 'he-milui'
  | 'he-kidmi'
  | 'he-perati'
  | 'he-neelam'
  | 'he-katan-mispari'
  | 'gr-isopsephy'
  | 'gr-ordinal'
  | 'ar-abjad'
  | 'en-ordinal'
  | 'en-reduction'
  | 'la-agrippa'
  | 'la-jewish'
  | 'en-naeq'
  | 'en-english'
  | 'en-sumerian'
  // The gematriaq.com-parity modern calculator ciphers (all `modern: true`).
  | 'en-standard'
  | 'en-satanic'
  | 'en-primes'
  | 'en-squares'
  | 'en-trigonal'
  | 'en-fibonacci'
  | 'en-chaldean'
  | 'en-septenary'
  | 'en-keypad'
  // Peter Plichta's Prime Number Cross (numbers of the form 6n±1): the full
  // cross lattice (composites kept) and the primes-only Prime Cross.
  | 'en-cross'
  | 'en-prime-cross'
  // SDK-added Latin tables (all `extended: true`).
  | 'en-tq'
  | 'en-aq'
  | 'la-elizabethan-simple'
  | 'la-elizabethan-kaye'
  | 'la-roman'
  // Alphabetic numeral ciphers of further scripts.
  | 'cu-cyrillic'
  | 'hy-numerals'
  | 'ka-numerals'
  | 'cop-numerals'
  | 'syr-numerals'
  | 'got-numerals'

/**
 * Friendly names accepted anywhere a cipher is chosen, matching the labels
 * popular online calculators use (gematrinator.com, gematrix.org). See
 * {@link resolveCipherId} for the mapping to a canonical {@link CipherId}.
 */
export type CipherAlias =
  | 'jewish'
  | 'hebrew'
  | 'latin'
  | 'english'
  | 'simple'
  | 'ordinal'
  | 'sumerian'
  | 'isopsephy'

/** Anywhere a cipher is chosen: a canonical id or a friendly alias. */
export type CipherRef = CipherId | CipherAlias

/** One entry of a cipher's frozen glyph→value table. */
export interface LetterValue {
  readonly char: string
  readonly value: number
}

/**
 * A single named cipher — its metadata, canonical alphabet, glyph fold,
 * per-letter function and full table.
 *
 * **Alphabet and fold.** Every cipher separates its *canonical alphabet* (one
 * glyph per letter position, in the script's traditional order) from the
 * *glyphs* it accepts: `fold(ch)` maps a final form, a numeral variant, a case
 * variant or a script variant to the canonical letter (ם→מ, ς→σ, ϛ→ϝ, Є→е,
 * Nuskhuri ⴀ→ა, …). Reverse is defined over the alphabet: with
 * $n = |	ext{alphabet}|$ and $i$ the index of `fold(ch)`, the reversed value of
 * `ch` is the forward value of `alphabet[n − 1 − i]`. So glyph variants always
 * share a reversed value, and reversing twice returns the forward cipher.
 */
export interface Cipher {
  readonly id: CipherId
  /** Human-readable label (matches the frontend for the nine frontend ids). */
  readonly label: string
  /** A one-line description of the cipher — its rule, origin and honest framing. */
  readonly description: string
  readonly script: Script
  /**
   * `true` iff this is a 20th–21st-century calculator or wordplay invention
   * with no historical pedigree: the ×6 "English"/"Sumerian" ciphers, the
   * gematriaq.com-parity set, Plichta's crosses and the Alphanumeric Qabbala.
   * `en-ordinal`/`en-reduction` stay `false` for frontend parity, and the
   * Thelemic NAEQ/TQ are documented published systems (see the README).
   */
  readonly modern: boolean
  /**
   * `true` iff this is an SDK-added *extended* method beyond the frontend-parity
   * set of its script (the deeper Hebrew Misparim, the Greek ordinal, NAEQ/TQ/AQ
   * and the Elizabethan/Roman Latin tables). {@link GematriaProfile} omits these
   * by default so `profile()` stays a row-for-row drop-in for the frontend
   * engine; pass `includeExtended: true` to add them. The sole cipher of a
   * script (e.g. `ar-abjad`, `cu-cyrillic`) is never extended.
   */
  readonly extended: boolean
  /**
   * The canonical letters in traditional order — the domain of reverse. Every
   * glyph in {@link table} folds to one of these.
   */
  readonly alphabet: readonly string[]
  /**
   * Map one *normalized* character to its canonical alphabet letter (finals,
   * numeral variants, case and script variants fold; anything else is returned
   * lowercased or unchanged). Idempotent: `fold(fold(ch)) === fold(ch)`.
   */
  readonly fold: (char: string) => string
  /** Forward value of a single normalized character; `0` if it is not a letter. */
  readonly letterValue: (char: string) => number
  /**
   * Optional word-level transform applied to the summed total *after* every
   * letter has been added — e.g. Mispar Katan Mispari reduces the whole word's
   * total to its digital root rather than reducing per letter. Absent for the
   * ordinary additive ciphers.
   */
  readonly postSum?: (sum: number) => number
  /**
   * The complete, deeply frozen glyph→value table: every value-bearing glyph
   * the cipher lists (canonical letters plus distinct variant rows such as ς,
   * the Gadol finals or Elizabethan J/V), each with a positive value.
   */
  readonly table: readonly LetterValue[]
}

/**
 * Letter-name spelling convention for the Milui family (`he-milui`,
 * `he-neelam`, `milui()`):
 *
 * - `'standard'` (default, frontend parity) — gimel גמל = 73, pe פא = 81.
 * - `'plene'` — gimel גימל = 83 and pe פה = 85, the spellings of the Golden
 *   Dawn / Crowley tradition (*Sepher Sephiroth* lists the letter Pe as PH = 85
 *   and gimel as GYML = 83) and of Godwin's *Cabalistic Encyclopedia*.
 *
 * Every other letter name is identical in both conventions.
 */
export type NamesVariant = 'standard' | 'plene'

/**
 * Options shared by `value`, `analyze` and `letterValues`. Each option is
 * validated at the boundary: a non-boolean `reverse`/`keepTen` or an unknown
 * `namesVariant` throws `GematriaError('invalid_input')`, as does a
 * cipher-specific option on a cipher it does not apply to.
 */
export interface ValueOptions {
  /** Score the cipher's mirror over its canonical alphabet. Default `false`. */
  readonly reverse?: boolean
  /**
   * `en-reduction` only — Hubbard's "S or H may count 10" rule: the letter whose
   * ordinal is 19 (S; under reverse the mirror of S, i.e. H) scores 10 instead
   * of its digital root 1. Default `false`.
   */
  readonly keepTen?: boolean
  /**
   * `he-milui` / `he-neelam` only — the letter-name spelling convention. Default
   * `'standard'`. See {@link NamesVariant}.
   */
  readonly namesVariant?: NamesVariant
}

/** One cipher's value in a multi-cipher profile — the frontend result row. */
export interface CipherValue {
  readonly cipher: CipherId
  readonly label: string
  readonly value: number
  /** Digital root of `value` (its repeated digit sum). */
  readonly reduced: number
}

/** A single letter's contribution inside an {@link analyze} breakdown. */
export interface LetterBreakdown {
  readonly char: string
  readonly value: number
}

/** The result of `analyze(text, cipher)` — one cipher over one word. */
export interface GematriaResult {
  readonly text: string
  readonly cipher: CipherId
  readonly script: Script
  readonly value: number
  /** Digital root of `value`. */
  readonly reduced: number
  readonly byLetter: readonly LetterBreakdown[]
  /**
   * The number-lore portrait of `value` — present only when
   * {@link AnalyzeOptions.numberProperties} is set. See {@link NumberProperties}.
   */
  readonly numbers?: NumberProperties
}

/** Options for `analyze`: the {@link ValueOptions} plus a number-lore switch. */
export interface AnalyzeOptions extends ValueOptions {
  /** Attach a {@link NumberProperties} portrait of the total. Default `false`. */
  readonly numberProperties?: boolean
}

/** One prime power in a {@link NumberProperties.factorization}. */
export interface PrimeFactor {
  readonly prime: number
  readonly exponent: number
}

/**
 * A pure-arithmetic portrait of an integer in $[0, 2^{48}]$ — the number-lore a
 * gematria value carries independent of any word. Every field is exact; the
 * *meaning* attached to, say, 666 being the 36th triangular number is
 * tradition, not mathematics (see the README's honest-framing section).
 */
export interface NumberProperties {
  /** The integer itself. */
  readonly value: number
  /** Sum of its decimal digits (a single pass, not reduced to one digit). */
  readonly digitSum: number
  /** Its digital root — the repeated digit sum. */
  readonly digitalRoot: number
  readonly isPrime: boolean
  /** Prime factorization as ascending prime powers; empty for 0 and 1. */
  readonly factorization: readonly PrimeFactor[]
  /** Whether it is a triangular number $k(k+1)/2$. */
  readonly isTriangular: boolean
  /** The triangular index $k$, present only when {@link isTriangular}. */
  readonly triangularIndex?: number
  /** Whether it is a perfect square. */
  readonly isSquare: boolean
  /** Whether it equals the sum of its proper divisors (6, 28, 496, …). */
  readonly isPerfect: boolean
}

/** One letter's per-cipher values inside a {@link GematriaProfile}. */
export interface ProfileLetter {
  readonly char: string
  /** Value of this single letter under each applicable cipher, keyed by id. */
  readonly values: Readonly<Partial<Record<CipherId, number>>>
}

/**
 * The result of `profile(text)` — every cipher applicable to the detected
 * script. A superset of the frontend `GematriaResult`: `text`, `script`, and
 * a `values` row `{cipher,label,value,reduced}` per cipher, plus the extra
 * `byLetter` breakdown.
 */
export interface GematriaProfile {
  readonly text: string
  readonly script: Script
  readonly values: readonly CipherValue[]
  readonly byLetter: readonly ProfileLetter[]
}

/** Options for {@link profile}. */
export interface ProfileOptions {
  /** Force a script instead of auto-detecting from Unicode ranges. */
  script?: Script
  /**
   * Include the `modern: true` calculator/wordplay ciphers (the ×6 family, the
   * gematriaq.com-parity set and Plichta's crosses; Latin only). Default `true`.
   */
  includeModern?: boolean
  /**
   * Include the SDK-added *extended* methods (the deeper Hebrew Misparim, the
   * Greek ordinal, NAEQ/TQ/AQ and the Elizabethan/Roman tables). Default `false`, so a profile stays a row-for-row match
   * for the frontend engine. See {@link Cipher.extended}.
   */
  includeExtended?: boolean
}

/** Options for {@link notariqon}. */
export interface NotariqonOptions {
  /** Take the first or the last letter of each word. Default `'first'`. */
  mode?: 'first' | 'last'
}

/** Options for `acronym` (Notariqon contraction). */
export interface AcronymOptions {
  /**
   * Take the first (roshei teivot), last (sofei teivot) or middle (emtsaei
   * teivot) letter of each word. Default `'first'`.
   */
  from?: 'first' | 'last' | 'medial'
}

/**
 * The colel/tolerance knob for `matches` / `lookup` / `equalValue`. *Colel*
 * (כולל) is the traditional rule that a difference of one still counts — the
 * word plus one for the word itself. `tolerance` generalizes it to any
 * non-negative integer window; `colel: true` is exactly `tolerance: 1`.
 */
export interface MatchOptions {
  /** Traditional ±1 colel tolerance. Ignored when `tolerance` is given. */
  readonly colel?: boolean
  /** Explicit ±n window; must be a non-negative safe integer. */
  readonly tolerance?: number
}

/**
 * One word of a lexicon passed as an object: the word and, optionally, the
 * script it is written in. A declared `script` is authoritative; without one the
 * script is detected with `detectScript(word)`. The bundled `LexiconEntry` rows
 * of `@mindpeeker/gematria/lexicon` are `LexiconWord`s.
 */
export interface LexiconWord {
  readonly word: string
  readonly script?: Script
}

/**
 * A lexicon: plain words and/or {@link LexiconWord} objects. Wherever a lexicon
 * is scored under a cipher (`matches`, `lookup`, the commonness statistics and
 * the `./oracle` draws) only its *admissible* words count: those written in the
 * cipher's script that contain at least one letter the cipher scores. Duplicate
 * words count once per occurrence.
 */
export type Lexicon = readonly (string | LexiconWord)[]

/** The result of an equal-value {@link matches} search over a lexicon. */
export interface MatchResult {
  /** The query text's value under the chosen cipher. */
  readonly value: number
  /**
   * Every admissible lexicon word within {@link tolerance} of `value` (lexicon
   * order preserved). With the default zero tolerance this is exactly the
   * equal-value set and equals {@link exact}.
   */
  readonly matches: readonly string[]
  /**
   * The subset of {@link matches} whose value is *exactly* `value` — the flag
   * that separates a true equality from a within-colel near-miss.
   */
  readonly exact: readonly string[]
  /** The ±window actually applied (0 unless colel/tolerance was requested). */
  readonly tolerance: number
  /**
   * Fraction of the admissible lexicon within tolerance of this value, in
   * $[0, 1]$ (`matches.length / lexiconSize`, 0 for an empty denominator).
   * Equal-value coincidences are statistically cheap — this number is the
   * honesty knob: a high commonness means the "match" is unremarkable.
   */
  readonly commonness: number
  /**
   * The commonness denominator: how many lexicon words are admissible under the
   * cipher (written in its script, with at least one scoring letter).
   */
  readonly lexiconSize: number
}
