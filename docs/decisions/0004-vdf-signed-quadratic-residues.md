# 0004: The VDF works in the signed quadratic residues $QR_n^+$

- Status: accepted
- Date: 2026-09-17
- Deciders: Manuel Haller Polo (maintainer)

## Context and problem statement

`@mindpeeker/vdf` evaluates $y = x^{2^T} \bmod n$ in an RSA group of unknown order and proves
the result with Pietrzak's halving protocol. A verifiable delay function must have a
**unique** valid output. The 0.1.0 documentation said the group was
$\mathbb{Z}_n^\times/\{\pm 1\}$, but the code computed on raw representatives in
$\mathbb{Z}_n^\times$, where $-1$ has order 2. As a result `pietrzakVerify` accepted $n - y$
as the output for every delay $T$ that is not a power of two (reproduced for $T = 3, 5, 1000$;
for a power of two the sign is squared away). A test that forges sign-flipped outputs and
midpoints failed 15 of 15 cases on the 0.1.0 code. The 0.1.0 README's soundness statements
("tampered bits verify false", "works in $\mathbb{Z}_n^\times/\{\pm 1\}$") did not hold.

## Decision drivers

- Uniqueness: exactly one output may verify for a given input, delay and modulus.
- Keep the existing RSA-2048 modulus and the Pietrzak prover, which users already depend on.
- Make proofs self-describing so that a verifier can refuse bytes from another version or
  modulus.

## Considered options

1. Keep $\mathbb{Z}_n^\times$ and document the sign ambiguity.
2. Switch to class groups of imaginary quadratic fields (no trusted setup, as in Chia).
3. **Work in the quotient by $\pm 1$ with canonical representatives: the signed quadratic
   residues $QR_n^+$.**

## Decision outcome

Chosen option 3. Option 1 leaves the VDF without uniqueness; option 2 is a new backend and is
recorded for a later release.

- Every group element is the canonical representative $|a| = \min(a, n - a)$ in
  $[1, (n-1)/2]$, and the group operation is $|a \cdot b \bmod n|$ (Hofheinz and Kiltz, *The
  Group of Signed Quadratic Residues and Applications*, CRYPTO 2009). `hashToGroup`,
  `evaluate` and both provers canonicalise.
- Verifiers reject any prover-supplied element outside $[1, (n-1)/2]$ or with an inadmissible
  Jacobi symbol (the rule is given in the vdf README). A test builds an order-2 element from
  the test modulus's factors and shows that a range-only check is not enough.
- The modulus is length-prefixed into every Fiat–Shamir transcript, and the domain tag is
  `mindpeeker-vdf-v2`.
- Wire format version 2: version byte `0x02`, a kind byte, an 8-byte modulus fingerprint; lengths
  are validated before allocation. Bytes from 0.1.0 throw `unsupported_version`; a proof for
  another modulus throws `modulus_mismatch`.
- The same release adds Wesolowski proofs (`wesolowskiProve`, `wesolowskiVerify`) and a modulus
  sanity check (`checkModulus`).

### Consequences

- Good: $y$ and $n - y$ are the same group element and only the canonical one verifies; the
  negation test passes.
- Bad: about half of all 0.1.0 outputs change value, and every stored 0.1.0 output, proof and
  seal is invalid under 0.2.0.
- Residual assumption: for a product of two safe primes $QR_n^+$ has no low-order elements.
  RSA-2048's primes are not known to be safe, so further small-order elements may exist; using
  one requires finding it, which Seres and Burcsi
  ([eprint 2020/402](https://eprint.iacr.org/2020/402)) relate to factoring for a
  non-negligible share of RSA moduli. Wesolowski proofs also rest on the adaptive root
  assumption.
- Limit that did not change: a VDF seal is a **no-earlier-than** bound on when a value was
  sealed. A no-later-than bound needs an external witness (a later beacon round, a timestamp
  service, an append-only log); `@mindpeeker/ledger` time brackets record both.

## More information

- Implementation: [`6420b8f`](https://github.com/Polobase/mindpeeker-sdk/commit/6420b8f35a13e7ca9590803d93669786d8eb1f24);
  the vdf README sections "The group: signed quadratic residues" and "Security assumptions".
- Ledger time brackets: [`9e3cf15`](https://github.com/Polobase/mindpeeker-sdk/commit/9e3cf151d7dde8871b928f7b0f80288ad9be3568).
- Security scope: [`SECURITY.md`](../../SECURITY.md).
