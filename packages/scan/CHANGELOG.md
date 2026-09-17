# @mindpeeker/scan

## 0.2.0

### Minor Changes

- First release on npm. `@mindpeeker/scan` re-expresses AetherOne's radionic scanning and broadcasting model on the SDK primitives and adds what AetherOne lacks: an exact chance null for every result. It models a practice; it makes no efficacy claim.

  Changes relative to the unpublished 0.1.0 workspace version (relevant only if you used it from the repository):

  - BREAKING: `broadcast` finishes cleanly only when its source ends. Source failures reject with `source_error` instead of returning a shortened receipt, and invalid `resonanceOdds`/`resonanceValue` are rejected instead of silently never resonating.
  - BREAKING: `ScanErrorCode` gains `invalid_options` and `source_error`. Every option (`maxValue`, `subsetFraction`, `rounds`, `deviationRounds`, `prior`, `alpha`, `roundBytes`, `durationMs`, `mode`, `signal`, the source shape) is validated up front, so NaN or ∞ no longer hang the race and `RangeError`, `PsiError`, `OracleError` and `RateError` no longer leak. Rate-object broadcast targets are checked (`invalid_target`) before any byte is read.
  - BREAKING: `DeviationResult.p` is the exact two-sided binomial p (it was the normal tail: at N = 16 rounds a fair source crossed p < 0.05 with probability 0.077); `z` is unchanged and descriptive.
  - BREAKING: deviation coins are read eight per byte through the bit reader (was one byte per coin), so the same bytes give different results; `bitsUsed` counts only bits that entered a decision.
  - BREAKING: items rank on `lnBayesFactor` without subtraction (`Infinity − Infinity` fell back to catalog order); ties break on a hash of the item id.
  - BREAKING: the default race subset follows AetherOnePi, min(M, clamp(⌊M/10⌋, 120, 5000)) (was max(12, round(M/10))), so catalogs of up to 120 items are raced whole.
  - BREAKING: `defineCatalog` rejects duplicate ids, duplicate names within a category and invalid rates, and stores frozen copies; `ScanResult` requires `id`.
  - BREAKING: broadcast modulation is one continuous stream across rounds and receipts are v2 (`mode`, `witnessKind`, `outputHash`); `parseReceipt` still reads v1 and is strict. `signatureToRate` NFC-normalizes and draws digits by rejection from an extended digest, so rates differ for the same signature (base 44 is exactly uniform and all 336 base-336 digits are reachable).
  - BREAKING: `scanTripolar` opens one stream for both phases (a replayable source reused phase-1 bytes), scores the catalog in the protocol's intention order, and accounts for both phases.
  - Every entry point closes the source stream it opens, including `broadcast` when the consumer stops iterating.
  - New: `pBonferroni`, `pHolm` and `qBH` on every result and a `multiplicity` summary (expected false positives, counts, omnibus χ²) on reports; `race`, `raceSubsetSize`, `subsetMin`/`subsetMax`; `vitalityP`, `generalVitalitySf` and `GV_AUTO_MODE_THRESHOLD` (1400); `sweepScan` and `sweepNullPmf` (the classical dial sweep with an exact null); `WITNESS_KINDS`; `scanTripolar` options `prior`, `alpha`, `control`, `registration` and `declare`.

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @mindpeeker/negentropy@0.2.0
  - @mindpeeker/oracle@0.2.0
  - @mindpeeker/psi@0.2.0
  - @mindpeeker/rate@0.2.0
