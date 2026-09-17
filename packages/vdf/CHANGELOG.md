# @mindpeeker/vdf

## 0.2.0

### Minor Changes

- Security fix: 0.1.0's verifier accepted the negated output n − y with a re-derived proof, so whoever computed a seal could pick either of two "verified" values. The group is now the signed quadratic residues QR_N+, transcripts and proof bytes use protocol v2, and Wesolowski proofs are new. Recompute every output, proof and seal stored under 0.1.0.

  - BREAKING (security): `pietrzakVerify` and `verifySeal` return `false` for a non-canonical `y` or midpoint μ (above (n − 1)/2) and for an element with an inadmissible Jacobi symbol. 0.1.0 accepted `n − y` for every non-power-of-two `T`, and for power-of-two `T` with sign-flipped midpoints.
  - BREAKING: `hashToGroup`, `evaluate` and the provers return the canonical element in [1, (n − 1)/2]; about half of all 0.1.0 outputs change value. `pietrzakProve` throws `invalid_input` for a `y` outside that range (0.1.0 accepted [1, n)).
  - BREAKING: `DOMAIN_TAG` is `'mindpeeker-vdf-v2'` and every hash binds the modulus, so `hashToGroup`, `fiatShamirChallenge` and every proof differ from 0.1.0.
  - BREAKING: wire format v2. `PROOF_VERSION` is `0x02`; proofs carry a kind byte and an 8-byte modulus fingerprint (14-byte header, was 5). 0.1.0 proof bytes throw `VdfError('unsupported_version')`, bytes made for another modulus throw `modulus_mismatch`, and `proofFromBytes` rejects input longer than the largest possible proof before allocating.
  - BREAKING: `VdfErrorCode` gains `unsupported_version` and `modulus_mismatch`; `aborted` errors carry `signal.reason` as `cause`.
  - BREAKING: progress events. `evaluate` reports completion once (0.1.0 reported `(T, T)` twice); `pietrzakProve` reports over `pietrzakProveCost(T, interval)`; `sealBeacon` reports one increasing sequence with total `T + pietrzakProveCost(T, interval)`.
  - BREAKING: `calibrate` treats `sampleMs` as the total budget, splits it into `samples` windows (default 5), measures through `sequentialSquare` including yields and reports the median.
  - BREAKING: `engines.node` is `>=20.19` (was `>=20.3`).
  - `sealBeacon` keeps ⌈√T⌉ checkpoints by default: the same seals with far less proving work and O(√T) memory.
  - Cooperative yields use `scheduler.yield`, `setImmediate` or `MessageChannel` instead of `setTimeout(0)`. SHA-256 is a built-in synchronous implementation checked against FIPS 180-4 vectors, so `crypto.subtle` is no longer needed. Byte inputs are copied at the API boundary.
  - New: `wesolowskiProve`, `wesolowskiVerify`, `hashToPrime`, `wesolowskiToBytes`, `wesolowskiFromBytes`, `sealToBytes`, `sealFromBytes`, `verifySealBytes`, `checkModulus`, `pietrzakProveCost`, `modulusFingerprint`, the `checkpoints` options of `evaluate`, the provers and `sealBeacon`, `suggestT(wallMs, { adversarySpeedup })`, and the constants `MAX_T`, `MIN_MODULUS_BITS`, `RECOMMENDED_MODULUS_BITS`, `CHALLENGE_PRIME_BITS`, `FINGERPRINT_BYTES`.
  - Documentation corrections: 0.1.0 described the group as Z_n*/{±1} but did not implement it; a seal proves a no-earlier-than bound only (a no-later-than bound needs an external witness); the low-order-element assumption for RSA groups is attributed to Seres and Burcsi; hardware adversaries are hundreds of times faster than this package, not 10–100 times.
