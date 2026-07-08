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
| `interSourceCorrelation` | are pairwise products elevated? | N(0, 1) |

`cumulativeDeviation(stoufferZs)` gives the classic cumsum(Z²−1) plot and
`significanceEnvelope(steps, p)` its exact χ²-quantile envelope. **The
envelope is pointwise**: an H0 path crosses it *somewhere* far more often
than p — only a pre-registered endpoint carries the stated significance.
(There is a test in this repo that proves that caveat by simulation.)

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
  emissions exactly equal the batch estimator per slice

Lattice-valued data (bytes, trial sums) needs dithering first:
`ditheredTrialZ` (trials → continuous z) or `probitBytes`
(bytes → *exactly* standard normal under H0).

### Experiment layer

```ts
import { registerExperiment, session } from '@mindpeeker/negentropy'
import { drand, nistBeacon, cryptoProvider } from '@mindpeeker/entropy'

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
} from '@mindpeeker/negentropy'

// honest pipeline: claims only ever shrink, every step in the trace
let x = claimBytes(rawBytes, 2 /* measured bits/byte */, 'measured')
x = debiasAccounted(x, 'peres')          // full credit under the iid assumption
x = await conditionAccounted(x)          // h_out = min(h_in, 0.999·256)
// or: extractAccounted(x, toeplitzExtractor(seed, n, m)) — leftover hash lemma enforced
```

- **Peres** debiasing recycles what von Neumann discards; rate → H(p)
  (exact recurrence in `peresRate`). Verified *exhaustively*: over every
  input at two biases, outputs of equal length are equiprobable.
- **Toeplitz** extraction is a strong extractor — the seed may be public,
  but must be uniform and independent of the input.
- **Health tests** (SP 800-90B RCT/APT) run observationally by default
  (alarms, keep going — the anomaly-logger stance) or `strict` (throw —
  the randomness-supplier stance).

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
cd ../entropy && bun run demo:negentropy   # live session demo over real providers
```
