# @mindpeeker/vdf

Pietrzak verifiable delay function over an RSA group of unknown order.

A VDF is a function that takes a *prescribed amount of sequential time* to
evaluate — no amount of parallelism helps — yet whose output verifies in
logarithmic time. This package implements Pietrzak's construction
(*Simple Verifiable Delay Functions*, ITCS 2019) over the RSA-2048
factoring-challenge modulus:

$$y = x^{2^T} \bmod n, \qquad x = H'(\mathrm{input})^2 \bmod n$$

Zero dependencies, browser-safe (native `bigint`, `crypto.subtle` for
SHA-256 — hence async APIs), ESM. The modulus is pluggable everywhere via
`{ n: bigint }`.

## Quick start

```ts
import { calibrate, evaluate, pietrzakProve, pietrzakVerify } from '@mindpeeker/vdf'

// 1. Size T for YOUR hardware — never hardcode it (see Calibration below).
const cal = await calibrate()
const T = cal.suggestT(10_000) // ≈ 10 seconds of sequential squaring

// 2. Evaluate: T sequential squarings. Slow on purpose.
const input = new TextEncoder().encode('beacon pulse 2026-07-08T12:00Z')
const { y } = await evaluate(input, T)

// 3. Prove (≈ one more evaluate's worth of work), then anyone verifies in O(log T).
const proof = await pietrzakProve(input, T, y)
await pietrzakVerify(input, T, y, proof) // → true
```

Sealing a randomness-beacon pulse against front-running:

```ts
import { sealBeacon, verifySeal } from '@mindpeeker/vdf'

const seal = await sealBeacon(pulseBytes, T) // { T, y, proof }
await verifySeal(pulseBytes, seal) // → true
```

Any `@mindpeeker/entropy` beacon provider composes structurally — a seal
consumes pulse *bytes*, not provider objects; the packages share no imports.

## API

| export | what it does |
|---|---|
| `evaluate(input, T, opts?)` | $x = H'(\mathrm{input})^2$, then $y = x^{2^T} \bmod n$ by $T$ sequential squarings → `{ x, y }` |
| `pietrzakProve(input, T, y, opts?)` | halving proof `{ T, y, mus }` with $\lceil \log_2 T \rceil$ midpoints |
| `pietrzakVerify(input, T, y, proof, opts?)` | replay the transcript in $O(\log T)$ modular ops → `boolean` |
| `sealBeacon(pulse, T, opts?)` / `verifySeal(pulse, seal, opts?)` | freshness wrapper: evaluate + prove / consistency + verify |
| `proofToBytes(proof, opts?)` / `proofFromBytes(bytes, opts?)` | versioned fixed-width wire format (below) |
| `calibrate(sampleMs?, opts?)` | measured `squaringsPerSecond` + `suggestT(wallMs)` |
| `hashToGroup(input, modulus)` | the input mapping, exposed for interop |
| `fiatShamirChallenge(x, y, mu, T, modulus)` | the challenge derivation, exposed for interop |
| `RSA2048` | the default modulus (provenance below) |
| `pietrzakRounds(T)` | $\lceil \log_2 T \rceil$ via the exact ceiling-halving recursion |
| `VdfError` | `code: 'invalid_input' \| 'invalid_modulus' \| 'aborted'` |

All `opts` accept `modulus?: { n: bigint }` (default `RSA2048`); `evaluate`,
`pietrzakProve`, and `sealBeacon` also accept `signal?: AbortSignal` and
`onProgress?: (done, total)` (called every ~1024 squarings).

**Failure semantics** — a *wrong* proof or seal (tampered bits, forged
midpoints, mismatched claims) makes verification return `false`, never throw.
Only *malformed* arguments (wrong types, `T` outside $[1, 2^{32}-1]$, a bad
modulus) throw `VdfError`.

## The protocol

### Evaluation

`hashToGroup` maps input bytes to the group by counter-mode SHA-256
expansion to the modulus width, reduction mod $n$, and one squaring:
$x = H'(\mathrm{input})^2 \bmod n$. Then `evaluate` computes $T$ squarings:

$$x \to x^2 \to x^4 \to \dots \to x^{2^T} = y \pmod n$$

Each squaring depends on the previous one; without the factorization of $n$
there is no known shortcut (Rivest–Shamir–Wagner time-lock puzzles, 1996).
With the factorization the whole chain collapses to
$x^{2^T \bmod \varphi(n)}$ — which is exactly how the test suite
cross-checks `evaluate` against a known-factorization modulus in
milliseconds.

### The halving proof

To prove $y = x^{2^T}$ without the verifier redoing $T$ squarings, Pietrzak
halves the claim $\lceil \log_2 T \rceil$ times. One round, starting from
the claim $y_i = x_i^{2^{T_i}}$ with $t = \lceil T_i/2 \rceil$:

1. The prover sends the midpoint $\mu_i = x_i^{2^{t}}$.
2. Challenge $r_i = H(x_i, y_i, \mu_i, T_i)$ (Fiat–Shamir, 128 bits).
3. If $T_i$ is odd, square once: $\hat y_i = y_i^2$ (else $\hat y_i = y_i$).
4. Fold both half-claims into one of half the length:

$$x_{i+1} = x_i^{r_i}\,\mu_i, \qquad y_{i+1} = \mu_i^{r_i}\,\hat y_i, \qquad T_{i+1} = t$$

Why folding works (even case, $T_i = 2t$): if the prover was honest,
$\mu_i = x_i^{2^t}$ and $y_i = (x_i^{2^t})^{2^t}$, so

$$\mu_i^{r_i} y_i = x_i^{r_i 2^t} x_i^{2^{2t}} = (x_i^{r_i} \mu_i)^{2^t} = x_{i+1}^{2^t}.$$

The odd case first squares the claim $y_i = x_i^{2^{2t-1}}$ into the even
claim $\hat y_i = x_i^{2^{2t}}$ — the standard handling, matching the
Chia / POA Networks implementations. Recursion stops at $T = 1$, where the
verifier checks $y_{\text{final}} = x_{\text{final}}^2 \bmod n$ directly. A
cheating prover survives each round with probability $\approx 3 \cdot 2^{-128}$
(for a group without low-order elements), so the whole proof is sound up to
a negligible union bound over $\log_2 T$ rounds.

The verifier only recomputes challenges and foldings — $2\lceil \log_2 T\rceil$
exponentiations with 128-bit exponents, independent of $T$.

**Midpoint strategy**: `pietrzakProve` *recomputes* each $\mu_i$ by $t$
sequential squarings of the folded $x_i$ ($T/2 + T/4 + \dots \approx T$
extra squarings total, $O(1)$ memory). Checkpointing powers of $x$ during
`evaluate` would trade $O(\sqrt T)$–$O(T/\log T)$ memory for near-zero
recompute; for the tested range $T \le 2^{20}$, recompute-per-round costs
about one extra `evaluate` and keeps the API stateless. Revisit if you need
$T \gg 2^{24}$.

### Transcript encoding (normative)

Every hash is SHA-256 over length-prefixed big-endian fields with the
domain-separation tag `'mindpeeker-vdf-v1'`; `LP(f)` = 4-byte big-endian
length, then the bytes:

- group mapping, block $i$:
  `SHA256(LP(tag) ‖ LP('group') ‖ LP(input) ‖ LP(u32be(i)))`, blocks
  concatenated and truncated to the modulus byte width, reduced mod $n$,
  then squared.
- challenge:
  `SHA256(LP(tag) ‖ LP('challenge') ‖ LP(x_i) ‖ LP(y_i) ‖ LP(μ_i) ‖ LP(u32be(T_i)))`,
  first 16 bytes as a big-endian integer. $x_i, y_i, \mu_i$ are fixed-width
  big-endian at the modulus byte length; $y_i$ is the round-*start* value
  (before the odd-$T$ squaring).

The test fixtures are generated by an independent Python mirror of this
encoding (`scripts/fixtures/generate.py`) — a byte-level cross-check of
`hashToGroup`, the challenges, and full proofs.

### Wire format

`proofToBytes` (all big-endian, element width $w$ = modulus byte length):

```
[0]    version = 0x01
[1..5) T as u32
[5..5+w)          y
[5+w(1+i) ..)     μ_{i+1}, i = 0 … ceil(log2 T) − 1
```

`proofFromBytes` rejects wrong versions and any length other than exactly
$5 + w(1 + \lceil \log_2 T \rceil)$. A 2048-bit modulus at $T \approx 10^6$
gives proofs of $5 + 256 \cdot 21 = 5381$ bytes.

## Security assumptions

- **Unknown group order.** Sequentiality holds only if nobody knows
  $\varphi(n)$. RSA-2048 is the modulus of the RSA Factoring Challenge
  (RSA Laboratories, launched 1991, withdrawn 2007, unfactored to this day);
  RSA Labs stated the challenge moduli were generated on an air-gapped
  machine and the primes destroyed after generation. That is a *trust
  statement, not a proof* — there was no public ceremony. If that residual
  trust is unacceptable, plug in your own modulus (`{ n: bigint }`), e.g.
  one from a multi-party RSA generation ceremony.
- **Low-order elements.** Pietrzak's soundness argument needs the working
  group to have no small-order elements: otherwise a cheating prover can
  multiply midpoints by an element of small order and survive the folds
  with noticeable probability. `hashToGroup` therefore *squares* into
  $QR_n$; for $n$ a product of two safe primes, $QR_n$ is cyclic of odd
  order $\varphi(n)/4$ with no low-order structure. (RSA-2048's primes are
  not certified safe primes — the standard practical stance, shared by
  Chia-style deployments, is that finding a low-order element is as hard as
  factoring.) The verifier additionally range-checks every element into
  $[1, n)$, which kills the trivial $\mu = 0$ / $\mu = n k$ forgeries —
  there is a regression test for exactly that.
- **Fiat–Shamir.** Challenges are 128-bit SHA-256 truncations bound to
  $(x_i, y_i, \mu_i, T_i)$ and the domain tag; soundness holds in the
  random-oracle model (Boneh–Bünz–Fisch, *A Survey of Two Verifiable Delay
  Functions*, 2018).
- **What a seal means.** `sealBeacon(pulse, T)`'s guarantee: nobody —
  regardless of parallelism or foreknowledge of the pulse — can know $y$
  earlier than $\approx T$ sequential squarings after the pulse bytes were
  fixed. It does *not* make a bad beacon good: if the pulse itself was
  predictable, the seal only delays its consumption.

## Calibration — T is a deployment parameter

**Warning: never ship a hardcoded $T$.** The wall-clock meaning of $T$ is
"$T$ squarings on the *fastest* sequential hardware anyone owns", and
native-bigint squaring speed spans more than an order of magnitude across
CPUs and runtimes. Measured on this package's dev machine (Bun, Apple
Silicon): ≈ 66k squarings/s at 2048 bits, ≈ 2.1M squarings/s at 256 bits.
Dedicated hardware (the Chia ASIC efforts, VDF Alliance FPGA work) is
~10–100× faster than a general-purpose CPU at modular squaring — budget
your delay accordingly:

```ts
const cal = await calibrate(500)
const T = cal.suggestT(60_000) // 60 s on THIS machine
// against faster adversaries, treat the real lower bound as T / (their speedup)
```

`bun scripts/bench.ts` prints squarings/sec and full pipeline timings.

## Caveats

- **Not constant-time.** Native `bigint` arithmetic leaks timing; a VDF's
  inputs and outputs are public by design, so this is out of scope — but do
  not repurpose the internals for secret-dependent math.
- **Proving costs ≈ 2×.** With the recompute strategy, `sealBeacon` does
  about $2T$ squarings total ($T$ evaluate + $\approx T$ midpoints).
- **`T ≤ 2^32 − 1`** (wire-format u32). At 2048 bits that is ~18 hours of
  delay on the measured hardware — raise the format version before you need
  more.
- **Abort granularity.** `signal` is checked every 1024 squarings and the
  loop yields to the event loop every ~16k squarings, so cancellation lands
  within tens of milliseconds, not instantly.
- **Verification is $O(\log T)$ but not free**: ~110 ms at 2048 bits for
  $T = 5 \times 10^4$ (16 rounds) on the dev machine — fine for beacons,
  budget for hot paths.
