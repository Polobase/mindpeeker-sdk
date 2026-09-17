# 0001: Whoever opens a reader or iterator closes it

- Status: accepted
- Date: 2026-09-17
- Deciders: Manuel Haller Polo (maintainer)

## Context and problem statement

Live entropy sources hold real resources: a WebSocket, a Web Serial port, a camera track, an
ffmpeg child process. In 0.1.0, `@mindpeeker/oracle`'s `StreamReader` never called the source
iterator's `return()`, and `ByteReader` had no `close()`. Every completed cast therefore left
the source's stream suspended and its cleanup unrun: one leaked socket or hardware session per
cast. The scan entry points (`scan`, `scanDeviation`, `generalVitality`, `broadcast`,
`scanTripolar`) inherited the leak. A concrete failure: a browser app that scans with
`serialEntropy({ port })` gets `InvalidStateError` on the second scan, because the Web Serial
port is still open. Separately, a per-cast `signal` was silently ignored when the input was an
existing `ByteReader`, so an abort could hang forever.

Who is responsible for closing a stream, and how does a caller share one reader across calls?

## Decision drivers

- Hardware and network resources must be released after every call, including on errors and
  early exits.
- A caller must be able to reuse one open reader across several calls (for accounting or
  replay).
- The rule must be the same in every package so compositions do not double-close or leak.

## Considered options

1. Leave closing to the source (rely on garbage collection or process exit).
2. Close every reader a function receives.
3. **Ownership: the code that creates a reader or iterator closes it; a reader passed in by the
   caller stays open.**

## Decision outcome

Chosen option 3.

- `ByteReader` gains `close(): Promise<void>` and `[Symbol.asyncDispose]`, so `await using`
  works. `StreamReader.close()` calls the iterator's `return()` once.
- Every function that creates a reader or opens a stream closes it in `finally`: oracle casts,
  scan entry points, field `sampleField` and `csrEnvelope`, gematria's `./oracle` bridge. The
  visualizer's `stop()` calls `return()` on every consumed iterator.
- A reader the caller passes in is never closed by the callee.
- `byteReader(reader, { signal })` returns an abortable view, so a per-call signal works on a
  shared reader; concurrent use of one reader throws a typed error instead of corrupting
  accounting.

The rule is stated once in the root README ("Shared conventions") and in each package README.

### Consequences

- Good: a finished or failed call no longer holds a port, socket, camera or child process;
  repeated scans on Web Serial work.
- Good: `scanTripolar` now opens one stream and hands psi a non-closing view, so a replayable
  source is not reused between phases.
- Bad: callers that pass their own reader must close it themselves.
- Bad: closing awaits cleanup of a suspended async generator, which can itself be stuck in an
  `await`; waits are bounded (for example 100 ms in flow and entropy, 150 ms in the visualizer),
  so a misbehaving source can still finish its cleanup late.

## More information

- Implementation: oracle [`48d3166`](https://github.com/Polobase/mindpeeker-sdk/commit/48d31665d1e06187fbd7a85126a0611e19cdfca0),
  scan [`ed1e8aa`](https://github.com/Polobase/mindpeeker-sdk/commit/ed1e8aaf257cd356c68a4c31aa3bef578aab1a91),
  field [`a7448b3`](https://github.com/Polobase/mindpeeker-sdk/commit/a7448b35fd482b60aa5f2ca280ce2bd66369c619),
  gematria [`df74544`](https://github.com/Polobase/mindpeeker-sdk/commit/df74544bfeed75225b96c349285a531776ef3b32),
  visualizer [`ab419e6`](https://github.com/Polobase/mindpeeker-sdk/commit/ab419e6d49d98da74520ee8f2a5707becaa97267);
  the shared-conventions text in [`c946fbb`](https://github.com/Polobase/mindpeeker-sdk/commit/c946fbbbd20ed6d566c05c722bc088ac0f32e610).
- Related: [0003 abort contract](0003-abort-contract.md).
