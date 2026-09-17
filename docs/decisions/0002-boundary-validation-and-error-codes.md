# 0002: Validate at the public boundary and throw the package's own error codes

- Status: accepted
- Date: 2026-09-17
- Deciders: Manuel Haller Polo (maintainer)

## Context and problem statement

Each package already had one error class with a `code`, but in 0.1.0 many failures escaped as
something else, or were caught too late:

- invalid options surfaced as raw `RangeError`, `TypeError` or `DOMException` from deep inside
  (for example a negative `timeoutMs`, or `rounds: 0` reaching negentropy's numerics);
- sibling-package errors crossed boundaries unchanged (`OracleError` from scan and gematria,
  `NegentropyError` from psi, raw source errors from oracle casts);
- some bad options were never detected: `race` with `maxValue: NaN` looped forever;
  `sampledProvider` with `safetyFactor ≤ 0` emitted the constant SHA-256 of the empty string as
  "private TRNG" bytes; `castByValue` with a negative bound threw only after consuming entropy.

Callers could not match failures reliably, and some mistakes cost entropy, time or silent
wrong output before they showed.

## Decision drivers

- A caller should be able to handle every failure of a package by matching one error class
  and its `code`.
- Caller mistakes must be rejected before any entropy is drawn or any I/O starts.
- The underlying failure must stay inspectable.

## Considered options

1. Document which foreign errors each function may throw.
2. Wrap everything in one generic code (`internal`).
3. **Validate every public input up front with one small validation helper per package, and map
   foreign errors to the package's own code union, keeping the original as `cause`.**

## Decision outcome

Chosen option 3.

- Each package throws exactly one error class with `name` set to the class name, a stable
  `code` from an exported string-literal union, and `cause` for the underlying failure.
- Options are validated at the public boundary, before any entropy or I/O. Each package keeps
  its checks in one place (for example the `validate*` helpers in scan, `internal/validate.ts`
  in psi, `internal/options.ts` in entropy).
- Foreign errors are mapped: argument problems to the package's invalid-input code
  (`invalid_options`, `invalid_config`, `invalid_input`, `invalid_request`, `invalid_plan`
  depending on the package's existing union), failures of an upstream source to `source_error`
  (negentropy: `source_failed`; entropy: `network`), aborts to `aborted`.
- New codes are additive. Added in 0.2.0: oracle `source_error` and `closed`; scan
  `invalid_options` and `source_error`; flow `source_error`; field `insufficient_entropy` and
  `source_error`; gematria `aborted`, `insufficient_entropy` and `source_error`; entropy
  `permission` and `verification`; negentropy `numerical`; psi `plan_mismatch`; vdf
  `unsupported_version` and `modulus_mismatch`; visualizer `invalid_options`.

### Consequences

- Good: `catch (e) { if (e instanceof ScanError && e.code === 'source_error') … }` covers a
  hardware health failure, with the provider's `EntropyError('health_test')` in `cause`.
- Good: validation failures cost no entropy; the constant-output and infinite-loop classes of
  bug are closed.
- Bad: widening a code union breaks exhaustive `switch` statements in TypeScript callers; every
  widening is listed as a behaviour change (see [0008](0008-semver-policy-0x.md)).
- Bad: validation code grows in every package and must be kept in step with the options it
  checks.

## More information

- Implementation: negentropy [`2e45584`](https://github.com/Polobase/mindpeeker-sdk/commit/2e45584cf92080c2afcfef9f50a22f99f646c72b),
  oracle [`48d3166`](https://github.com/Polobase/mindpeeker-sdk/commit/48d31665d1e06187fbd7a85126a0611e19cdfca0),
  vdf [`6420b8f`](https://github.com/Polobase/mindpeeker-sdk/commit/6420b8f35a13e7ca9590803d93669786d8eb1f24),
  flow [`5ee62ab`](https://github.com/Polobase/mindpeeker-sdk/commit/5ee62ab18b9bd01c32600b74758c55d111f5a922),
  psi [`7728a2d`](https://github.com/Polobase/mindpeeker-sdk/commit/7728a2d27748b7c4a29612faff0a185e832e6096),
  gematria [`df74544`](https://github.com/Polobase/mindpeeker-sdk/commit/df74544bfeed75225b96c349285a531776ef3b32),
  visualizer [`ab419e6`](https://github.com/Polobase/mindpeeker-sdk/commit/ab419e6d49d98da74520ee8f2a5707becaa97267),
  entropy [`334c6df`](https://github.com/Polobase/mindpeeker-sdk/commit/334c6df6cb92661e092a6b21b7bcb5723a37f52a),
  field [`a7448b3`](https://github.com/Polobase/mindpeeker-sdk/commit/a7448b35fd482b60aa5f2ca280ce2bd66369c619),
  scan [`ed1e8aa`](https://github.com/Polobase/mindpeeker-sdk/commit/ed1e8aaf257cd356c68a4c31aa3bef578aab1a91),
  follow-ups [`5ec25a9`](https://github.com/Polobase/mindpeeker-sdk/commit/5ec25a951907d846592e14170246c625020da03d).
- The rule is stated in the root README under "Shared conventions".
