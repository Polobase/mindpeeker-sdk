# @mindpeeker/vdf

Verifiable delay functions over an RSA group of unknown order — Pietrzak's
halving proofs and Wesolowski's constant-size proofs, in the signed quadratic
residues $QR_n^+$.

A VDF is a function that takes a *prescribed amount of sequential time* to
evaluate — no amount of parallelism helps — yet whose output verifies quickly and
is **unique**: for every input and delay exactly one output is accepted. This
package implements Pietrzak's construction (*Simple Verifiable Delay Functions*,
ITCS 2019) and Wesolowski's (*Efficient Verifiable Delay Functions*, EUROCRYPT
2019) over the RSA-2048 factoring-challenge modulus:

$$y = \big|x^{2^T} \bmod n\big|, \qquad x = \big|H'(\mathrm{input})^2 \bmod n\big|, \qquad |a| = \min(a, n - a)$$

Zero dependencies, browser-safe (native `bigint`, a built-in SHA-256), ESM. The
modulus is pluggable everywhere via `{ n: bigint }`.

## Quick start

```ts
import { calibrate, evaluate, pietrzakProve, pietrzakVerify } from '@mindpeeker/vdf'

// 1. Size T for YOUR hardware — never hardcode it (see Calibration below).
const cal = await calibrate()
const T = cal.suggestT(10_000) // ≈ 10 seconds of sequential squaring on this machine

// 2. Evaluate: T sequential squarings. Slow on purpose. Keep √T checkpoints for the prover.
const input = new TextEncoder().encode('beacon pulse 2026-07-08T12:00Z')
const { y, checkpoints } = await evaluate(input, T, { checkpoints: Math.ceil(Math.sqrt(T)) })

// 3. Prove (a fraction of T with checkpoints), then anyone verifies in O(log T).
const proof = await pietrzakProve(input, T, y, { checkpoints })
await pietrzakVerify(input, T, y, proof) // → true
```

Constant-size proofs (one group element, 526 bytes at 2048 bits, two exponentiations to verify):

```ts
import { evaluate, wesolowskiProve, wesolowskiVerify } from '@mindpeeker/vdf'

const input = new TextEncoder().encode('registration digest')
const T = 100_000
const { y, checkpoints } = await evaluate(input, T, { checkpoints: 317 })
const proof = await wesolowskiProve(input, T, y, { checkpoints }) // { T, y, pi }
await wesolowskiVerify(input, T, y, proof) // → true
```

Sealing a randomness-beacon pulse, and shipping the seal as bytes:

```ts
import { sealBeacon, sealToBytes, verifySeal, verifySealBytes } from '@mindpeeker/vdf'

const pulseBytes = new TextEncoder().encode('nist-pulse 2026-07-08T12:00:00Z')
const seal = await sealBeacon(pulseBytes, 100_000) // { T, y, proof }
await verifySeal(pulseBytes, seal) // → true

const bytes = sealToBytes(seal, pulseBytes) // version, modulus fingerprint, SHA-256(pulse), T, y, proof
await verifySealBytes(pulseBytes, bytes) // → true
```

Any `@mindpeeker/entropy` beacon provider composes structurally — a seal
consumes pulse *bytes*, not provider objects; the packages share no imports.

## API

| export | what it does |
|---|---|
| `evaluate(input, T, opts?)` | $x = \lvert H'(\mathrm{input})^2\rvert$, then $y = \lvert x^{2^T}\rvert$ by $T$ sequential squarings → `{ x, y, checkpoints? }` |
| `pietrzakProve(input, T, y, opts?)` | halving proof `{ T, y, mus }` with $\lceil \log_2 T \rceil$ midpoints |
| `pietrzakVerify(input, T, y, proof, opts?)` | replay the transcript in $O(\log T)$ modular ops → `boolean` |
| `pietrzakProveCost(T, checkpointInterval?)` | exact squarings `pietrzakProve` performs (its progress total) |
| `pietrzakRounds(T)` | $\lceil \log_2 T \rceil$ via the exact ceiling-halving recursion |
| `wesolowskiProve(input, T, y, opts?)` / `wesolowskiVerify(input, T, y, proof, opts?)` | constant-size proof `{ T, y, pi }` / two-exponentiation check |
| `sealBeacon(pulse, T, opts?)` / `verifySeal(pulse, seal, opts?)` | freshness wrapper: evaluate + prove (√T checkpoints) / consistency + verify |
| `proofToBytes` / `proofFromBytes` | Pietrzak wire format (below) |
| `wesolowskiToBytes` / `wesolowskiFromBytes` | Wesolowski wire format |
| `sealToBytes(seal, pulse, opts?)` / `sealFromBytes(bytes, opts?)` / `verifySealBytes(pulse, bytes, opts?)` | self-describing seal format with the pulse's SHA-256 |
| `calibrate(sampleMs?, opts?)` | median `squaringsPerSecond`, per-window `samples`, `suggestT(wallMs, { adversarySpeedup })` |
| `checkModulus(modulus, { minBits }?)` | `{ ok, bits, reasons[] }` — rejects obviously broken custom moduli |
| `hashToGroup(input, modulus)` / `fiatShamirChallenge(x, y, mu, T, modulus)` / `hashToPrime(x, y, T, modulus)` / `modulusFingerprint(modulus)` | the protocol's hashes, exposed for interop |
| `RSA2048` | the default modulus (provenance below) |
| `DOMAIN_TAG`, `PROOF_VERSION`, `PROGRESS_INTERVAL`, `MAX_T`, `MIN_MODULUS_BITS`, `RECOMMENDED_MODULUS_BITS`, `CHALLENGE_PRIME_BITS`, `FINGERPRINT_BYTES` | protocol constants |
| `VdfError` | `code: 'invalid_input' \| 'invalid_modulus' \| 'aborted' \| 'unsupported_version' \| 'modulus_mismatch'` |

All `opts` accept `modulus?: { n: bigint }` (default `RSA2048`). `evaluate`,
both provers, `sealBeacon`, and `calibrate` accept `signal?: AbortSignal`; the
first four accept `onProgress?: (done, total)`, called roughly every 1024 work
units and **exactly once** with `done === total`. `sealBeacon` reports one
monotone sequence over evaluation *and* proof, with
`total = T + pietrzakProveCost(T, interval)`.

**Failure semantics** — a *wrong* proof or seal (tampered bits, forged or
negated elements, mismatched claims) makes verification return `false`, never
throw. Only *malformed* arguments (wrong types, `T` outside $[1, 2^{32}-1]$, a bad
modulus) throw `VdfError`. Byte parsers throw on any structural defect:
`unsupported_version` for bytes from another format version (including every
0.1.0 proof), `modulus_mismatch` for bytes made under another modulus,
`invalid_input` otherwise.

## The protocol

### The group: signed quadratic residues $QR_n^+$

Every group element is a canonical representative $|a| = \min(a, n-a)$ in
$[1, (n-1)/2]$, and the group operation is $|a \cdot b \bmod n|$ (Hofheinz–Kiltz,
*The Group of Signed Quadratic Residues and Applications*, CRYPTO 2009; the group
Pietrzak's paper works in). Canonicalisation
identifies $a$ with $-a$: the order-2 element $-1$ of $\mathbb{Z}_n^\times$
becomes the identity, so $y$ and $n - y$ are *the same* element and only the
canonical one is ever accepted.

The verifiers additionally require an admissible Jacobi symbol for every
prover-supplied element: $\left(\frac{a}{n}\right) = 1$ when $n \equiv 1 \pmod 4$
(every honest element is $\pm$ a square, and $\left(\frac{-1}{n}\right) = 1$). For
a Blum integer $n = pq$, $p \equiv q \equiv 3 \pmod 4$, this is exactly membership
in $QR_n^+$, which for safe primes has odd order $p'q'$ and no element of order 2.
The test suite demonstrates that the check is load-bearing: with the test
modulus's factors it builds an order-2 element $w \ne \pm 1$ and a forged proof
that passes a range-only verifier — `pietrzakVerify` and `wesolowskiVerify` reject
it.

### Evaluation

`hashToGroup` maps input bytes to the group by counter-mode SHA-256 expansion to
the modulus width, reduction mod $n$, one squaring, and canonicalisation. Then
`evaluate` computes $T$ squarings:

$$x \to x^2 \to x^4 \to \dots \to x^{2^T} \pmod n, \qquad y = |x^{2^T}|$$

Each squaring depends on the previous one; without the factorization of $n$ there
is no known shortcut (Rivest–Shamir–Wagner time-lock puzzles, 1996). With the
factorization the chain collapses to $x^{2^T \bmod \varphi(n)}$ — which is how
the test suite cross-checks `evaluate` in milliseconds. With
`{ checkpoints: k }` it keeps every $\lceil T/k \rceil$-th power ($k$ group
elements of memory, no extra squarings).

### The halving proof (Pietrzak)

To prove $y = x^{2^T}$ without the verifier redoing $T$ squarings, the claim is
halved $\lceil \log_2 T \rceil$ times. One round, from the claim
$y_i = x_i^{2^{T_i}}$ with $t = \lceil T_i/2 \rceil$:

1. The prover sends the midpoint $\mu_i = |x_i^{2^{t}}|$.
2. Challenge $r_i = H(n, x_i, y_i, \mu_i, T_i)$ (Fiat–Shamir, 128 bits).
3. If $T_i$ is odd, square once: $\hat y_i = |y_i^2|$ (else $\hat y_i = y_i$).
4. Fold both half-claims into one of half the length:

$$x_{i+1} = |x_i^{r_i}\,\mu_i|, \qquad y_{i+1} = |\mu_i^{r_i}\,\hat y_i|, \qquad T_{i+1} = t$$

Why folding works (even case, $T_i = 2t$): if the prover was honest,
$\mu_i^{r_i} y_i = x_i^{r_i 2^t} x_i^{2^{2t}} = (x_i^{r_i} \mu_i)^{2^t} = x_{i+1}^{2^t}$
(up to sign, which canonicalisation removes). The odd case first squares the
claim $x_i^{2^{2t-1}}$ into the even claim $x_i^{2^{2t}}$. Recursion stops at
$T = 1$, where the verifier checks $y_{\text{final}} = |x_{\text{final}}^2|$. In a
group without low-order elements a cheating prover survives a round with
probability $\approx 3 \cdot 2^{-128}$ (Pietrzak), so the whole proof is sound up
to a negligible union bound over $\le 32$ rounds. The verifier performs
$2\lceil \log_2 T\rceil$ exponentiations with 128-bit exponents plus the
membership checks.

**Midpoints and checkpoints.** Without checkpoints each $\mu_i$ is recomputed by
$t$ squarings of $x_i$ ($\approx T$ extra squarings, $O(1)$ memory). With
checkpoints, round $i$'s midpoint unfolds into $2^i$ leaves
$x^{2^{e_S}}$, $e_S = t_i + \sum_{j \in S} t_j$, each a few squarings from a stored
power, recombined with the earlier challenges. A deterministic plan uses that
path while it costs fewer multiplications than recomputing; the proof is
identical either way. With $\sqrt T$ checkpoints the proving squarings drop from
$\approx T$ to a few percent of $T$ or less — 50 006 → 5 171 at $T = 5 \times 10^4$,
1 000 014 → 43 354 at $T = 1\,000\,003$, 1 048 575 → 16 383 at $T = 2^{20}$ — plus
the fold exponentiations (`pietrzakProveCost` gives the exact count).

### Constant-size proofs (Wesolowski)

With the challenge prime $\ell = \mathrm{HashToPrime}(n, x, y, T)$, the proof is
the single element $\pi = |x^{\lfloor 2^T/\ell \rfloor}|$ and the verifier checks

$$\big|\pi^{\ell} \cdot x^{\,2^T \bmod \ell}\big| = y ,$$

which holds because $\ell \lfloor 2^T/\ell \rfloor + (2^T \bmod \ell) = 2^T$. Both
$y$ and $\pi$ must be canonical: $(n - \pi)^\ell = -\pi^\ell$ for odd $\ell$, so a
sign-blind verifier would accept two proofs.

- **HashToPrime**: candidate $j$ is SHA-256 of the transcript
  `(tag, 'prime', n, x, y, u32be(T), u32be(j))` with bit 255 and bit 0 forced; $\ell$
  is the first candidate passing trial division by the primes below 2000 and
  strong Miller–Rabin to the 32 fixed bases $2, 3, 5, \dots, 131$. Fixed bases
  make the choice deterministic for prover and verifier; the candidates are hash
  outputs, so the base set cannot be targeted (per-base error $\le 1/4$, Rabin
  1980, far smaller for random odd integers, Damgård–Landrock–Pomerance 1993).
  256-bit primes follow Boneh–Bünz–Fisch's $\ell \in \mathrm{Primes}(2\lambda)$ for
  $\lambda = 128$.
- **Prover**: without checkpoints, windowed long division in the exponent
  ($\rho \leftarrow 2^8\rho \bmod \ell$, digit $\lfloor 2^8\rho/\ell \rfloor$,
  $\pi \leftarrow \pi^{2^8} x^{\mathrm{digit}}$): $T$ squarings + $T/8$ multiplies.
  With checkpoints $C_i = x^{2^{ic}}$, $\lfloor 2^T/\ell \rfloor = \sum_i d_i 2^{ic}$
  and $\pi = \prod_i C_i^{d_i}$ is a bucket multi-exponentiation whose window
  digits come from per-base long-division remainders (≈ $0.18\,T$ multiplications
  at $T = 2^{20}$ with $\sqrt T$ checkpoints).
- **Assumption**: soundness rests on the *adaptive root assumption* (Boneh–Bünz–Fisch,
  *A Survey of Two Verifiable Delay Functions*, eprint 2018/712), stronger than
  Pietrzak's; in exchange proofs are constant-size and verification is two
  exponentiations.

### Transcript encoding (normative)

Every hash is SHA-256 over length-prefixed big-endian fields opened by the
domain-separation tag `'mindpeeker-vdf-v2'`, a context string, and the modulus;
`LP(f)` = 4-byte big-endian length, then the bytes; elements and $n$ are
fixed-width at the modulus byte length $w$:

- group mapping, block $i$: `SHA256(LP(tag) ‖ LP('group') ‖ LP(n) ‖ LP(input) ‖ LP(u32be(i)))`,
  blocks concatenated and truncated to $w$ bytes, reduced mod $n$, squared, canonicalised.
- Pietrzak challenge: `SHA256(LP(tag) ‖ LP('challenge') ‖ LP(n) ‖ LP(x_i) ‖ LP(y_i) ‖ LP(μ_i) ‖ LP(u32be(T_i)))`,
  first 16 bytes big-endian; $y_i$ is the round-*start* value.
- Wesolowski prime candidate: `SHA256(LP(tag) ‖ LP('prime') ‖ LP(n) ‖ LP(x) ‖ LP(y) ‖ LP(u32be(T)) ‖ LP(u32be(j)))`.
- modulus fingerprint: `SHA256(LP(tag) ‖ LP('modulus') ‖ LP(n))[0..8)`.

The fixtures are generated by an independent Python mirror
(`scripts/fixtures/generate.py`, hashlib + integer arithmetic) — a byte-level
cross-check of every hash, full proofs, and the wire formats at 256 bits,
RSA-2048, and a 522-bit modulus whose bit length is not a multiple of 8.

### Wire formats

All big-endian, element width $w$ = modulus byte length:

```
proof (Pietrzak)    [0]=0x02 [1]=0x50 'P' [2..10) fingerprint [10..14) T   [14..14+w) y   then ⌈log2 T⌉ × μ
proof (Wesolowski)  [0]=0x02 [1]=0x57 'W' [2..10) fingerprint [10..14) T   [14..14+w) y   [14+w..14+2w) π
seal                [0]=0x02 [1]=0x53 'S' [2..10) fingerprint [10..42) SHA-256(pulse) [42..46) T  [46..) y, μ…
```

Parsers check the input length against the largest possible encoding *before*
allocating, then version (`unsupported_version`), kind, fingerprint
(`modulus_mismatch`), $T \ge 1$, and exact length. Sizes at 2048 bits: Pietrzak
$14 + 256(1 + \lceil \log_2 T \rceil)$ (4366 bytes at $T = 5 \times 10^4$, 5390 at
$T \approx 10^6$), Wesolowski 526 bytes for any $T$.

## Security assumptions

- **Unknown group order.** Sequentiality holds only if nobody knows
  $\varphi(n)$. RSA-2048 is the modulus of the RSA Factoring Challenge (RSA
  Laboratories, launched 1991, withdrawn 2007, unfactored to this day); RSA Labs
  stated the challenge moduli were generated on an air-gapped machine and the
  primes destroyed. That is a *trust statement, not a proof* — there was no
  public ceremony. If that residual trust is unacceptable, plug in your own
  modulus (`{ n: bigint }`), e.g. one from a multi-party RSA generation ceremony,
  and run `checkModulus` on it.
- **Low-order elements.** Pietrzak's soundness argument needs a group without
  low-order elements; otherwise a cheating prover multiplies midpoints by one and
  survives the folds with noticeable probability. 0.1.0 worked on raw
  representatives, where $-1$ has order 2, and accepted $n - y$ — fixed in 0.2.0
  by $QR_n^+$ (above). For $n$ a product of two safe primes $QR_n^+$ has no
  low-order elements at all. **RSA-2048's primes are not known to be safe
  primes**, so $\mathbb{Z}_n^\times/\{\pm 1\}$ may contain further small-order
  elements; exploiting one requires *finding* it, and for RSA groups
  Seres–Burcsi (eprint 2020/402) show that finding low-order elements is as hard
  as factoring for a non-negligible portion of moduli. That is the residual
  assumption. (Chia's proof-of-time does not share it: Chia uses class groups of
  imaginary quadratic fields, where the corresponding assumption is less studied.)
- **Fiat–Shamir.** Challenges are SHA-256 outputs bound to the domain tag, the
  modulus, and the full round state; soundness holds in the random-oracle model.
  Wesolowski proofs additionally rely on the adaptive root assumption.
- **What a seal means — a lower bound only.** `sealBeacon(pulse, T)` guarantees
  that nobody — regardless of parallelism or foreknowledge — can know $y$ earlier
  than $T$ squarings *on the fastest hardware anyone owns* after the pulse bytes
  were fixed. It is a **no-earlier-than** bound: it says nothing about when the
  pulse was fixed or when $y$ was published. A **no-later-than** bound needs an
  external witness (a later beacon round that includes the seal, a timestamping
  service, a public append-only log). A seal also does not make a bad beacon good:
  if the pulse was predictable, the seal only delays its consumption.
- **Custom moduli.** `checkModulus` rejects moduli whose order is *obviously*
  known — even, too small (default policy 2048 bits), a prime factor below
  $2^{16}$, a perfect power, (probably) prime — and flags $n \equiv 3 \pmod 4$. It
  cannot certify a good modulus: safe-prime structure and whether anyone knows the
  factors are undecidable without the factorization.

## Calibration — T is a deployment parameter

**Warning: never ship a hardcoded $T$.** The wall-clock meaning of $T$ is
"$T$ squarings on the *fastest* sequential hardware anyone owns". `calibrate`
measures this machine through the same code path `evaluate` uses (squaring
blocks with their abort checks and cooperative yields), reports the median of
several windows, and `suggestT(wallMs, { adversarySpeedup })` converts a target
into $T$: an adversary `adversarySpeedup`× faster than this machine still needs
`wallMs`, while evaluating locally takes about `adversarySpeedup × wallMs`.

Reference squaring rates (for choosing `adversarySpeedup`):

| hardware | modulus | squarings / s | source |
|---|---|---|---|
| this package (Bun 1.3.1, Apple Silicon dev machine, unloaded) | 2048-bit | ≈ $5 \times 10^4$ | `bun scripts/bench.ts` |
| optimized CPU implementations | 2048-bit | $0.48$–$0.85 \times 10^6$ | arXiv 2308.01280 |
| FPGA (VDF Alliance competition, round 1) | 1024-bit | ≈ $4 \times 10^7$ (25.2 ns per squaring) | Jane Street, *Really low latency multipliers and cryptographic puzzles*; supranational/vdf-fpga-round1-results |

Optimized CPU code alone is 10–17× faster than this package; dedicated hardware
is hundreds of times faster (the FPGA figure is for 1024-bit squarings — 2048-bit
hardware is slower by a small factor). A prudent `adversarySpeedup` against
hardware adversaries is about **1000**:

```ts
import { calibrate } from '@mindpeeker/vdf'

const cal = await calibrate(1000)
const local = cal.suggestT(60_000) // 60 s on THIS machine
const guarded = cal.suggestT(60_000, { adversarySpeedup: 1000 }) // ≥ 60 s even for FPGA-class hardware
```

`bun scripts/bench.ts [T]` prints squarings per second and full pipeline timings
(both proof systems, with and without checkpoints).

## Caveats

- **Not constant-time.** Native `bigint` arithmetic leaks timing; a VDF's inputs
  and outputs are public by design, so this is out of scope — but do not repurpose
  the internals for secret-dependent math.
- **Proving cost.** Without checkpoints `pietrzakProve` recomputes ≈ $T$
  squarings and `wesolowskiProve` does $T$ squarings; with $\sqrt T$ checkpoints
  (the `sealBeacon` default) both are a small fraction of $T$, at the cost of
  $\sqrt T$ stored group elements (≈ 17 MB of element data at $T = 2^{32}$, 2048 bits).
- **`T ≤ 2^32 − 1`** (wire-format u32). At 2048 bits that is about a day of delay
  on the reference machine — raise the format version before you need more.
- **Abort granularity.** `signal` is checked every 1024 work units and the loop
  yields to the event loop every ~16k units (via `scheduler.yield`, `setImmediate`,
  `MessageChannel`, or `setTimeout`, in that order of preference), so cancellation
  lands within tens of milliseconds at 2048 bits.
- **Verification is cheap but not free**: Pietrzak does $2\lceil\log_2 T\rceil$
  128-bit exponentiations plus one Jacobi symbol per element; Wesolowski does one
  hash-to-prime and two ≤ 256-bit exponentiations — roughly 5× faster at
  $T = 5 \times 10^4$ on the dev machine.
- **Batch verification is not provided.** Batching Pietrzak's final equations
  saves nothing (the folds dominate); useful batching needs Wesolowski aggregation
  with a shared challenge, which is future work.

## Behaviour changes in 0.2.0

All of these are breaking for stored proofs or for code that pinned 0.1.0
values; the security fix makes that unavoidable.

- **Uniqueness fix (security).** 0.1.0 accepted the negated output $n - y$ with a
  re-derived proof for every non-power-of-two $T$ (and, with sign-flipped
  midpoints, for power-of-two $T$ too), giving a sealer a free choice between two
  "verified" values. The group is now $QR_n^+$: `hashToGroup`, `evaluate`, and the
  provers return canonical elements in $[1, (n-1)/2]$; `pietrzakVerify` and
  `verifySeal` return `false` for any non-canonical $y$ or $\mu_i$ or an
  inadmissible Jacobi symbol. About half of all 0.1.0 outputs were the
  non-canonical representative.
- **Provers reject non-canonical claims**: `pietrzakProve` (and the new
  `wesolowskiProve`) throw `invalid_input` for $y$ outside $[1, (n-1)/2]$ (0.1.0
  accepted $[1, n)$).
- **Protocol v2 transcripts**: `DOMAIN_TAG` is `'mindpeeker-vdf-v2'` and every hash
  binds the modulus, so `hashToGroup`, `fiatShamirChallenge`, and every proof
  differ from 0.1.0.
- **Wire format v2**: `PROOF_VERSION` is `0x02`; proofs carry a kind byte and an
  8-byte modulus fingerprint (14-byte header, was 5). 0.1.0 proof bytes throw
  `VdfError('unsupported_version')`; bytes from another modulus throw
  `VdfError('modulus_mismatch')`. `proofFromBytes` rejects inputs longer than the
  largest possible proof before allocating (0.1.0 could allocate gigabytes or leak
  a `RangeError`).
- **New error codes** `unsupported_version` and `modulus_mismatch` widen
  `VdfErrorCode`; `aborted` errors now carry `signal.reason` as `cause`.
- **Progress**: `evaluate` reports completion exactly once (0.1.0 reported
  `(T, T)` twice); `pietrzakProve` reports over `pietrzakProveCost(T, interval)`
  with one completion; `sealBeacon` reports one monotone sequence with total
  `T + pietrzakProveCost(T, interval)` (0.1.0 restarted from 0 with a new total
  halfway through).
- **`sealBeacon` stores $\lceil\sqrt T\rceil$ checkpoints by default**
  (`checkpoints` option) — identical seals, far less proving work, $O(\sqrt T)$
  memory.
- **`calibrate`** measures through `sequentialSquare` including yields,
  splits `sampleMs` into `samples` windows (default 5) and reports the median;
  the result gains `samples`, and `suggestT` accepts `{ adversarySpeedup }`.
- **Cooperative yield** uses `scheduler.yield` / `setImmediate` / `MessageChannel`
  instead of `setTimeout(0)` (no 1–4 ms clamp per yield).
- **SHA-256** is a built-in synchronous implementation (pinned to FIPS 180-4
  vectors and cross-checked against WebCrypto), so the package no longer needs
  `crypto.subtle` (unavailable in insecure browser contexts).
- **Inputs are copied** at the API boundary, so mutating a caller's buffer during
  a computation cannot change its result.
- **Documentation corrections**: the group is $QR_n^+$ (0.1.0 claimed
  $\mathbb{Z}_n^\times/\{\pm 1\}$ but did not implement it); RSA-2048 is not used by
  Chia (class groups); the low-order-element assumption is attributed to
  Seres–Burcsi for RSA groups; hardware margins are hundreds of ×, not 10–100×; a
  seal is a no-earlier-than bound only.
- **Additions**: `wesolowskiProve`, `wesolowskiVerify`, `hashToPrime`,
  `wesolowskiToBytes`, `wesolowskiFromBytes`, `sealToBytes`, `sealFromBytes`,
  `verifySealBytes`, `checkModulus`, `pietrzakProveCost`, `modulusFingerprint`,
  `evaluate`/prover `checkpoints`, and the constants `MAX_T`, `MIN_MODULUS_BITS`,
  `RECOMMENDED_MODULUS_BITS`, `CHALLENGE_PRIME_BITS`, `FINGERPRINT_BYTES`.
