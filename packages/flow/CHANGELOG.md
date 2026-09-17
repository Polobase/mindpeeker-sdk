# @mindpeeker/flow

## 0.2.0

### Minor Changes

- Abort-safe streams, a χ² test for transfer entropy, conditional and collective transfer entropy, information storage and new surrogate families. Transfer-entropy values are bit-identical to 0.1.0; seeded surrogate ensembles are not. See "Behaviour changes in 0.2.0" in the package README for the full list.

  - BREAKING: an abort while an upstream pull is pending rejects with `FlowError('aborted', { cause })` instead of the source's own `DOMException` or `EntropyError`. Stalled sources no longer hang `pairStreams` and `windowedTransferEntropy`, and an upstream that ends after the abort is reported as `aborted`.
  - BREAKING: the new error code `source_error` wraps upstream failures that are not aborts (`cause`, `source`).
  - BREAKING: `permutationTest` and `effectiveTransferEntropy` draw surrogates from `xoshiro128ss` (SplitMix64-seeded xoshiro128**) instead of `xorshift32`, so the same `seed` gives a different ensemble than 0.1.0. Seeds must be non-negative safe integers, and `xorshift32` rejects seeds outside [0, 2³² − 1].
  - BREAKING: `permutationTest` throws `invalid_input` for an unknown `surrogate` (0.1.0 silently used `circularShift`), validates every option first, counts surrogate values within a relative 1e-12 of the observed TE as ties, enumerates all n − 1 rotations when `surrogate: 'circularShift'` and n − 1 ≤ `surrogates`, and returns `mean`, `sd`, `z`, `distinct` and `surrogate`.
  - BREAKING: `symbolsFromBytes` always returns a fresh `Uint8Array` (a `Buffer` input was aliased) and rejects other input types. `windowedTransferEntropy` validates `k`, `l`, `lag`, `alphabet` and `windowSize` (now ≤ 2²⁸) before pulling and checks each pair on arrival; `pairStreams` rejects non-iterable input and non-symbol numbers.
  - BREAKING: `equalWidthBins` divides before scaling, so overflowing and subnormal ranges bin correctly and a value exactly on a bin edge may land in a different bin than in 0.1.0. `weightedPermutationEntropy` rescales magnitudes above 2²⁵⁶ instead of returning NaN.
  - BREAKING: `engines.node` is `>=20.19` (was `>=20.3`). The package now depends on `@mindpeeker/negentropy` (its `./numerics` subpath only) and drops the `directed-information` keyword: transfer entropy is not Massey's directed information.
  - `effectiveTransferEntropy` renames `nShuffles` to `surrogates`; `nShuffles` is still accepted as a deprecated alias.
  - New: `chiSquareTest` (Barnett & Bossomaier 2012, with an adequacy guard), `conditionalTransferEntropy`, `collectiveTransferEntropy`, `activeInformationStorage`, `localActiveInformationStorage`, `entropyRate`, `blockEntropy`, `predictiveInformation`, `transferEntropyReport`, `transferEntropyByLag`, `symbolicTransferEntropy`, the surrogate methods `embeddingShuffle`, `blockShuffle`, `stationaryBootstrap` and `markov` (with `blockShuffle`, `stationaryBootstrap` and `markovSurrogate` generators), `xoshiro128ss`, the `locals` option of `windowedTransferEntropy`, and (first on npm in this release) `permutationEntropy` and `weightedPermutationEntropy`.

### Patch Changes

- Updated dependencies
  - @mindpeeker/negentropy@0.2.0
