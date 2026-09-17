# @mindpeeker/negentropy

## 0.2.0

### Minor Changes

- Exact numerics at GCP scale, step-aligned sessions whose `stop()` never throws, versioned registration digests, and new anytime-valid monitoring and GCP statistics. Every 0.1.x registration hash changes. See "Behaviour changes in 0.2.0" in the package README for the full list.

  Experiment layer:

  - BREAKING: `registerExperiment` hashes the default-resolved envelope `{"schema":"negentropy/experiment/1","config":…}` serialized as RFC 8785 canonical JSON, so every 0.1.x hash differs. Registration validates strictly (unknown keys, duplicate event ids, malformed windows, invalid calibrations and anchors throw), `config` is the resolved config, and the result gains `schema` and `canonical`. Hand-built `{ config, hash }` objects are refused. Register again and publish the new hash.
  - BREAKING: `canonicalJson` follows RFC 8785 and throws `invalid_config` for Date (was an ISO string), `undefined` members (were dropped), Map, Set, typed arrays and class instances (were serialized by their enumerable keys), BigInt, lone surrogates and noncharacters.
  - BREAKING: `session` archives one row per tick per source, `NaN` when the source missed the round, stamped with the tick time. Under `missing: 'skip'` sources no longer desynchronise and nothing is truncated.
  - BREAKING: `Session.stop()` never throws. An event whose window has not elapsed returns `status: 'incomplete'` (0.1.x threw `invalid_window`), and a stop during burn-in returns an empty result (0.1.x threw `insufficient_data`). New `series()` accessor.
  - BREAKING: `session()` validates at construction. `stepTimeoutMs` must be finite in (0, 2³¹ − 1] or `Infinity` (no deadline); 0.1.x fired values ≥ 2³¹ after 1 ms. `source.stream()` receives a session-owned signal that `stop()` aborts. During burn-in under `missing: 'skip'`, a source that times out or ends is dropped.
  - BREAKING: `analyzeTrials` under `missing: 'skip'` combines over the sources present at each step instead of truncating every series to the shortest. Event windows past the data are `incomplete` instead of throwing. Overlapping complete events switch the composite to Brown's correction (`independent`, `method`, `variance`, `reason`). `ExperimentResult` gains `analysedSteps`, `EventResult` gains `status` and `reason`, and `analyzeBytes` rejects an interval clock.
  - BREAKING: `EventStatistic` gains `'covar'` and `SessionTick` gains `logEValue` and `eValue`; exhaustive switches and hand-built ticks must add them.
  - `analyzeTrials(series, { registration, calibration })` re-analyses a recorded session exactly without a second burn-in.

  Numerics, statistics and extraction:

  - BREAKING: domain errors in the special functions are `NegentropyError('invalid_config')` (was `RangeError`) and non-convergence is the new `numerical` code (was a bare `Error`). NaN input throws; ±∞ returns exact limits.
  - `chi2Sf`, `chiSquareP` and `devvar` no longer throw for df of about 3.7·10⁶ and more near the mean, and `chi2Ppf` lower-tail quantiles are correct (they were clamped near 5.7e-14).
  - BREAKING: the statistics and estimators reject non-finite or non-bit input (`invalid_config`) and throw `insufficient_data` instead of returning NaN. `ditheredTrialZ` mixes the source name into its seed, so its output differs from 0.1.x.
  - BREAKING: `vettedOutputEntropy` implements SP 800-90B Output_Entropy (credits drop by up to about 0.77 bits near h_in ≈ n_out); `debiasAccounted` caps the claim at the input claim unless `{ basis: 'iid' }`; `ContinuousHealth` validates its H and window size; `KahanSum` is Neumaier summation.
  - BREAKING: `conditionStream` wraps upstream errors as `source_failed` and rejects empty HMAC keys (its output is unchanged and pooling is now linear-time); `hmacCondition` rejects an empty key; `toeplitzOutputBits` rejects NaN, negative or infinite min-entropy and throws `insufficient_data` when no output bit is possible.
  - BREAKING: `engines.node` is `>=20.19` (was `>=20.3`).
  - `trialStream`, `windowedNegentropy` and `conditionStream` race every upstream pull against the abort signal and close the upstream on abort.
  - New anytime-valid monitoring: `netvarMartingale`, `netvarLogM`, `netvarBoundary`, `anytimeEnvelope`, `driftMartingale`, `driftLogM`, `driftBoundary`, `anytimeP`, `villeCrossing`.
  - New GCP statistics: `covar`, `blockZ`, `blockedNetvar`, `blockedDevvar`, `blockingDecomposition`, `networkAutocorrelation`, `epochAverage`, `varianceRatio`, and (first on npm in this release) `networkCoherence`, `clusteredNetvar`, `onsiteVsGlobal`.
  - New estimators and helpers: `outputEntropy`, `debiasStream`, `createDebiaser`, `brownCompositeZ`, `EXPERIMENT_SCHEMA`, and (first on npm in this release) `autocorrelation`, `sampleEntropy`, `approximateEntropy`, `spectralTest`, `spectralEntropy`. `@mindpeeker/negentropy/numerics` adds `aptCutoff`, `rctCutoff`, `betaInc`, `betaPpf`, `lnBeta`, `binomialPmf`, `binomialCdf`, `binomialSf` and `chi2Isf`.
