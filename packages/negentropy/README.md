# @mindpeeker/negentropy

Measure order in noise, and manufacture order from noise.

Companion package to [`@mindpeeker/entropy`](../entropy): where entropy *sources*
randomness, negentropy asks two questions about it —

- **Is there any order in this noise, and when did it appear?** GCP-style network
  statistics (per-source z-scores, Stouffer Z, network variance, cumulative
  deviation with significance envelopes), information-theoretic negentropy
  estimators, and a pre-registered experiment layer over live entropy streams.
- **How do I concentrate raw noise into uniform bits?** Von Neumann and Peres
  debiasing, SP 800-90B vetted conditioning, Toeplitz-hashing extraction, and
  honest min-entropy accounting.

Zero dependencies, browser-safe, ESM. Any `@mindpeeker/entropy` provider works
as an input source structurally — no coupling between the packages.

> Full documentation lands with the 0.1.0 API freeze. Until then, see the
> module doc comments in `src/`.
