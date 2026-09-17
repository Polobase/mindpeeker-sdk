# @mindpeeker/gematria

## 0.2.0

### Minor Changes

- First release on npm. `@mindpeeker/gematria` computes exact letter values under 43 ciphers in ten scripts (Hebrew, Greek, Arabic, English/Latin and the alphabetic numerals of Cyrillic, Armenian, Georgian, Coptic, Syriac and Gothic), with temurah tools including the 22 Tziruph tables, Aiq Beker, a 191-entry lexicon at `@mindpeeker/gematria/lexicon`, commonness statistics, and entropy-driven draws at `@mindpeeker/gematria/oracle`. The values are exact arithmetic; what equal values mean is not asserted.

  Changes relative to the unpublished 0.1.0 workspace version (relevant only if you used it from the repository):

  - BREAKING: reverse is defined over each cipher's canonical alphabet. Hebrew finals no longer score 0 (`value('שלום', 'he-hechrachi', true)` is 112, the Atbash value; it was 102), `he-gadol` reverse is the aleph↔tav mirror (א → 400, was 900), and `gr-isopsephy` reverse mirrors the 27 numeral letters (`λογος` → 838, was 867).
  - BREAKING: `la-agrippa` follows Agrippa's printed key (U = 200, V = 700; they were swapped) and is now identical to `la-jewish`.
  - BREAKING: `achbi` implements Achbi (א↔כ, ב↔י, … with ו and פ fixed; `achbi('א')` is כ). The previous mapping is Ginsburg's Aibat and is now `aibat`.
  - BREAKING: lexicon matching is script-aware. `matches`, `lookup`, `castGematria`, `drawByValue` and `castByValue` count only words written in the cipher's script with at least one scoring letter, so foreign or empty words no longer match each other at value 0; `MatchResult` gains `lexiconSize`.
  - BREAKING: normalization. Unicode format controls are stripped in every script; Greek and Latin use NFKD, Hebrew NFKC (Yiddish ligatures expanded), Arabic NFKD with ؤ ئ scoring as و ي and ى ک ی folded (`موسى` is 116, was 106). Text in the six numeral scripts was detected as Latin and is now scored by its numeral cipher.
  - BREAKING: `Cipher` gains required `alphabet` and `fold`; `Script` gains six members; `GematriaErrorCode` gains `aborted`, `insufficient_entropy` and `source_error`.
  - BREAKING: bundled lexicon grows from 36 to 191 entries (Sepher Sephiroth, Mathers, Stirling, Agrippa), each with a `source`; 'בבלון' = 90 is replaced by Crowley's 'באבאלען' = 156.
  - BREAKING: validation. `normalizeFor` throws `unsupported_script` for an unknown script; the reverse argument must be a boolean or an options object; `digitRoot(Infinity)` throws instead of looping forever; `milui` rejects unknown variants; `numberProperties` accepts only integers in [0, 2⁴⁸]; temurah functions throw `invalid_input` for non-strings; `notariqon`/`acronym` return letters only.
  - BREAKING: `./oracle` failures are always `GematriaError` (the `OracleError` is kept as `cause`); arguments are validated before any entropy is read; readers the bridge opens are closed; results gain `exact`, `tolerance`, `lexiconSize` and `bytesFetched`.
  - `sideEffects` lists the lexicon module, so bundlers keep `import '@mindpeeker/gematria/lexicon'`.
  - New: 12 ciphers (`gr-ordinal`, `en-tq`, `en-aq`, `la-elizabethan-simple`, `la-elizabethan-kaye`, `la-roman`, `cu-cyrillic`, `hy-numerals`, `ka-numerals`, `cop-numerals`, `syr-numerals`, `got-numerals`), the `keepTen` and `namesVariant: 'plene'` options, `tziruph` with the 22 table constants, `TZIRUPH_TABLES` and `tziruphSquare`, `chamberMates`, `aiqBekerSubstitute`, `aiqBekerEquivalent`, `toHebrewNumeral`, `collisionProfile`, `expectedMatches`, `birthdayBound`, `pairMatchTest`, `admissibleWords`, `clearDefaultLexicon`, `createLexiconRegistry`.

### Patch Changes

- Updated dependencies
  - @mindpeeker/oracle@0.2.0
