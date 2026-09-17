# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 0.2.x | yes |
| 0.1.x | no. Upgrade: the 0.1.0 `@mindpeeker/vdf` verifier accepted a forged output (see below) |

Fixes are released for the latest 0.2.x version of each package.

## Reporting a vulnerability

Report privately through GitHub's private vulnerability reporting:
<https://github.com/Polobase/mindpeeker-sdk/security/advisories/new>. Do not open a public
issue for a suspected vulnerability.

Please include the package and version, a minimal reproduction (a `bun -e` script or a test),
what an attacker gains, and any conditions it needs (a malicious beacon mirror, a crafted proof,
a page in the same browser). The project has a single maintainer; reports are handled on a
best-effort basis, and you will be credited in the advisory unless you ask not to be.

## Scope

These properties are security claims of the SDK. A way to break them is a vulnerability.

| Area | Package | Claim |
|---|---|---|
| VDF soundness | `vdf` | `pietrzakVerify`, `wesolowskiVerify`, `verifySeal` and `verifySealBytes` accept only the unique canonical output for the given input, delay and modulus. A forged or non-canonical output or proof that verifies, a proof accepted under a different modulus or version, or a parser that allocates before validating lengths is in scope. The 0.1.0 verifier accepted `n − y` for every delay that is not a power of two; 0.2.0 fixes this (see [decision 0004](docs/decisions/0004-vdf-signed-quadratic-residues.md)). |
| Ledger verification | `ledger` | `verifyChain`, `verifyInclusion`, `verifyConsistency`, `verifyNote`, `verifyCheckpoint` and `verifyTimeBracket` report tampering. A modified, reordered, truncated or spliced record that verifies, an RFC 8785 canonicalization that maps two different values to the same bytes, or a signature reported as `verified` when it was not checked is in scope. |
| Entropy provenance and credit | `entropy` | Output labelled as a private physical or quantum source comes from that source, health tests run on every raw sample, and the credited min-entropy is never more than the documented rate. Constant or predictable bytes delivered as TRNG output (0.1.0 did this for `safetyFactor ≤ 0`), health tests that are silently disabled, attribution (`sources`, `rounds`) that names the wrong provider or round, and API keys that leak into error messages are in scope. |
| Beacon verification | `entropy` | With `verify` enabled, NIST-family pulses must pass the output hash, chain linkage and, for `verify: true`, the certificate id and RSA signature checks; `drand` with `verify: 'structural'` must match the pinned chain parameters. A forged pulse or round that passes an enabled check is in scope. |
| Local dashboard server | `visualizer` | The `/ws` endpoint refuses browser pages from other origins unless listed in `allowedOrigins`, refuses non-loopback `Host` headers on a loopback bind (DNS rebinding), and closes a socket that sends messages. A web page that can read a dashboard's streams without being allowed is in scope. |

Denial of service through inputs that the documented validation should reject (an option
value that hangs a call or allocates unbounded memory) is also in scope for every package.

## What is not a vulnerability

- **A statistical test that fails to detect a bad source.** Health tests and randomness
  statistics can only fail a source; passing them never certifies that bytes are
  unpredictable. The documented false-alarm rates (for example the SP 800-90B cutoffs at
  α = 2⁻²⁰ per sample) are expected behaviour.
- **Nominal false positives.** A p-value below α on correct data happens at rate α. Report it
  only if a null calibration shows a rate above the documented one; that is a correctness bug,
  filed as a normal issue.
- **Disagreement about contested hypotheses.** Whether psi effects, radionics, gematria
  correspondences or sidereal-time effects exist is a scientific question, not a security
  issue. Use the research-claim review issue template.
- **Documented limits of verification.** drand BLS signatures and CURBy JWS signatures are not
  verified; a NIST-family signature is bound only to the certificate the beacon names, with no
  X.509 chain or revocation checking; public beacons are public, so their bytes are never
  secret; chain beacons carry the caveats listed in the entropy README (for example, RANDAO
  and Bitcoin outputs can be biased by block producers). The VDF gives a no-earlier-than bound only, and its security rests on documented
  assumptions about the RSA modulus. These are listed in the package READMEs.
- **Operator-side beacon problems.** Outages, certificate mismatches or TLS misconfiguration
  at a beacon operator (for example, NIST pulses since 2/1925734 carry signatures that do not
  match their named certificate, so `verify: true` fails) are reported to the operator; the
  SDK's job is to fail closed, which it does.
- **Things that are not cryptography by design.** `drbgProvider` is deterministic for a given
  seed; `rateMask` and `xorImprint` in `@mindpeeker/rate` are public, reversible transforms.
- **A dashboard deliberately exposed.** Binding the visualizer to a public interface, or
  listing an untrusted origin in `allowedOrigins`, shares the streams by configuration.
- **Firmware sketches** under `packages/entropy/firmware/` are community-verified references,
  not published packages.
