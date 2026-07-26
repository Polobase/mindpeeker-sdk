/**
 * @mindpeeker/gematria — a pure, deterministic, multi-tradition gematria and
 * isopsephy engine (Hebrew, Greek, English/Latin).
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
 * `he-katan-mispari`, plus the divine-name `milui()` helper), the Arabic Abjad
 * (`ar-abjad`) and Thelemic NAEQ (`en-naeq`) ciphers, the Aiq Beker nine
 * chambers, the Avgad/Achbi/generic temurah shifts, Notariqon contraction, the
 * colel/tolerance matching knob, and pure `numberProperties()` number-lore.
 *
 * The optional `@mindpeeker/gematria/oracle` subpath adds entropy-driven draws
 * (composing `@mindpeeker/oracle`), and `@mindpeeker/gematria/lexicon` ships the
 * curated, value-indexed Sepher Sephiroth so lookups work out of the box.
 */

export { type AiqBekerCell, aiqBeker, chamberReduce, NINE_CHAMBERS } from './chambers.js'
export { ARABIC_CIPHERS } from './ciphers/arabic.js'
export { ENGLISH_CIPHERS } from './ciphers/english.js'
export { GREEK_CIPHERS } from './ciphers/greek.js'
export {
  HE_BASE,
  HE_NAMES,
  HEBREW_CIPHERS,
  heIndex,
  type MiluiVariant,
  milui,
} from './ciphers/hebrew.js'
export {
  GematriaError,
  type GematriaErrorCode,
  type GematriaErrorOptions,
} from './errors.js'
export {
  equalValue,
  getDefaultLexicon,
  lookup,
  matches,
  useDefaultLexicon,
} from './match.js'
export { detectScript, digitRoot, HEBREW_FINALS, normalizeFor } from './normalize.js'
export { acronym, notariqon } from './notariqon.js'
export { numberProperties } from './numbers.js'
export {
  ALIASES,
  CIPHERS,
  CIPHERS_BY_SCRIPT,
  cipherFromId,
  getCipher,
  resolveCipherId,
} from './registry.js'
export { achbi, albam, atbash, avgad, temurahShift } from './temurah.js'
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
  MatchOptions,
  MatchResult,
  NotariqonOptions,
  NumberProperties,
  PrimeFactor,
  ProfileLetter,
  ProfileOptions,
  Script,
} from './types.js'
export { analyze, letterValues, profile, reduce, value } from './value.js'
