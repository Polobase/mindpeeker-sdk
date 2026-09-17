# 0008: While 0.x, behaviour changes ship in a minor release and are listed

- Status: accepted
- Date: 2026-09-17
- Deciders: Manuel Haller Polo (maintainer)

## Context and problem statement

Eight packages were published at 0.1.0. The 0.2.0 audit found defects whose fixes necessarily
change results: a VDF verifier that accepted a forged output, registration hashes that did not
identify an analysis, permutation nulls with about 50% false positives on alternating designs,
p-values that were identical on every random field, gematria reverse values that dropped
letters. Fixing them changes outputs that users may have stored, and several fixes also widen
error-code unions or rename options.

[Semantic Versioning 2.0.0, item 4](https://semver.org/spec/v2.0.0.html#spec-item-4) says that
major version zero is for initial development and that anything may change at any time. That
permits the fixes, but gives users no signal about what changed. What rule do these packages
follow before 1.0?

## Decision drivers

- Wrong mathematics and broken contracts must be fixable without waiting for 1.0.
- Users must be able to find every change that affects their results.
- Dependency ranges should not pull a behaviour change in silently. With npm's caret ranges,
  `^0.1.0` accepts `0.1.x` but not `0.2.0`, so a minor bump at 0.x is not installed
  automatically.

## Considered options

1. Go to 1.0.0 now and use major versions for breaking changes.
2. Follow item 4 literally and change behaviour in any release.
3. **Stay at 0.x; allow behaviour changes that correct wrong math or broken contracts, ship them
   only in minor releases, and list every one.**

## Decision outcome

Chosen option 3.

- A change that users can observe in results or contracts ships in a **minor** release: corrected
  math that changes outputs, new or widened error codes, renamed options, stricter validation
  that rejects inputs accepted before, changed wire or hash formats.
- Every such change is marked as breaking in its commit (`type(scope)!:`), described in the
  package README under "Behaviour changes in 0.x.y", and carried into the changeset and
  CHANGELOG.
- **Patch** releases contain fixes and additions that change no documented result or signature,
  and documentation.
- Formats that are stored or exchanged carry their own version, so a reader can tell old data
  from new instead of misreading it: VDF wire format v2 (0.1.0 bytes throw
  `unsupported_version`), the registration envelope schema `negentropy/experiment/1`, psi JSONL
  schema v2 and scan broadcast receipts v2 (psi and scan still read their v1 records).
- For 0.2.0, all packages are released together at 0.2.0, including four new packages created
  at that version.
- When to declare 1.0 is a separate decision.

### Consequences

- Good: users on caret ranges keep 0.1.x behaviour until they choose to upgrade, and the
  behaviour-change sections tell them what to check.
- Good: stored artefacts whose meaning changed fail loudly (for example 0.1.0 VDF proofs)
  instead of verifying under different rules.
- Bad: at 0.x a minor release can require code changes, which some users will not expect from a
  minor bump.
- Bad: maintaining the behaviour-change sections is manual work in every package README.

## More information

- Breaking commits for 0.2.0: [`2e45584`](https://github.com/Polobase/mindpeeker-sdk/commit/2e45584cf92080c2afcfef9f50a22f99f646c72b),
  [`48d3166`](https://github.com/Polobase/mindpeeker-sdk/commit/48d31665d1e06187fbd7a85126a0611e19cdfca0),
  [`6420b8f`](https://github.com/Polobase/mindpeeker-sdk/commit/6420b8f35a13e7ca9590803d93669786d8eb1f24),
  [`5ee62ab`](https://github.com/Polobase/mindpeeker-sdk/commit/5ee62ab18b9bd01c32600b74758c55d111f5a922),
  [`719a865`](https://github.com/Polobase/mindpeeker-sdk/commit/719a86516d26605311c60febd6d7834777643b11),
  [`7728a2d`](https://github.com/Polobase/mindpeeker-sdk/commit/7728a2d27748b7c4a29612faff0a185e832e6096),
  [`df74544`](https://github.com/Polobase/mindpeeker-sdk/commit/df74544bfeed75225b96c349285a531776ef3b32),
  [`ab419e6`](https://github.com/Polobase/mindpeeker-sdk/commit/ab419e6d49d98da74520ee8f2a5707becaa97267),
  [`334c6df`](https://github.com/Polobase/mindpeeker-sdk/commit/334c6df6cb92661e092a6b21b7bcb5723a37f52a),
  [`a7448b3`](https://github.com/Polobase/mindpeeker-sdk/commit/a7448b35fd482b60aa5f2ca280ce2bd66369c619),
  [`ed1e8aa`](https://github.com/Polobase/mindpeeker-sdk/commit/ed1e8aaf257cd356c68a4c31aa3bef578aab1a91).
- Process: [`CONTRIBUTING.md`](../../CONTRIBUTING.md#changesets) and
  [`docs/releasing.md`](../releasing.md).
