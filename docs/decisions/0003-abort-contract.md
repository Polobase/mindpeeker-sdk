# 0003: Sources may throw or return on abort; consumers race the signal and report `aborted`

- Status: accepted
- Date: 2026-09-17
- Deciders: Manuel Haller Polo (maintainer)

## Context and problem statement

Every package passes an `AbortSignal` into sources shaped like
`{ name, stream(opts?): AsyncIterable<Uint8Array> }`. In 0.1.0 the packages disagreed about
what happens next:

- when the upstream honoured the signal, flow's `pairStreams` and `windowedTransferEntropy`
  rejected with the source's own error (`DOMException`, `EntropyError`) instead of
  `FlowError('aborted')`;
- a stalled upstream could never be pre-empted, because consumers only looked at the signal
  after the next chunk arrived;
- a source that ended its stream cleanly after an abort made psi's `runTripolar` report
  `insufficient_data` and scan's `scanTripolar` report `insufficient_entropy`;
- entropy's `sleep()` ignored an already-aborted signal, so a beacon stream could wait a full
  poll interval; ffmpeg children outlived the abort and kept the camera open.

Both behaviours of a source (throwing or returning) are reasonable, so the contract has to say
which one consumers must handle.

## Decision drivers

- An abort must take effect promptly, even when the upstream is blocked.
- The caller must see the abort as the consuming package's own `aborted` code, never as
  "not enough data".
- Existing sources, including third-party ones, should keep working.

## Considered options

1. Require sources to throw on abort.
2. Require sources to return on abort.
3. **Allow both; make consumers race every pending pull against the signal and classify the
   outcome.**

## Decision outcome

Chosen option 3.

- A source may throw (entropy providers throw `EntropyError('aborted')`) or return when its
  signal fires.
- Every consuming async generator races the pending `next()` against the signal
  (entropy's `guardStream`, flow's `internal/abort.ts`, psi's `nextOrAbort`). When the signal
  has fired, any outcome, whether a thrown error or a clean end, is reported as the package's
  own `aborted` error with the original as `cause`.
- Cleanup after an abort waits for the upstream iterator only for a bounded grace period.
- Pre-aborted signals are honoured immediately, including in sleeps and when no bytes are
  needed.

### Consequences

- Good: abort latency no longer depends on the source's chunk cadence; a stalled upstream is
  pre-empted.
- Good: callers handle one code per package.
- Bad: some calls that used to finish with partial results now reject with `aborted`; listed
  as behaviour changes.
- Bad: racing adds a small amount of code to every stream consumer, and a source that ignores
  the signal keeps running in the background until its grace period ends.
- Found along the way: under Bun 1.3.1 a chain of `MessageChannel` yields starves timers, so a
  timer-driven `abort()` is never observed; the vdf package yields with `scheduler.yield`,
  then `setImmediate`, before falling back to `MessageChannel`.

## More information

- Implementation: negentropy [`2e45584`](https://github.com/Polobase/mindpeeker-sdk/commit/2e45584cf92080c2afcfef9f50a22f99f646c72b)
  and [`719a865`](https://github.com/Polobase/mindpeeker-sdk/commit/719a86516d26605311c60febd6d7834777643b11),
  oracle [`48d3166`](https://github.com/Polobase/mindpeeker-sdk/commit/48d31665d1e06187fbd7a85126a0611e19cdfca0),
  vdf [`6420b8f`](https://github.com/Polobase/mindpeeker-sdk/commit/6420b8f35a13e7ca9590803d93669786d8eb1f24),
  flow [`5ee62ab`](https://github.com/Polobase/mindpeeker-sdk/commit/5ee62ab18b9bd01c32600b74758c55d111f5a922),
  psi [`7728a2d`](https://github.com/Polobase/mindpeeker-sdk/commit/7728a2d27748b7c4a29612faff0a185e832e6096),
  entropy [`334c6df`](https://github.com/Polobase/mindpeeker-sdk/commit/334c6df6cb92661e092a6b21b7bcb5723a37f52a),
  scan [`ed1e8aa`](https://github.com/Polobase/mindpeeker-sdk/commit/ed1e8aaf257cd356c68a4c31aa3bef578aab1a91).
- The contract is stated in the root README under "Shared conventions".
- Related: [0001 reader lifecycle](0001-reader-lifecycle.md).
