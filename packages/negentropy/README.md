# @mindpeeker/negentropy

Measure order in noise, and manufacture order from noise.

Companion to [`@mindpeeker/entropy`](../entropy): where entropy *sources*
randomness, negentropy asks two questions about it —

1. **Is there any order in this noise, and when did it appear?**
   GCP-style network statistics, information-theoretic negentropy estimators,
   and a pre-registered experiment layer over live entropy streams.
2. **How do I concentrate raw noise into uniform bits?**
   Von Neumann/Peres debiasing, SP 800-90B vetted conditioning,
   Toeplitz-hashing extraction, and honest min-entropy accounting.

Zero dependencies, browser-safe (only `Math`, typed arrays,
`crypto.subtle`), ESM. Every `@mindpeeker/entropy` provider works as an
input source *structurally* — the packages share a shape, not code:

```ts
interface TrialSource {
  readonly name: string
  stream(opts?: { signal?: AbortSignal; chunkBytes?: number }): AsyncIterable<Uint8Array>
}
```

> Erwin Schrödinger described life as feeding on "negative entropy";
> Léon Brillouin shortened it to *negentropy*. Here it is a number: how far
> a stream sits from maximal disorder, and how much usable order you can
> pull back out of it.

## Detection: is there order in this noise?

The unit of analysis is the **trial** — the number of one-bits among
`bitsPerTrial` consecutive bits (default 200, the Global Consciousness
Project convention, so a trial is Binomial(200, ½): mean 100, variance 50).

```ts
import {
  trialsFromBytes, theoreticalCalibration, zScores,
  netvar, devvar, interSourceCorrelation,
  cumulativeDeviation, significanceEnvelope, stoufferZ,
} from '@mindpeeker/negentropy'

const series = trialsFromBytes(recordedBytes, 'anu')
const zs = zScores(series, theoreticalCalibration('anu'))
```

Network statistics over step-aligned z-matrices from N sources:

| statistic | question it asks | null distribution |
|---|---|---|
| `netvar` | do the sources deviate *together*? (GCP standard) | χ²(steps) |
| `devvar` | is any source's variance off on its own? | χ²(steps × N) |
| `interSourceCorrelation` | are pairwise products elevated? `pairs[]` gives each pair's `meanProduct` (also `r`) and `pearson` | N(0, 1) |
| `networkCoherence` | mean pairwise product per step (Bancel & Nelson's C1 form of netvar), with a plot-ready `perStep` curve and the same `pairs[]` | N(0, 1) |
| `clusteredNetvar` | within-cluster vs between-cluster deviation, for GCP 2.0's clustered hardware | χ²(steps) between + χ²(steps × clusters) within |
| `onsiteVsGlobal` | do an onsite and a global per-step stream correlate? | Fisher-z → N(0, 1) |

Naming and validity notes: GCP 2.0 (Plonka et al. 2026) calls netvar
"Network Coherence (Phase)" and the standardized device variance "Network
Coherence (Amplitude)" — `networkCoherence` here is the pairwise product, not
either of those. `pairs[].r`/`meanProduct` is an uncentered co-moment: a common
mean shift μ on uncorrelated sources reads ≈ μ², so use `pearson` for a
correlation. `onsiteVsGlobal`'s Fisher-z p-value assumes independent
observations — use increment series, not cumulative curves; the published GCP
2.0 r ≈ 0.27 is a *mean* Pearson r between cumulative Amplitude curves tested
against simulated controls, which this function does not reproduce.

`cumulativeDeviation(stoufferZs)` gives the classic cumsum(Z²−1) plot and
`significanceEnvelope(steps, p)` its χ²-quantile envelope — exact for the χ²
law, which for Binomial(k, ½) trials is itself the de Moivre–Laplace
approximation (Var(Z² − 1) = 2 − 2/k: ~1% at k = 200). **The envelope is
pointwise**: an H0 path crosses it *somewhere* far more often than p — only a
pre-registered endpoint carries the stated significance. (There is a test in
this repo that proves that caveat by simulation.)

Every statistic validates its inputs: a NaN or infinite z-score, trial sum or
statistic throws `NegentropyError('invalid_config')` naming the source, and a
calibration without a finite sd > 0 throws `calibration_required`. χ² p-values
are exact and O(1) at any df, including GCP network scale (60 sources × a day at
1 Hz → df ≈ 5·10⁶).

### Sequential monitoring (anytime-valid)

Watching a live cumulative-deviation plot and stopping when it "looks
significant" is optional stopping: the pointwise χ² envelope is crossed
*somewhere* by about 46% of 3000-step H0 paths. A **test martingale** M_t
(M₀ = 1, nonnegative, E[M_t | past] ≤ M_{t−1} under H0) removes the problem:
by Ville's inequality P_H0(∃t: M_t ≥ 1/α) ≤ α, so you may look after every
step and stop whenever you like.

```ts
import {
  netvarMartingale, netvarLogM, netvarBoundary, anytimeEnvelope,
  driftMartingale, driftBoundary, anytimeP, villeCrossing, cumulativeDeviation,
} from '@mindpeeker/negentropy'

// variance channel (netvar / cumdev): Gamma(1, 1) prior on the precision 1/Var Z
const logM = netvarMartingale(stoufferZs, { sided: 'upper' })
const p = anytimeP(logM)                 // running anytime-valid p-values
const stopAt = villeCrossing(logM, 0.01) // first index with M_t ≥ 100, or −1
const band = anytimeEnvelope(stoufferZs.length, 0.01, { sided: 'upper' })
const curve = cumulativeDeviation(stoufferZs) // crosses band.upper exactly when M_t ≥ 100

// live monitors keep t and D_t = Σ(Z² − 1): O(1) per tick
const e = Math.exp(netvarLogM(t, deviation, { sided: 'upper' }))
const { upper } = netvarBoundary(t, 0.01, { sided: 'upper' })

// mean-shift channel (Stouffer walk); λ is part of the pre-registration
const drift = driftMartingale(stoufferZs, { lambda: 100 })
const bound = driftBoundary(t, 0.05, 100) // |Σz| ≥ bound ⇔ M_t ≥ 20
```

| export | test martingale | time-uniform boundary |
|---|---|---|
| `netvarMartingale(z, { a, b, sided })`, `netvarLogM(t, D, …)` | Gamma(a, b) mixture over τ = 1/Var Z: ln M_t = S_t/2 + a ln b − lnΓ(a) + lnΓ(a + t/2) − (a + t/2) ln(b + S_t/2), S_t = ΣZ² = t + D_t; `'upper'` restricts τ < 1 (variance excess) and adds ln[P(a + t/2, b + S_t/2)/P(a, b)] | `netvarBoundary(t, α, …)`, `anytimeEnvelope(steps, α, …)`: D_t ≥ `upper` (or ≤ `lower`) ⇔ M_t ≥ 1/α. At α = 0.05, a = b = 1 (two-sided): 19.50, 52.31, 165.80 at t = 10, 100, 1000 — the pointwise envelope at t = 1000 is 74.68 |
| `driftMartingale(z, { lambda, sided })`, `driftLogM(t, S, …)` | N(0, 1/λ) mixture over the mean: M_t = √(λ/(t + λ))·exp(S_t²/(2(t + λ))), S_t = Σz; `'upper'` uses the half-normal prior (× 2Φ(S_t/√(t + λ))) | `driftBoundary(t, α, λ, sided)` = √((t + λ)·ln((t + λ)/(λα²))) (Robbins–Siegmund); `'upper'` by monotone root finding |
| `anytimeP(logM)` | p_t = min(1, 1/max_{s≤t} M_s) | P_H0(∃t: p_t ≤ α) ≤ α |
| `villeCrossing(logM, α)` | first index with M_t ≥ 1/α | type-I error ≤ α at any stopping time |

All values are computed in log space (no overflow on long streams, no
cancellation at t ≈ 10⁶), cross-checked against 40-digit mpmath closed forms
and bisection roots (`scripts/fixtures/sequential.py`); boundaries are always
reported on the conservative side of the exact root. The seeded tests run 1000
H0 paths of 3000 steps: every time-uniform boundary is crossed in ≤ 5% of them
(0.9–3.2%), the pointwise χ² envelope in 46% and the 1.96·√t parabola of the
Stouffer walk in 56%. References: Ville (1939); Robbins
(1970); Shafer, Shen, Vereshchagin & Vovk (2011); Howard, Ramdas, McAuliffe &
Sekhon (2021); Ramdas, Grünwald, Vovk & Shafer (2023).

Honest caveats:

- **What is exact.** For Gaussian Z every variant is a martingale with
  E[M_t] = 1 (checked by numerical integration). For independent fair-bit
  trials under theoretical calibration, netvar `'upper'` and both drift
  variants remain test *super*martingales — such z's are sub-Gaussian with
  variance proxy 1 (checked by exact enumeration of Binomial(8, ½) trials).
  Two-sided netvar also bets on variance *deficits*, where lattice trials are
  not dominated by the Gaussian (a prior on large precisions gives
  E[M₁] > 1 for 8-bit trials): there it is the de Moivre–Laplace
  approximation.
- **What voids it.** Empirical calibration, drifting hardware, serial
  correlation or misaligned steps break the H0 model, not just the p-value.
- **The price.** Anytime validity costs power at a fixed horizon (the band is
  ~2.2× the pointwise envelope at t = 1000). With a truly pre-registered
  endpoint the fixed-n χ² p-value is valid and more powerful.
- **Pre-register the bet.** a, b, λ, the side and α are part of the
  hypothesis; tuning them after looking is optional stopping again. The drift
  boundary relative to √t is tightest near t ≈ 8.2·λ (α = 0.05).

### GCP statistics

Additional analysis forms from the Global Consciousness Project literature,
over the same step-aligned z-matrices (finite z's; `invalid_config` otherwise):

| export | statistic | null |
|---|---|---|
| `covar(z, sources, { bitsPerTrial })` | correlation of variances (C2): Σₜ Σᵢ<ⱼ (zᵢ² − 1)(zⱼ² − 1) / √(T·P·v²), P pairs, v = Var z² = 2 − 2/k for Binomial(k, ½) under theoretical calibration (E z⁴ = 3 − 2/k), else 2; `perStep` curve | N(0, 1) upper tail (CLT) |
| `blockZ(zs, T)` | Σ over T-step blocks / √T (whole blocks only) | N(0, 1) per block |
| `blockedNetvar(z, sources, { T })` | Σ_B Z_B², Z_B = Σ_{t∈B} Σᵣ z_{t,r} / √(T·N) (Bancel & Nelson 2008, eqs. 4.1–4.2); T = 1 is `netvar` bit for bit | χ²(blocks) |
| `blockedDevvar(z, sources, { T })` | Σᵣ Σ_B Z_{B,r}², each source blocked alone; T = 1 is `devvar` | χ²(blocks × N) |
| `blockingDecomposition(stoufferZs, Ts)` | per T: event z, `expected` = z₀/√T (no autocorrelation), eq. 4.6's `autocorrelationTerm` √(2T₀/T³)·Σₗ(T − l)ρ(l) and `predicted`, `residualSd` = √(1 − 1/T) | descriptive |
| `networkAutocorrelation(series, maxLag, { p })` | lag z = ρ̂(l)·√n, integrated I(L) = Σ_{l≤L} z_l with pointwise envelope z_{1−p/2}·√L | N(0, 1) per lag (Bartlett) |
| `epochAverage(curves, { align, length, offset })` | per-index Stouffer across events aligned at their onsets | N(0, 1) per index |
| `varianceRatio(x, q)` | Lo–MacKinlay VR(q) over overlapping q-sums (bias-corrected), iid z and heteroskedasticity-robust z* | N(0, 1), two-sided |

Caveats: `covar`'s normal tail is a CLT approximation over skewed products
(expect T·P ≳ a few hundred), and v = 2 on lattice trials under-scales the
statistic (variance (1 − 1/k)²: 0.77 at k = 8, 0.98 at k = 200). Blocks tile
from step 0 and drop the trailing remainder (`droppedSteps`). The blocking
decomposition linearizes probit z's, so `predicted` tracks the observed z
only with many blocks; ρ is taken about the theoretical mean 0 and averaged
over all blocking phases. The autocorrelation band and envelope are pointwise
— scanning lags for the first exit is a multiple comparison. Epoch averages
assume independent, non-overlapping epochs. `varianceRatio` is asymptotic
(n ≫ q) and matches `arch.unitroot.VarianceRatio` (overlap, debiased). These
reproduce published analysis *forms*; they neither use the GCP database nor
presuppose its hypothesis.

### Negentropy estimators

J(x) = H(gaussian of equal variance) − H(x) ≥ 0, zero iff Gaussian —
"how far from maximally random":

- `negentropyKurtosis` — classic moment approximation (skew²/12 + exkurt²/48)
- `negentropyLogcosh`, `negentropyExp` — Hyvärinen contrasts with honestly
  calibrated null z-scores (the delta-method variance under empirical
  standardization, ~34× smaller than the naive Var[G] for logcosh; constants
  frozen from mpmath). Positive z ⇒ sub-Gaussian, negative ⇒ super-Gaussian.
- `vasicekEntropy` / `negentropyVasicek` — m-spacings differential entropy,
  validated against `scipy.stats.differential_entropy`
- `windowedNegentropy` — rolling "when did order appear?" stream whose
  emissions exactly equal the batch estimator per slice; abort pre-empts a
  blocked async input

Lattice-valued data (bytes, trial sums) needs dithering first:
`ditheredTrialZ` (trials → continuous z) or `probitBytes`
(bytes → *exactly* standard normal under H0). Dither is seeded from
`seed` (default `0x9e3779b9`) mixed with a source label — `ditheredTrialZ`
uses `series.source`, `probitBytes` takes `{ source }` — so sources never share
a dither sequence (shared dither fakes cross-source coherence of ≈ 1/(12·k/4)
per pair).

### Quality estimators

Classic randomness checks over raw bytes or unpacked bits. They can only
*fail* a source; run them on raw output (whitened output passes by
construction). Bit estimators take `toBits(bytes)` (MSB-first) and reject any
value other than 0/1 with `invalid_config`; empty input throws
`insufficient_data`.

| estimator | input | returns |
|---|---|---|
| `shannonEntropy(bytes)` | bytes | Shannon entropy, bits/byte (upper bound on min-entropy) |
| `mcvMinEntropy(bytes)` | ≥ 2 bytes | SP 800-90B §6.3.1 Most Common Value min-entropy, bits/byte |
| `markovMinEntropyPerBit(bits)` | bits | SP 800-90B §6.3.3 Markov min-entropy, bits/bit |
| `chiSquareBytes(bytes)` | bytes | `{ statistic, pValue }` — byte-histogram χ², 255 df, exact tail |
| `serialCorrelation(bytes)` | bytes | ent-style lag-1 serial correlation (0 ideal) |
| `monobit(bits)` | bits | `{ onesFraction, z }` |
| `runsTest(bits)` | ≥ 2 bits | Wald–Wolfowitz runs z-score (+∞ for a constant sequence) |
| `spectralTest(bits, { variance })` | ≥ 2 bits | `{ statistic, pValue }` — SP 800-22 §2.6 DFT test; `variance: 'nist'` (default, n·0.95·0.05/4) or `'kim2004'` (/3.8, Kim–Umeno–Hasegawa's correction; the /4 form is anti-conservative). N₀ and the variance use ⌊n/2⌋, so odd n is unbiased |
| `spectralEntropy(x, { normalize })` | samples | Shannon entropy of the normalized power spectrum |
| `autocorrelation(x, maxLag)` | samples | biased ACF, lags 0…maxLag (±1.96/√n white-noise band) |
| `sampleEntropy(x, m, r)` | samples | SampEn (Richman & Moorman): B over N−m+1, A over N−m templates (differs from R&M's N−m/N−m by O(1/N)); less biased than ApEn, *largely* record-length independent |
| `approximateEntropy(x, m, r)` | samples | ApEn (Pincus 1991), self-matches included |

The SP 800-22 §2.6.8 worked examples are inconsistent with the spec's own
formula (ε = 1001010011 has N₁ = 5, p = 0.468, not the printed 0.0295); the
DFT test is cross-checked against an independent numpy implementation instead.

### Experiment layer

```ts
import { analyzeTrials, registerExperiment, session } from '@mindpeeker/negentropy'
import { drand, nistBeacon, cryptoProvider } from '@mindpeeker/entropy/providers'

const registration = await registerExperiment({
  trial: { clock: { mode: 'interval', intervalMs: 1000 } },
  calibration: { trials: 600 }, // burn-in window, disjoint by construction
  missing: 'skip',
  events: [{
    id: 'meditation-1', label: 'group session 19:00–19:20',
    statistic: 'netvar',
    start: new Date('2026-07-08T19:00:00Z'), end: new Date('2026-07-08T19:20:00Z'),
  }],
  // optional: commit a public beacon pulse (a no-earlier-than bound for the registration)
  anchors: { beacons: [{ source: 'drand', chainId: '8990e7a9…', round: 5_000_000,
    timestamp: '2025-01-01T00:00:00Z', valueHex: 'ab12…' }] },
})

const live = session({
  sources: [drand(), nistBeacon(), cryptoProvider()],
  registration,
  stepTimeoutMs: 60_000, // or Infinity: no deadline
})
for await (const tick of live) {
  render(tick.stouffer, tick.netvar, tick.cumdev, tick.activeEvents)
}
const result = live.stop() // never throws: analysis + composite + full archive

// re-analysis later reproduces `result` exactly (no second burn-in):
const again = analyzeTrials(result.series, { registration, calibration: result.calibration })
```

**Registration.** `registerExperiment` validates the config strictly (unique
event ids, well-formed windows → `invalid_window`, trial width ≥ 8, calibration
trials ≥ 2, valid calibrations with unique sources, valid anchors, no unknown
keys → `invalid_config`), fills in every default, and hashes the versioned
envelope `{"schema":"negentropy/experiment/1","config":<resolved>}` serialized
as RFC 8785 canonical JSON (Date bounds as ISO 8601 strings). A config written
with or without explicit defaults therefore hashes identically, and a later
change of a library default cannot change what a hash certifies. The result
carries `schema`, the frozen resolved `config`, the exact `canonical` string
and its hex SHA-256 `hash` — any JCS implementation reproduces the hash from
`JSON.parse(canonical)`. `canonicalJson` rejects (never coerces) what JSON cannot
represent losslessly: NaN/±∞, `undefined`, BigInt, functions, symbols, lone
surrogates and noncharacters, cycles, and every non-plain object (Date, Map,
Set, typed arrays, class instances). Passing a registration to
`session`/`analyzeTrials`/`analyzeBytes` embeds its hash in the result; a
registration mutated after hashing (e.g. a Date changed with `setTime`) is
refused.

**Sessions** run in lock-step rounds (one trial per source per tick, bounded
memory). The archive holds one row per tick for every source — its trial sum,
or `NaN` when it missed the round — stamped with the tick time, so
`live.series()` and `result.series` stay step-aligned and are never truncated;
`result.analysedSteps` is the row count. With `missing: 'skip'` a round
proceeds with whoever answered, a source that ends leaves the roster, and a
source that times out or ends during burn-in is dropped from the roster and
the archive; the default `'error'` throws `timeout`/`source_ended` instead.
Statistics combine over the sources present at each step, exactly as the live
loop does, so `result.events[i].value` for a window starting at step 0 equals
the live `tick.netvar` bit for bit. `stop()` is total: an event whose window
has not elapsed (or whose Date window has not closed — no step stamped at or
after its end) comes back `status: 'incomplete'` with NaN value/p/z and the
covered `steps`, and a session stopped during burn-in returns its empty
archive. The session owns an AbortController, linked to your `signal` and
handed to every `source.stream()`; `stop()`, your abort, and leaving the loop
all abort it, and listeners added to your signal are removed when the run
ends. `stepTimeoutMs` must be finite in (0, 2³¹ − 1] or `Infinity`.

**Batch.** `analyzeTrials(series, config | registration | { registration,
calibration })` and `analyzeBytes(recordings, …)` (count clock only — raw bytes
carry no timing, so an interval clock throws `invalid_config`). Duplicate
sources or event ids and malformed calibrations are rejected. Exact
reproduction of a session or an earlier analysis:
`analyzeTrials(result.series, { registration, calibration: result.calibration })`,
or for an unregistered run `analyzeTrials(result.series, { ...config, calibration: result.calibration })`
— the re-analysis calibrations must match the registered calibration spec.

**Composite.** Complete events combine into `result.composite`. Disjoint
windows give the Stouffer Z = Σzₑ/√E (`independent: true`). When windows
overlap — or several statistics share a window — plain Stouffer is
anti-conservative (netvar + devvar + correlation on one window over 3 sources:
Var ≈ 1.93), so the composite switches to Brown's covariance correction in
Stouffer form, Z = Σzₑ/√(Σᵢⱼ ρᵢⱼ) (`independent: false`, `method: 'brown'`,
`reason` names the overlaps). ρ comes from the exact H0 per-step moments of
the statistics over their shared steps (netvar pairs: O/√(AB); netvar–devvar on
one window of N sources ≈ 1/√N; devvar–correlation 0), checked against Monte
Carlo. `brownCompositeZ(events, R)` takes your own correlation matrix;
`bonferroni` covers individual-event claims.

## Extraction: manufacture order from noise

```ts
import {
  vonNeumann, peres, peresRate, debiasStream, // debiasing (iid bits in!)
  sha256Condition, hmacCondition, conditionStream, // SP 800-90B vetted
  toeplitzExtractor, toeplitzOutputBits,    // seeded strong extractor
  ContinuousHealth,                          // RCT + APT, observational or strict
  claimBytes, debiasAccounted, conditionAccounted, extractAccounted,
  outputEntropy, vettedOutputEntropy,
} from '@mindpeeker/negentropy'

// honest pipeline: no step ever raises the claim it received, every step in the trace
let x = claimBytes(rawBytes, 2 /* measured bits/byte */, 'measured')
x = debiasAccounted(x, 'peres')          // min(8·outBytes, input claim); { basis: 'iid' } for full credit
x = await conditionAccounted(x)          // min(Output_Entropy(8·inBytes, 256, 256, h_in), 0.999·256)
// or: extractAccounted(x, toeplitzExtractor(seed, n, m)) — leftover hash lemma enforced
```

- **Peres** debiasing recycles what von Neumann discards; rate → H(p)
  (exact recurrence in `peresRate`). Verified *exhaustively*: over every
  input at two biases, outputs of equal length are equiprobable. The
  accounted claim is capped at the input claim by default (a deterministic map
  cannot add min-entropy, and a measured claim on correlated bits must not be
  inflated by the iid assumption); `{ basis: 'iid' }` opts into 8 bits per
  output byte.
- **Conditioning credit** is SP 800-90B §3.1.5.1.2 `outputEntropy(nIn, nOut,
  nw, hIn)`: P_high = 2^−h_in, P_low = (1 − P_high)/(2^n_in − 1),
  n = min(n_out, nw), ψ = 2^(n_in−n)·P_low + P_high,
  U = 2^(n_in−n) + √(2n·2^(n_in−n)·ln 2), ω = U·P_low, h_out = −log₂ max(ψ, ω) —
  computed in log space. `vettedOutputEntropy(hIn, nOut, nIn?, nw?)` caps it at
  0.999·n_out (the non-vetted §3.1.5.2 cap, kept as house policy); an omitted
  n_in defaults to ⌈h_in⌉, the most conservative width. Example: 512 input bits
  carrying 256 bits credit 255.0 bits, not 255.744.
- **Streams.** `conditionStream(raw, { minEntropyPerByte: h, safetyFactor })`
  hashes every n = ⌈safetyFactor·256/h⌉ raw bytes into one 32-byte block,
  independent of chunking, in linear time. Each block's credit is
  `vettedOutputEntropy(h·n, 256, 8·n)` — never a full 256 bits: safetyFactor 2
  at h = 8 → 255.744 bits, safetyFactor 1 at h = 8 → 251.69 (the ω term),
  safetyFactor 1 at h = 4 → 255.0 (the ψ term). `debiasStream(raw, method)`
  debiases bytes with state carried across chunks: `'von-neumann'` equals the
  batch `vonNeumann` over the whole input; `'peres'` is Zhou & Bruck's (2012)
  random-stream algorithm — the streaming form of Peres, whose output stopped at
  any length is unbiased and independent (its order differs from the batch
  `peres`; emitting Peres's outputs immediately in batch order is biased, which
  the tests show exhaustively). Both streams race each pull against `signal`
  (a blocked upstream cannot delay `aborted`), close the upstream on exit, and
  wrap upstream errors as `source_failed`. `hmacCondition` rejects an empty key
  with `invalid_config`.
- **Toeplitz** extraction is a strong extractor — the seed may be public,
  but must be uniform and independent of the input. `toeplitzOutputBits(k, ε)`
  rejects a negative/NaN k (`invalid_config`) and throws `insufficient_data`
  naming the required k when not even one bit can be extracted (k < 65 at the
  default ε = 2⁻³²).
- **Health tests** (SP 800-90B RCT/APT) run observationally by default
  (alarms, keep going — the anomaly-logger stance) or `strict` (throw —
  the randomness-supplier stance). `minEntropyPerSample` must be in (0, 8]
  and `windowSize` 512 or 1024. `rctCutoff`/`aptCutoff` are exact at every H
  (log-space binomial tail; e.g. H = 1/16 → 509 at W = 512, 1009 at W = 1024)
  and cross-checked against exact BigInt sums; a cutoff of W + 1 is the true
  answer for H < 20/W, where the APT cannot fire.

## Numerics: `@mindpeeker/negentropy/numerics`

The fixture-validated numerical core, shared by sibling packages. Pure,
deterministic, browser-safe. Invalid arguments (NaN, out of domain) throw
`NegentropyError('invalid_config')`; a failed iteration throws
`NegentropyError('numerical')`; infinite arguments return exact limits.

```ts
import { chi2Sf, betaInc, binomialSf, aptCutoff } from '@mindpeeker/negentropy/numerics'
```

| export | definition | notes |
|---|---|---|
| `lnGamma(x)` | ln Γ(x), x > 0 | Lanczos (g = 7, n = 9); lnGamma(∞) = ∞ |
| `gammaP(a, x)` / `gammaQ(a, x)` | regularized incomplete gammas P, Q = 1 − P | series + Lentz CF; Temme's uniform asymptotic expansion for a ≥ 100, \|x − a\| < 0.3a — O(1) in a, ~1e-13 relative up to a = 5·10⁸ |
| `erfc(x)` | Q(½, x²) | erfc(−∞) = 2, erfc(∞) = 0 |
| `normCdf(z)` / `normSf(z)` / `normPpf(p)` | Φ(z), 1 − Φ(z), Φ⁻¹(p) | Wichura AS 241 for the quantile |
| `chi2Cdf(x, k)` / `chi2Sf(x, k)` | P(k/2, x/2), Q(k/2, x/2) | any finite df > 0 (df = 10⁹ is fine) |
| `chi2Ppf(p, k)` | χ² quantile | Newton in ln x, relative stopping rule: `chi2Ppf(1e-12, 1)` = 1.5708e-24 |
| `lnBeta(a, b)` | ln B(a, b) | Stirling form when an argument is ≥ 10 |
| `betaInc(a, b, x)` | I_x(a, b), the Beta(a, b) CDF | Lentz CF (NR §6.4) with a cancellation-free prefactor; ~1e-13 for shapes ≲ 10⁴, ~1e-11 at 10⁸ |
| `betaPpf(q, a, b)` | x with I_x(a, b) = q | bracketed Newton in ln x |
| `binomialPmf(k, n, p)` | P(X = k) | Loader's saddle-point algorithm (the one behind R's dbinom) |
| `binomialCdf(k, n, p)` | P(X ≤ k) = I_{1−p}(n − k, k + 1) | k floored; exact tails, n ≫ 10⁶ fine |
| `binomialSf(k, n, p)` | P(X > k) = I_p(k + 1, n − k) | strictly greater (scipy convention) |
| `rctCutoff(h)` | 1 + ⌈20/H⌉ | SP 800-90B §4.4.1, α = 2⁻²⁰ |
| `aptCutoff(h, w)` | 1 + CRITBINOM(W, 2⁻ᴴ, 1 − 2⁻²⁰) | SP 800-90B §4.4.2, exact at every H > 0 |
| `KahanSum` | compensated sum (`add`, `value`) | Neumaier's variant: 1e16 + 1 − 1e16 = 1 |
| `Welford` | one-pass mean/variance (`push`, `n`, `mean`, `variance`, `populationVariance`, `sd`) | |
| `toBits`, `concatBytes`, `POPCOUNT` | MSB-first unpacking, byte concat, per-byte popcount table | |

References: 40-digit mpmath values for the gamma family beyond a = 12 000,
chi-square quantile tails and the incomplete beta (`test/fixtures/numerics.json`,
`scripts/fixtures/numerics.py`), scipy grids (`special.json`), exact BigInt
enumeration for binomial tails (n ≤ 60) and APT cutoffs.

## Behaviour changes in 0.2.0

Numerics, statistics, estimators and accounting:

- Domain errors in the special functions are `NegentropyError('invalid_config')`
  instead of `RangeError`; non-convergence is the new `'numerical'` code
  (previously a bare `Error`). NaN now throws everywhere; ±∞ returns exact limits.
- `chi2Sf`/`chiSquareP`/`devvar` no longer throw for df ≳ 3.7·10⁶ near the mean.
- `chi2Ppf` lower-tail quantiles are correct (they were clamped near 5.7e-14).
- `normalP`, `chiSquareP`, `stoufferZ`, `zScores`, the network statistics,
  `onsiteVsGlobal` and `calibrate` reject non-finite inputs (`invalid_config`);
  `zScores` rejects a calibration without finite mean and sd > 0
  (`calibration_required`); `theoreticalCalibration`/`calibrate` validate
  `bitsPerTrial` (integer ≥ 8).
- `markovMinEntropyPerBit`, `monobit`, `runsTest` and `spectralTest` reject
  non-bit input; `chiSquareBytes`, `monobit` (empty), `runsTest` (< 2 bits) and
  `mcvMinEntropy` (< 2 bytes) throw `insufficient_data` instead of NaN.
- `spectralTest` uses ⌊n/2⌋ for N₀ and the variance (odd-n results change;
  even n unchanged) and gains `{ variance: 'kim2004' }`.
- `ditheredTrialZ` seeds its dither from the seed mixed with the source name —
  outputs differ from 0.1.x; `probitBytes` is unchanged unless `source` is given.
- `PairCorrelation` gains `meanProduct` and `pearson`; `networkCoherence` gains
  `pairs`.
- `vettedOutputEntropy` implements Output_Entropy (credits drop by up to
  ~0.77 bits near h_in ≈ n_out; with n_in omitted it assumes n_in = ⌈h_in⌉);
  `conditionAccounted` passes the real input width.
- `debiasAccounted` caps the claim at the input claim unless `{ basis: 'iid' }`.
- `ContinuousHealth` rejects `minEntropyPerSample` outside (0, 8] and window
  sizes other than 512/1024; `rctCutoff` rejects H ≤ 0/NaN.
- `KahanSum` is Neumaier summation (differs from Kahan only where a term
  exceeds the running sum).
- `significanceEnvelope` accepts p below 2⁻⁵³ (upper-tail quantile, no 1 − p).
- `trialStream` and `windowedNegentropy` race each upstream pull against the
  abort signal and close the upstream on abort/early exit.

Experiment layer and extraction streams:

- **Registration hashes change.** `registerExperiment` hashes the default-resolved
  envelope `{"schema":"negentropy/experiment/1","config":…}` instead of the raw
  config, so every 0.1.x hash differs. Registration now validates strictly
  (unknown keys, duplicate event ids, malformed windows, bad calibrations and
  anchors throw), `config` is the resolved config, and the result gains
  `schema` and `canonical`. New optional `anchors.beacons` is committed in the
  hash. Hand-built `{ config, hash }` objects are refused.
- `canonicalJson` follows RFC 8785 and rejects Date (was an ISO string),
  `undefined` members (were dropped), Map/Set/typed arrays/class instances
  (were serialized as their enumerable keys), BigInt, lone surrogates and
  noncharacters.
- `session` archives one row per tick per source (NaN = absent) stamped with
  the tick time (was per-source chunk-arrival time), so under
  `missing: 'skip'` sources no longer desynchronise and nothing is truncated.
  `stop()` never throws: unelapsed windows are `status: 'incomplete'` (it threw
  `invalid_window`), and stopping during burn-in returns an empty result (it
  threw `insufficient_data`). New `series()` accessor.
- `session` validates at construction: `stepTimeoutMs` (finite in (0, 2³¹ − 1]
  or `Infinity` = no deadline; ≥ 2³¹ used to fire after 1 ms), sources, events,
  and provided calibrations (`calibration_required` is now thrown by `session()`
  itself, not on the first tick); a correlation event needs ≥ 2 sources.
- `session` passes a session-owned AbortController's signal to
  `source.stream()` (it passed the caller's signal); `stop()` aborts it, and the
  listener on the caller's signal is removed when the run ends.
- Burn-in honours `missing: 'skip'`: a source that times out or ends during
  calibration is dropped from the roster (it threw `timeout`/`source_ended`).
- Live `netvar`/`cumdev` use compensated summation, so they equal the batch
  values bit for bit.
- `analyzeTrials` under `missing: 'skip'` treats NaN sums and the tail of
  shorter series as absent and combines over present sources per step (it
  truncated every series to the shortest, also in `result.series`).
  `result.analysedSteps` is new. Under `'error'`, NaN sums throw.
- Event windows past the data and unclosed Date windows yield
  `status: 'incomplete'` events instead of `invalid_window`; a Date window whose
  end lies beyond the last timestamp is no longer analysed as if complete.
  `EventResult` gains `status` and `reason`.
- Overlapping complete events switch the composite to Brown's correction;
  `ExperimentComposite` gains `independent`, `method`, `variance`, `reason`.
  Incomplete events are excluded; `compositeZ` rejects them.
- `analyzeTrials` accepts `{ registration, calibration }` (re-analysis without
  re-burning) and rejects duplicate sources/event ids, invalid calibrations
  (non-finite mean, sd ≤ 0), non-Float64Array sums, mismatched timestamps and a
  series width that differs from an explicit `trial.bitsPerTrial`.
  `analyzeBytes` throws `invalid_config` for an interval clock (it silently used
  count-mode trials).
- `conditionStream` pools in linear time (was O(N²) per large chunk), races
  pulls against the signal, closes the upstream, wraps upstream errors as
  `source_failed`, and rejects non-Uint8Array chunks, unknown modes and empty
  HMAC keys. Its output is unchanged.
- `hmacCondition` rejects an empty key (`invalid_config`, was a DOMException);
  `sha256Condition`/`hmacCondition`/`toeplitzExtractor` reject non-Uint8Array
  input.
- `toeplitzOutputBits` rejects NaN/negative/infinite min-entropy and throws
  `insufficient_data` when no output bit is possible (it returned 0, negative
  or NaN lengths).
- New: `debiasStream`, `createDebiaser`, `brownCompositeZ`, `EXPERIMENT_SCHEMA`.

Sequential and GCP statistics (additive — no existing output changes):

- New anytime-valid monitoring: `netvarMartingale`, `netvarLogM`,
  `netvarBoundary`, `anytimeEnvelope`, `driftMartingale`, `driftLogM`,
  `driftBoundary`, `anytimeP`, `villeCrossing`.
- New GCP statistics: `covar`, `blockZ`, `blockedNetvar`, `blockedDevvar`,
  `blockingDecomposition`, `networkAutocorrelation`, `epochAverage`,
  `varianceRatio`.

## What this package will not tell you

Statistical tests can only *fail* a source — passing proves nothing about
physical unpredictability (any CSPRNG passes everything). The detection
module presents GCP-style methodology as neutral statistical tooling; the
underlying mind-matter hypothesis is contested, and nothing here settles
it. What the tooling does guarantee: exact null distributions (validated
against scipy/mpmath fixtures), pre-registration discipline, and honest
p-values either way.

## Development

```sh
bun test                      # fixtures are checked in — no Python needed
uv run scripts/fixtures/generate.py   # regenerate fixtures (scipy/mpmath)
uv run scripts/fixtures/numerics.py   # Temme coefficients + numerics.json (mpmath, then biome format)
uv run --python 3.12 scripts/fixtures/sequential.py   # sequential.json (mpmath, numpy/scipy, arch; then biome format)
cd ../entropy && bun run demo:negentropy   # live session demo over real providers
```
