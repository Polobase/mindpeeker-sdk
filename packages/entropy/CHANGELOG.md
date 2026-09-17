# @mindpeeker/entropy

## 0.2.0

### Minor Changes

- Local providers can no longer emit constant blocks on bad conditioning options, the Adaptive Proportion Test cutoff is exact, health alarms restart the tests instead of ending the call, and beacon results carry round metadata with opt-in verification. See "Behaviour changes in 0.2.0" in the package README for the full list.

  Local providers, health tests and the provider contract:

  - BREAKING: `minEntropyPerSample` must be finite with 0 < H ≤ 8 and `safetyFactor` finite and ≥ 1, checked at construction (`EntropyError('invalid_request')`). In 0.1.0, `safetyFactor ≤ 0` or H = ∞ made every output block the constant SHA-256('') (`e3b0c442…b855`), NaN pooled forever, and H > 8 over-credited.
  - BREAKING: the APT cutoff is computed exactly in log space. 0.1.0 underflowed and silently disabled the Adaptive Proportion Test for H below about 0.38 at W = 512 (the jitter and sensor credits) and H < 1 at W = 1024, so patterned low-entropy sources can now fail the health tests.
  - BREAKING: start-up test. No output leaves a session (one `getBytes` call or one stream iterator) before 1024 raw samples have passed the health tests, so small reads consume more raw samples.
  - BREAKING: restart semantics. By default (`onHealthFailure: 'retest'`) an alarm discards the pending window and reruns the start-up test; the 3rd alarm of a session (`maxHealthFailures`, default 3) throws `health_test`. Pass `onHealthFailure: 'throw'` for the 0.1.0 behaviour.
  - BREAKING: the health tests run at the larger of the credited H and the provider's own health H, so raising `minEntropyPerSample` tightens them.
  - BREAKING: `defineProvider` requires a finite `timeoutMs` with 0 < ms ≤ 2³¹ − 1, rejects results of the wrong length with `bad_response`, wraps foreign failures as `network` with `cause`, and reports `aborted` whenever the caller's signal aborted.
  - BREAKING: an invalid stream `chunkBytes` (not an integer ≥ 1) or `timeoutMs` rejects the first pull with `invalid_request` (`chunkBytes: 0` yielded empty chunks forever). Local-provider streams apply `timeoutMs` per chunk and report aborts and source failures as `aborted`/`network` instead of raw `DOMException`s and Node errors.
  - BREAKING: `xorMix` throws `bad_response` when two members return byte-identical results (requests of 8 bytes or more).
  - BREAKING: configuration errors of local providers, strategies and Node adapters throw `EntropyError('invalid_request')` instead of `TypeError`.
  - BREAKING: `cameraEntropy` validates `stride` and `warmupFrames`, and `bits: 'lsb'` skips duplicate frames; `micEntropy` rescales Float32 samples by 32768; Generic Sensor events contribute only the firing sensor's three axes; an iOS permission refusal throws the new `permission` code; browser microphone and sensor queues keep at most `queueLimit` (8) items.
  - `jitterEntropy` runs a start-up timer self-test; ffmpeg children are killed on abort or timeout and use `-vsync passthrough` and `-nostdin`; `hwRng` honours the signal; `nodeSerialSource` opens with `O_NOCTTY` and maps open/read errors to `network`.
  - `rtlSdrSource` is exported from `@mindpeeker/entropy/node`, as the README documented.

  Online providers and beacons:

  - BREAKING: `anu`, `outshift`, `qbck`, `qci`, `randomOrg` and `superRand` throw `invalid_request` at construction for a missing credential or one that is not a non-empty printable-ASCII token (for example a key with a trailing newline). Empty `baseUrls`, `baseUrl` together with `baseUrls`, and poll, retry, staleness or connect intervals out of range throw `invalid_request` too.
  - BREAKING: beacon poll timeouts throw `timeout`; an abort ends the pending pull at once, also between polls; `chunkBytes` is always re-sliced when given (CURBy's 64-byte digests passed through unsliced for `chunkBytes: 32`).
  - BREAKING: a walked-back pulse, round, level, index, chain or block that is not the one requested throws `bad_response` (drand, NIST family, CURBy, Tezos, Bitcoin).
  - BREAKING: NIST-family streams deduplicate on `(chainIndex, pulseIndex)` (they stalled after a chain restart), and `getBytes` walks back across chain boundaries instead of throwing `insufficient_entropy`.
  - BREAKING: `randao` returns the final mixes of completed epochs and streams once per completed epoch.
  - BREAKING: stricter parsing for Flow (UInt64 as a decimal in range), qbck (hex byte strings) and Outshift (plain integers). SuperRand maps quota and key errors to `rate_limited` and `auth`, fails a missing WebSocket at once with `invalid_request`, and reconnects only after transport failures.
  - BREAKING: an abort or timeout while reading a response body is reported as `aborted`/`timeout` (was `bad_response`).
  - BREAKING (types): beacon factories return `BeaconProvider`; `EntropyResult.sources` is `readonly EntropySourceAttribution[]`; `EntropyErrorCode` gains `permission` and `verification`.
  - BREAKING: `engines.node` is `>=20.19` (was `>=20.3`).
  - Error messages no longer contain API keys, query strings or UUID-shaped path segments. RANDOM.ORG quota errors carry an estimated `retryAfterMs`; `Retry-After` HTTP-dates are parsed. One caller's abort no longer fails other callers sharing QCi's token exchange. Every network provider accepts `baseUrl` or `baseUrls`.
  - New: `drbgProvider` (SP 800-90A HMAC_DRBG for seeded control runs), `jitterStartupTest`, `sameSampledPixels`, round metadata on beacon results (`sources[].rounds`), `getRound` on drand, the NIST family, CURBy, Tezos and RANDAO, `drandRoundAt`, `drandRoundTime`, `DRAND_CHAINS`, drand `verify: 'structural'`, NIST-family `verify: true | 'hash'`, and the `truerng`/`onerng` serial presets.
  - Known issue: since pulse 2/1925734 (2026-09-03) NIST pulses carry 512-byte signatures but name a 2048-bit certificate, so `nistBeacon({ verify: true })` fails with `verification`; `verify: 'hash'` passes.
