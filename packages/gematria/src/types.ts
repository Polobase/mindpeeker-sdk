/**
 * Shared types for @mindpeeker/gematria.
 *
 * A *cipher* is a total map from the letters of one script to non-negative
 * integers; a word's *value* is the sum of its letters' values. All of it is
 * exact integer arithmetic — the computation is deterministic and never
 * consumes entropy. See the README for why the *interpretation* of equal
 * values is a contested hermeneutic tradition rather than a scientific claim.
 */

/** The scripts this package computes over. */
export type Script = 'hebrew' | 'greek' | 'latin' | 'arabic'

/**
 * Stable machine ids for every supported cipher. The first ten are a superset
 * of the mindpeeker frontend engine (`server/utils/gematria.ts`) — identical
 * ids, labels and values — so `profile()` is a drop-in replacement. The rest
 * are SDK additions: Agrippa's reconstructed Latin table, the Thelemic NAEQ,
 * and the modern calculator ciphers — the ×6 "English/Sumerian" wordplay, the
 * gematriaq.com-parity set (Standard, Primes, Squares, Fibonacci, Chaldean,
 * Keypad, …), and Peter Plichta's Prime Number Cross (see {@link Cipher.modern}).
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
  | 'ar-abjad'
  | 'en-ordinal'
  | 'en-reduction'
  | 'en-reverse'
  | 'la-agrippa'
  | 'la-jewish'
  | 'en-naeq'
  | 'en-english'
  | 'en-sumerian'
  | 'en-english-reverse'
  | 'en-sumerian-reverse'
  // The gematriaq.com-parity modern calculator ciphers (all `modern: true`).
  | 'en-standard'
  | 'en-reverse-reduction'
  | 'en-satanic'
  | 'en-reverse-satanic'
  | 'en-primes'
  | 'en-reverse-primes'
  | 'en-squares'
  | 'en-reverse-squares'
  | 'en-trigonal'
  | 'en-reverse-trigonal'
  | 'en-fibonacci'
  | 'en-chaldean'
  | 'en-septenary'
  | 'en-keypad'
  // Peter Plichta's Prime Number Cross (numbers of the form 6n±1): the full
  // cross and its primes-only subset, each with a reverse.
  | 'en-prime-cross'
  | 'en-reverse-prime-cross'
  | 'en-prime-cross-primes'
  | 'en-reverse-prime-cross-primes'

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
  | 'reverse'
  | 'sumerian'
  | 'isopsephy'

/** Anywhere a cipher is chosen: a canonical id or a friendly alias. */
export type CipherRef = CipherId | CipherAlias

/** One entry of a cipher's frozen alphabet→value table. */
export interface LetterValue {
  readonly char: string
  readonly value: number
}

/** A single named cipher — its metadata, per-letter function and full table. */
export interface Cipher {
  readonly id: CipherId
  /** Human-readable label (matches the frontend for the shared ten). */
  readonly label: string
  /**
   * A one-line description of the cipher — its rule, origin, and honest framing.
   * Optional: the frontend-parity Hebrew/Greek/Arabic and historical Latin
   * ciphers omit it, while the modern calculator ciphers supply it.
   */
  readonly description?: string
  readonly script: Script
  /**
   * `true` iff this is a 20th–21st-century invention with no historical
   * pedigree — the ×6 "English"/"Sumerian" online-calculator ciphers. Latin
   * has no native numerals, so these are wordplay, not ancient gematria.
   */
  readonly modern: boolean
  /**
   * `true` iff this is an SDK-added *extended* method beyond the original
   * frontend-parity set (the deeper Hebrew Miluim/Kidmi/Perati/Neelam/Katan
   * Mispari and the Thelemic NAEQ). {@link GematriaProfile} omits these by
   * default so `profile()` stays a row-for-row drop-in for the frontend
   * engine; pass `includeExtended: true` to add them.
   */
  readonly extended?: boolean
  /** Value of a single normalized character; `0` if it is not a letter. */
  readonly letterValue: (char: string) => number
  /**
   * Optional word-level transform applied to the summed total *after* every
   * letter has been added — e.g. Mispar Katan Mispari reduces the whole word's
   * total to its digital root rather than reducing per letter. Absent for the
   * ordinary additive ciphers.
   */
  readonly postSum?: (sum: number) => number
  /** The complete, deeply frozen alphabet→value table for this cipher. */
  readonly table: readonly LetterValue[]
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

/** Options for `analyze`. */
export interface AnalyzeOptions {
  /** Attach a {@link NumberProperties} portrait of the total. Default `false`. */
  numberProperties?: boolean
}

/** One prime power in a {@link NumberProperties.factorization}. */
export interface PrimeFactor {
  readonly prime: number
  readonly exponent: number
}

/**
 * A pure-arithmetic portrait of a non-negative integer — the number-lore a
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
  readonly isPerfect?: boolean
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
  /** Include the modern ×6 wordplay ciphers (Latin only). Default `true`. */
  includeModern?: boolean
  /**
   * Include the SDK-added *extended* methods (the deeper Hebrew Miluim and the
   * Thelemic NAEQ). Default `false`, so a profile stays a row-for-row match
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
  /** Explicit ±n window; must be a non-negative integer. */
  readonly tolerance?: number
}

/** The result of an equal-value {@link matches} search over a lexicon. */
export interface MatchResult {
  /** The query text's value under the chosen cipher. */
  readonly value: number
  /**
   * Every lexicon word within {@link tolerance} of `value` (query order
   * preserved). With the default zero tolerance this is exactly the
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
   * Fraction of the lexicon within tolerance of this value, in $[0, 1]$.
   * Equal-value coincidences are statistically cheap — this number is the
   * honesty knob: a high commonness means the "match" is unremarkable.
   */
  readonly commonness: number
}
