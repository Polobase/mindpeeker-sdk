/**
 * @mindpeeker/gematria — a pure, deterministic, multi-tradition gematria and
 * isopsephy engine (Hebrew, Greek, Arabic, English/Latin, and the alphabetic
 * numerals of Cyrillic, Armenian, Georgian, Coptic, Syriac and Gothic).
 *
 * This root entry is a true zero-dependency, browser-safe leaf: given a word
 * and a cipher it returns an exact integer, and the same word always returns
 * the same number. The value *computation* is rigorous. What equal values
 * *mean* is not — it is a contested hermeneutic tradition, and the English ×6
 * ciphers are explicitly modern wordplay. See the README's honest-framing
 * section, and `matches`/`lookup`, whose `commonness` measures how cheap a
 * coincidence really is. Cipher parameters accept a canonical `CipherId` or a
 * friendly `CipherAlias` (e.g. `'jewish'`, `'simple'`) — see `resolveCipherId`.
 *
 * Beyond the frontend-parity ciphers, the root also exposes the SDK-added
 * *extended* Hebrew Miluim (`he-milui`/`he-kidmi`/`he-perati`/`he-neelam`/
 * `he-katan-mispari`, plus the divine-name `milui()` helper), the Greek ordinal,
 * the Arabic Abjad, the Thelemic NAEQ/TQ, the Elizabethan and Roman Latin tables,
 * the alphabetic numeral ciphers of six further scripts, the Aiq Beker nine
 * chambers and their exchanges, the Avgad/Achbi/Aibat/generic temurah shifts and
 * all twenty-two Tziruph tables, Notariqon contraction, Hebrew letter numerals,
 * the colel/tolerance matching knob with script-aware lexicons, the commonness
 * statistics (collision profile, birthday bound, pairing permutation test), and
 * pure `numberProperties()` number-lore.
 *
 * The optional `@mindpeeker/gematria/oracle` subpath adds entropy-driven draws
 * (composing `@mindpeeker/oracle`), and `@mindpeeker/gematria/lexicon` ships the
 * curated, value-indexed Sepher Sephiroth so lookups work out of the box.
 */

export {
  type AiqBekerCell,
  aiqBeker,
  aiqBekerEquivalent,
  aiqBekerSubstitute,
  type ChamberFinals,
  type ChamberOptions,
  chamberMates,
  chamberReduce,
  NINE_CHAMBERS,
} from './chambers.js'
export { ARABIC_CIPHERS } from './ciphers/arabic.js'
export { ENGLISH_CIPHERS } from './ciphers/english.js'
export { GREEK_CIPHERS } from './ciphers/greek.js'
export {
  HE_BASE,
  HE_NAMES,
  HEBREW_CIPHERS,
  heIndex,
  type MiluiOptions,
  type MiluiVariant,
  milui,
} from './ciphers/hebrew.js'
export { NUMERAL_CIPHERS } from './ciphers/numerals.js'
export {
  birthdayBound,
  type CollisionOptions,
  type CollisionProfile,
  collisionProfile,
  expectedMatches,
  type ValueBin,
} from './commonness.js'
export {
  GematriaError,
  type GematriaErrorCode,
  type GematriaErrorOptions,
} from './errors.js'
export {
  admissibleWords,
  clearDefaultLexicon,
  createLexiconRegistry,
  getDefaultLexicon,
  type LexiconRegistry,
  useDefaultLexicon,
} from './lexicon-registry.js'
export { equalValue, lookup, matches } from './match.js'
export { detectScript, digitRoot, HEBREW_FINALS, normalizeFor } from './normalize.js'
export { acronym, notariqon } from './notariqon.js'
export { MAX_NUMBER, numberProperties } from './numbers.js'
export { type HebrewNumeralOptions, MAX_HEBREW_NUMERAL, toHebrewNumeral } from './numeral.js'
export {
  type PairMatchOptions,
  type PairMatchTestResult,
  type PairTestMethod,
  pairMatchTest,
} from './pair-test.js'
export {
  ALIASES,
  CIPHERS,
  CIPHERS_BY_SCRIPT,
  cipherFromId,
  getCipher,
  resolveCipherId,
} from './registry.js'
export { achbi, aibat, albam, atbash, avgad, temurahShift } from './temurah.js'
export type {
  AcronymOptions,
  AnalyzeOptions,
  Cipher,
  CipherAlias,
  CipherId,
  CipherRef,
  CipherValue,
  GematriaProfile,
  GematriaResult,
  LetterBreakdown,
  LetterValue,
  Lexicon,
  LexiconWord,
  MatchOptions,
  MatchResult,
  NamesVariant,
  NotariqonOptions,
  NumberProperties,
  PrimeFactor,
  ProfileLetter,
  ProfileOptions,
  Script,
  ValueOptions,
} from './types.js'
export {
  ABGATH,
  ACHBAZ,
  ACHBI,
  ADBAG,
  AGDATH,
  AHBAD,
  AIBAT,
  ALBACH,
  ALBATH,
  AMBAL,
  ANBAM,
  AOBAS,
  APBAO,
  AQBATZ,
  ARBAQ,
  ASBAN,
  ASHBAR,
  ATBACH,
  ATHBASH,
  ATZBAP,
  AVBAH,
  AZBAV,
  TZIRUPH_TABLES,
  type TziruphOptions,
  type TziruphSelfPairs,
  type TziruphSquareKind,
  type TziruphTable,
  tziruph,
  tziruphSquare,
} from './tziruph.js'
export { analyze, letterValues, profile, reduce, value } from './value.js'
