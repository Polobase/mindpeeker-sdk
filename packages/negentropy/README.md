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
import { registerExperiment, session } from '@mindpeeker/negentropy'
import { drand, nistBeacon, cryptoProvider } from '@mindpeeker/entropy/providers'

const registration = await registerExperiment({
  trial: { clock: { mode: 'interval', intervalMs: 1000 } },
  calibration: { trials: 600 }, // burn-in window, disjoint by construction
  events: [{
    id: 'meditation-1', label: 'group session 19:00–19:20',
    statistic: 'netvar',
    start: new Date('2026-07-08T19:00:00Z'), end: new Date('2026-07-08T19:20:00Z'),
  }],
})

const live = session({
  sources: [drand(), nistBeacon(), cryptoProvider()],
  registration,
})
for await (const tick of live) {
  render(tick.stouffer, tick.netvar, tick.cumdev, tick.activeEvents)
}
const result = live.stop() // batch-exact analysis + composite + archival series
```

Sessions run in lock-step rounds (one trial per source per tick, bounded
memory), tolerate slow/dead sources with `missing: 'skip'`, and `stop()`
delegates to `analyzeTrials` — re-analyzing `result.series` later reproduces
the result exactly. `registerExperiment` freezes the config and embeds its
SHA-256 in the result: the pre-registration paper trail.

Batch equivalents: `analyzeBytes(recordings, config)` /
`analyzeTrials(series, config)`; multi-event runs combine via the Stouffer
`composite` (with `bonferroni` for individual-event claims).

## Extraction: manufacture order from noise

```ts
import {
  vonNeumann, peres, peresRate,             // debiasing (iid bits in!)
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
- **Toeplitz** extraction is a strong extractor — the seed may be public,
  but must be uniform and independent of the input.
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

## Behaviour changes in 0.2.0 (numerics, statistics, estimators, accounting)

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
cd ../entropy && bun run demo:negentropy   # live session demo over real providers
```
