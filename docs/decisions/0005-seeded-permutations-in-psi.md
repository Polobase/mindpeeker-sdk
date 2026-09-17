# 0005: Permutation nulls in psi use seeded permutations, not rotations

- Status: accepted
- Date: 2026-09-17
- Deciders: Manuel Haller Polo (maintainer)

## Context and problem statement

`@mindpeeker/psi` tests a labelled design (target versus control stimuli, for example in the
presentiment protocol) against a label-shuffle null: recompute the statistic under
relabelings and report the permutation p-value. In 0.1.0 `labelShuffleSurrogates` generated
evenly spaced **rotations** of the label sequence and skipped rotations identical to the
observed labelling. For the canonical alternating target/control design every rotation is
either the observed labelling or its complement, so the ensemble consisted of $m$ copies of
the complement, and any positive $\Delta z$ gave $p = 1/(1+m)$. At $\alpha = 0.05$ about half
of null datasets came out significant; a calibration run of the old algorithm reproduced a
rejection rate of about 50%.

A permutation null is only valid if the relabelings are drawn from the right group, uniformly,
and reproducibly for pre-registration.

## Decision drivers

- The null must hold its nominal size for every design, including periodic ones.
- Results must be reproducible from a registered seed, in every runtime.
- No third-party dependency, and the same seed should mean the same stream in every package
  that draws permutations.

## Considered options

1. Keep rotations and document the periodic-design problem.
2. Use `Math.random()` shuffles.
3. **Seeded uniform permutations from a small internal PRNG, with exact enumeration when the
   number of distinct relabelings is small; rotations only on request.**

## Decision outcome

Chosen option 3.

- A psi-internal PRNG (SplitMix64 seeding xoshiro128**) drives Fisher–Yates shuffles. The seed
  (a number, bigint, hex string or bytes) is part of the pre-registration; the default is seed
  0 with 100 surrogates (`DEFAULT_SURROGATES`).
- When the design has at most `surrogates` distinct relabelings other than the observed one,
  all of them are enumerated exactly instead of sampled; `describeLabelShuffle` reports the
  method, the count and the resolution $1/(m+1)$.
- Rotations remain available as `method: 'rotation'`, which now counts identity rotations.
- The same generator and seed format are used by `@mindpeeker/ephemeris` (LST permutation
  tests) and `@mindpeeker/judging` (rank-matrix Monte Carlo), so a registered seed produces the
  same stream in all three.

### Consequences

- Good: a null calibration over 500 datasets gives a rejection rate inside the
  Binomial(500, 0.05) band; the test stays in the suite.
- Good: surrogate draws are reproducible from the registration alone.
- Bad: `analyzePresentiment` permutation p-values differ from 0.1.x for the same data.
- Bad: with the default 100 surrogates the smallest attainable p is $1/101$; studies that need
  finer resolution must register more surrogates.

## More information

- Implementation: psi [`7728a2d`](https://github.com/Polobase/mindpeeker-sdk/commit/7728a2d27748b7c4a29612faff0a185e832e6096);
  ephemeris [`2e6a93e`](https://github.com/Polobase/mindpeeker-sdk/commit/2e6a93e2404fa03f00b4cc6ddb96276488b9489e);
  judging [`2e23acf`](https://github.com/Polobase/mindpeeker-sdk/commit/2e23acfa32e4a16808cd59c6189dd00f9b208a0a).
- The PRNG streams are pinned by fixtures generated with an independent Python transcription.
- Related: `timeOffsetSurrogates` gained per-source offsets in the same release, because rotating
  one source of three or more keeps the others aligned (a loss of power under H1).
