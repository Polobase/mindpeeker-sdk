# @mindpeeker/psi

Mind-matter-interaction (MMI) experiment protocols and live anomaly
monitoring, composing [`@mindpeeker/negentropy`](../negentropy).

Negentropy owns the statistics — trials, calibration, Stouffer z, netvar,
devvar, cumulative deviation, envelopes, the pre-registered experiment
layer. This package owns the *experimental designs and workflows* built on
top of them:

- **PEAR-style tripolar protocols** — intention-tagged runs
  (high / low / baseline) under fixed, interleaved, counterbalanced,
  instructed (seeded random), or volitional schedules, with a committed
  schedule digest, a yoked control arm, equivalence tests, and
  registration binding
- **Presentiment (time-reversed) protocol, RNG analogue** — pre-stimulus
  target-minus-control deviation over disjoint epochs with label-provenance
  checks, a post-stimulus sanity control, and a seeded label-shuffle
  permutation null (`analyzePresentiment`, `presentimentEpochs`)
- **GCP-style formal event analysis** — the full netvar / devvar /
  cumulative-deviation bundle over recorded multi-source data, with step or
  wall-clock windows, empirical calibration, and blocking
- **FieldREG segment analysis** — the most extreme pre-declared segment,
  multiplicity-corrected
- **Rolling monitors** — dashboard-ready Stouffer and netvar windows over
  live sources, batch-reproducible
- **JSONL recording and deterministic replay** — sink-agnostic session
  records that reproduce a live analysis exactly, optionally hash-chained to
  a registration (`verifyChain`)
- **GCP archive reader** — the Global Consciousness Project's basket-data CSV
  files as step-aligned series (`parseBasketCsv`)
- **Resampling nulls** — seeded label-shuffle and time-offset surrogates,
  random-start placebo windows, global rank envelopes, and maxT / Holm /
  Benjamini–Hochberg adjustment
- **Bayes factors and anytime-valid monitoring** — binomial factors for any
  chance rate, closed-form factors for Δz, a coin e-process whose p-value
  survives continuous peeking, and pre-registered sequential designs

Zero runtime dependencies besides `@mindpeeker/negentropy` (workspace
sibling, itself zero-dep), browser-safe, ESM. Every `@mindpeeker/entropy`
provider works as an input source *structurally* — the packages share a
shape, not code:

```ts no-check
interface TrialSource {
  readonly name: string
  stream(opts?: { signal?: AbortSignal; chunkBytes?: number }): AsyncIterable<Uint8Array>
}
```

Bits are MSB-first SDK-wide; a *trial* is the number of one-bits among
`bitsPerTrial` consecutive bits — Binomial(k, ½) under H0, normalized as
z = (x − k/2)/√(k/4). Default k = 200, the PEAR and Global Consciousness
Project convention (mean 100, variance 50).

## Quick start

```ts
import {
  runTripolar, analyzeTripolar, registerTripolar,
  recordSession, readSession, verifyChain, analyzeEvent,
  rollingStouffer, timeOffsetSurrogates, permutationP,
  tripolarBayesFactor,
} from '@mindpeeker/psi'

// 1. register, then run a tripolar protocol over any TrialSource
const plan = { runsPerIntention: 10, order: 'instructed', seed: 'c0ffee' } as const
const registration = await registerTripolar(plan) // publish registration.hash first
const runs = []
for await (const run of runTripolar(source, plan)) runs.push(run)

const result = analyzeTripolar(runs, { registration })
console.log(result.deltaZ, result.deltaP, result.high.effectSize)
console.log(tripolarBayesFactor(result, { perBitEffectSd: 1e-4 }).bf10) // PEAR-scale prior

// 2. record a hash-chained multi-source session as JSONL, verify and replay it later
const chain = { registration: registration.hash }
for await (const line of recordSession([anu, drand], { bitsPerTrial: 200, chain })) {
  file.write(`${line}\n`) // sink-agnostic — you persist the lines
}
const { ok, head } = await verifyChain(savedLines, chain) // publish head
const series = await readSession(savedLines)
const event = analyzeEvent(series, { startMs, endMs }, { alignment: 'round' })

// 3. empirical p: misalign every source pair, recompute, rank
const nulls = [...timeOffsetSurrogates(series, { rotate: 'all-but-one', surrogates: 999 })].map(
  (s) => analyzeEvent(s.series, { startMs, endMs }, { alignment: 'round' }).netvar.statistic,
)
const p = permutationP(event.netvar.statistic, nulls) // resolution 1/1000
```

## Protocol catalogue

| protocol | API | primary statistic | null | honest multiplicity |
|---|---|---|---|---|
| PEAR tripolar REG | `runTripolar`, `analyzeTripolar` | $\Delta z$ high − low on the per-bit scale | $N(0,1)$ | one pre-registered statistic; `registerTripolar` binds N and schedule |
| yoked control arm | `runTripolar({ control })`, `controlContrast`, `tostEquivalence` | $\Delta\varepsilon_E - \Delta\varepsilon_C$; TOST at $\varepsilon_0$ | $N(0,1)$ | pre-register $\varepsilon_0$ |
| baseline "bind" | `IntentionSummary.variance` | $\sum z^2$, lower tail | $\chi^2(n)$ | secondary |
| GCP formal event | `analyzeEvent` | netvar $\sum_t Z_s(t)^2$ | $\chi^2(T)$ | pre-registered window; `placeboWindows`, `timeOffsetSurrogates` |
| GCP blocked event | `analyzeEvent({ blockSeconds })` | $\sum_B Z_B^2$ | $\chi^2(\#B)$ | block length is part of the registration |
| cumulative-deviation curve | `analyzeEvent().cumdev` + `globalRankEnvelope` | whole curve | simulated / surrogate curves | global rank envelope, not the pointwise one |
| FieldREG segments | `analyzeFieldReg` | most extreme segment | Šidák/Bonferroni over segments and scales | segment boundaries and `scales` registered |
| presentiment (RNG analogue) | `presentimentEpochs`, `analyzePresentiment` | pre-window target − control $\Delta z$ | $N(0,1)$ for disjoint epochs; label-shuffle permutation | one pre-window; seed and surrogate count registered |
| forced choice / coin | `binomialBayesFactor({ p0 })`, `CoinEProcess` | $BF_{10}$; running $\max BF_{10}$ | Beta mixture vs $p_0$; Ville's inequality | anytime-valid: peek as often as you like |
| sequential Bayes design | `sequentialPlan`, `runSequential` | $BF_{10}$ at registered looks | $P_{H_0}(\text{stop\_h1}) \le 1/\text{bfStop}$ | plan digest published before data |
| live monitoring | `rollingStouffer`, `rollingNetvar` | window Stouffer / netvar z | $N(0,1)$ pointwise | none — for watching, not claiming |
| many statistics at once | `maxTAdjust`, `holm`, `benjaminiHochberg` | adjusted p | resampling / any dependence / PRDS | FWER or FDR |

## Protocols: tripolar (PEAR)

The Princeton Engineering Anomalies Research tripolar design (Jahn, Dunne
et al. 1997, *Correlations of Random Binary Sequences with Pre-Stated
Operator Intention*) collects three intentions — aim high, aim low, leave
alone — so the primary statistic is a **difference**:

$$\Delta z = \frac{\varepsilon_H - \varepsilon_L}{\sqrt{1/N_H + 1/N_L}}
\;\sim\; N(0,1) \text{ under } H_0,$$

with $N$ the bit counts. It reduces to $(z_H - z_L)/\sqrt{2}$ only for
balanced designs; with $N_L = 4N_H$ the shortcut overstates a 5.66σ
separation as 6.71σ. The standard error is the bit-level form of Rhine &
Pratt's $SD_\text{diff} = SD_\text{run}\sqrt{1/R_1 + 1/R_2}$ for unequal groups.

Per intention, `analyzeTripolar` reports Stouffer's combined
$z = \sum_i z_i/\sqrt{n}$, the per-bit effect size
$\varepsilon = z/\sqrt{N_\text{bits}}$ (which estimates $2(p - \tfrac12)$),
a normal-approximation 95% CI, and a **variance ("bind") test**
(`variance.z`, lower-tail $\chi^2$ on $\sum z^2$, plus the count of trials
exactly at $k/2$ against its expectation). Intention p-values are one-sided
in the *pre-stated* direction; the baseline is two-sided. PEAR-scale effects
are $\varepsilon \sim 10^{-4}$ — plan bit budgets accordingly before
claiming a null result.

**PEAR facts, as recorded in the library sources** (Mishlove, *The Roots of
Consciousness*; Rhine & Pratt, *Parapsychology*): trials of 200 binary
samples generated at 100 or 1000 bits/s; in automatic mode "a block of fifty
trials" per run (`PEAR_RUN_TRIALS = 50`, the default `trialsPerRun`);
operators worked in *volitional* mode (the operator chooses the direction)
or *instructed* mode ("some kind of random process determines" it), with
baseline runs "interspersed in some reasonable fashion"; the sign relation
between noise and output was switched trial by trial as a bias safeguard;
baseline runs showed a chance mean but "a statistically significant surplus
of scores at the precise theoretical mean". PEAR also reported comparable
results on pseudo-random and prerecorded sources and described the program
as "anomalous man-machine interactions" rather than PK.

### Schedules

`order` decides which intention each run gets (`tripolarSchedule(plan)`
returns it before any data):

| order | schedule | drift |
|---|---|---|
| `'fixed'` | H…H L…L B…B | maximally confounded |
| `'interleaved'` (default) | (H L B) × R | constant bias cancels; ≈ one run of linear drift remains in H − L |
| `'counterbalanced'` | H L B \| B L H \| … (ABBA) | linear drift cancels exactly for even R |
| `'instructed'` | seeded balanced permutation per cycle (`seed` required) | order confounds removed in expectation — PEAR's instructed mode |
| `'volitional'` | operator declares each run via `declare` | PEAR's volitional mode; balance enforced |

Interleaved cycling is an SDK convenience, not the PEAR protocol. Every run
carries `scheduleDigest` — SHA-256 of the canonical JSON
`{"plan":…,"schedule":…,"schema":"psi/tripolar-schedule/1"}` — plus its
`assignment` (`'instructed'` | `'volitional'`), `order`, `arm`, and
`xorSafeguard`. `xorSafeguard: true` records odd trials as $k - x$: the null
is unchanged and a constant per-bit bias cancels within every even-length
run.

### Registration binding

`registerTripolar(plan)` resolves defaults, freezes the plan, and returns
`{ plan, hash, schedule, scheduleDigest }`. Publish the hash before
collecting data; `analyzeTripolar(runs, { registration })` then throws
`PsiError('plan_mismatch')` when runs stop early, add runs, change run
length or trial size, deviate from the committed schedule, or carry a
different digest (`deviations: 'report'` lists them instead).
`verifyTripolarRegistration` recomputes every digest from the plan.

### Control arm and equivalence

`runTripolar(source, plan, { control })` consumes one control trial per
experimental trial on the same schedule and yields each experimental run
followed by its `arm: 'control'` twin. Analyze each arm separately, then

- `controlContrast(exp, ctrl)` — $z = (\Delta\varepsilon_E - \Delta\varepsilon_C)/\sqrt{s_E^2 + s_C^2}$,
  exactly $N(0,1)$ under the joint null;
- `tostEquivalence(analysis, { eps0 })` — two one-sided tests that the
  effect lies inside $(-\varepsilon_0, \varepsilon_0)$, so a control arm can
  positively support "no effect" at a pre-registered bound.

An effect that the control source reproduces indicts the pipeline, not the
operator — that is *our* methodological stance, not the field's consensus
(see PEAR's own reading above).

Aborting raises `PsiError('aborted')` promptly, also when a source reacts by
ending its stream; both streams are always closed.

## Protocols: presentiment (RNG analogue)

**What the literature measures.** Presentiment ("presponse") studies record
*physiology* before randomly chosen calm or emotional stimuli. Radin (1996)
measured skin conductance, heart rate, and plethysmography, with pictures
shown 5 s after the participant pressed a button. Bierman & Radin's
replication (*Toward a Science of Consciousness III*, ch. 31) used a 7.5 s
fore period, sampled skin conductance at **5 samples per second**, and
defined the dependent variable as the mean of the samples **4–6 s** after the
trial started minus a **per-epoch baseline** from 0.6–1.6 s, comparing calm
and extreme pictures with a Mann–Whitney U test (study 1: 16 participants ×
40 trials, z = 2.4, p = 0.016). Reported anticipation windows run a second
or less in the brain, about 3 s in the skin, and about 5 s in heart rate
(Radin), with electrodermal activity rising "three or four seconds in
advance" of a picture "selected at random by the computer only a
millisecond in advance" (Sheldrake's summary); the Mossbridge, Tressoldi &
Utts (2012) meta-analysis pooled electrodermal, heart-rate, blood-volume,
pupil, EEG, and BOLD measures. The main conventional explanation the
authors themselves raise is anticipation strategy (gambler's fallacy), which
can mimic a presponse when stimuli are drawn without replacement.

**What this package implements** is an SDK-defined *analogue* on a random
source, not the physiological protocol (sampled-signal epoching with
baseline normalization is on the roadmap): a continuous trial recording,
stimulus events at trial indices, and

$$\Delta z = \frac{Z_{\text{target}} - Z_{\text{control}}}{\sqrt2}$$

over the pooled pre-window trials — exactly $N(0,1)$ under H0 when epochs are
disjoint — with the post-window as the ordinary-causality control and a
label-shuffle permutation p as the design-level null.

```ts
import { analyzePresentiment, presentimentEpochs } from '@mindpeeker/psi'

// events: { at: trialIndex, stimulus: 'target' | 'control', labelDrawnAt?: epochMs }[]
const { epochs, droppedProvenance, overlapping, warnings } = presentimentEpochs(
  recording, events, { preWindow: 5, postWindow: 5 }, // 1 Hz trials: a 5 s window
)
const result = analyzePresentiment(epochs, { surrogates: 999, seed: registration.hash })
console.log(result.pre.deltaZ, result.permutationP, result.shuffle.resolution)
```

- **Disjoint epochs.** Consecutive stimuli must be at least
  `preWindow + postWindow` trials apart; otherwise `presentimentEpochs`
  throws `invalid_plan`. Overlapping epochs pool the same trials into target
  and control and collapse the null spread of $\Delta z$ (sd ≈ 0.18 instead of
  1 in the test suite's 20-epoch example); `allowOverlap: true` keeps them but
  reports `overlapping` and a warning, and the p-values are then not valid.
- **Label provenance.** Give each event `labelDrawnAt` (epoch ms of the
  random draw) and the epoch is kept only if the label was drawn *after* the
  pre-window's last trial completed (`timestamps[at − 1]`); earlier or
  unverifiable draws are dropped and counted in `droppedProvenance`. Seal the
  draw with a beacon or VDF when the order must convince a third party.
- **The null.** `permutationP` uses seeded count-preserving relabelings
  (exact enumeration when few exist); register `seed` and `surrogates`, and
  report `shuffle.resolution` — the default 100 surrogates cannot support
  p < 0.0099. Unknown stimulus labels are `invalid_plan`, never silently
  pooled as controls.
- **Limits.** One directional mean-shift statistic on one pre-window; no
  variance/netvar variant, no expectation-bias regression. Register the
  window before looking.

## Events: GCP formal analysis

`analyzeEvent(seriesBySource, window, opts)` follows the Global
Consciousness Project's formal-event conventions (Nelson et al. 2002;
Bancel & Nelson 2008): 200-bit trials at 1 Hz and the statistics

| field | definition | null |
|---|---|---|
| `netvar` | $\sum_t Z_s(t)^2$, $Z_s(t)$ the per-trial Stouffer across sources | $\chi^2(T)$ |
| `devvar` | $\sum_t \sum_i z_i(t)^2$ | $\chi^2(TN)$ |
| `cumdev` | $D(t) = \sum_{s\le t}(Z_s(s)^2 - 1)$ | flat, Var $= 2t$ |
| `envelope` | $\chi^2_{\text{isf}}(p, t) - t$, **pointwise** | — |
| `composite` | $\sum_t Z_s(t)/\sqrt{T}$, pooled mean shift | $N(0,1)$ |
| `blocked.netvar` | $\sum_B Z_B^2$ over `blockSeconds` blocks | $\chi^2(\#B)$ |

- **Windows.** `{ startStep, endStep }` selects rounds by index — always
  aligned for lock-step recordings. `{ startMs, endMs }` selects by
  timestamp: `alignment: 'strict'` (default) throws `source_mismatch` when an
  edge falls inside one round's per-source stamp spread rather than pair
  round *i* of one source with round *j* of another; `alignment: 'round'`
  windows on one canonical stamp per round (the latest source stamp).
- **Calibration.** The default is the theoretical Binomial(k, ½). The GCP
  formal series normalized each device by its *empirical* mean and variance
  (Nelson & Bancel 2011), GCP 2.0 by the previous 24 h: pass
  `calibration: Calibration[]` or `calibration: { history }` (fit with
  negentropy's `calibrate`; the history must not overlap the window).
- Every number is a thin composition of negentropy's `zScores`, `stoufferZ`,
  `netvar`, `devvar`, `cumulativeDeviation`, and `significanceEnvelope`
  (memoized per step count) — the test suite asserts field-for-field
  equality with the primitives.

### Placebo windows and global envelopes

The envelope an H0 path crosses *somewhere* far more often than p is the
pointwise one. Two honest alternatives:

```ts
import { analyzeEvent, globalRankEnvelope, permutationP, placeboWindows } from '@mindpeeker/psi'

// GCP random-start control: 999 event-length windows in off-event data
const placebos = placeboWindows(archive, {
  windowSteps: 3600, count: 999, seed: 20260917, exclude: [{ startMs, endMs }],
})
const observed = analyzeEvent(archive, { startMs, endMs }, { alignment: 'round' })
const nulls = placebos.map((w) => analyzeEvent(archive, w))
const p = permutationP(observed.netvar.statistic, nulls.map((n) => n.netvar.statistic))

// family-wise test of the whole cumulative-deviation curve
const envelope = globalRankEnvelope(observed.cumdev, nulls.map((n) => n.cumdev), { alpha: 0.05 })
console.log(envelope.pInterval, envelope.outside)
```

`globalRankEnvelope` implements the extreme-rank envelope of Myllymäki et
al. (2017): the observed curve leaves the $100(1-\alpha)\%$ envelope iff
$p_+ \le \alpha$, with the p-interval $[p_-, p_+]$ and the tie-breaking
extreme-rank-length p `pErl`. Use ≥ 2499 simulations at α = 0.05 for a
stable envelope.

### GCP archive: basket CSV files

`parseBasketCsv(text | chunks, opts)` reads the Global Consciousness
Project's daily basket-data files (`eggsummary/YYYY/basketdata-YYYY-MM-DD.csv.gz`
on global-mind.org, written by John Walker's `basketran`) exactly as the
project documents the format:

| record | fields |
|---|---|
| `10` protocol | item 1 samples per record, 2 seconds per record, 3 records per packet, 4 trial size |
| `11` content | item 1 eggs reporting, 2 start and 3 end (Unix seconds, optional civil time), 4 seconds of data |
| `12` egg IDs | `"gmtime"`, civil-time label (void if suppressed), one egg ID per data column |
| `13` data | Unix time, civil time (or void), one trial value per egg: one-bits of a 200-bit trial |

A void field is a **missing sample, never 0**, and every second has a row
even when all eggs are missing. By default the GCP's own exclusion — "we
exclude all trial-values greater than 145 and less than 55" — is applied to
200-bit files (`filter: false` keeps everything). The parser is strict:
contiguous one-per-second rows, civil times that match their Unix times,
one value per egg column, and a row count equal to "seconds of data", so a
truncated download is an error rather than a shorter day.

```ts
import { analyzeEvent, parseBasketCsv } from '@mindpeeker/psi'

const response = await fetch(basketUrl) // …/basketdata-2015-01-01.csv.gz
const text = response.body
  .pipeThrough(new DecompressionStream('gzip'))
  .pipeThrough(new TextDecoderStream())
const day = await parseBasketCsv(text, { eggs: [1, 37, 103, 108, 110], align: 'complete' })
const event = analyzeEvent(day.series, { startMs, endMs })
console.log(day.protocol.trialSize, day.missing, day.filtered)
```

Any text works as input: a whole file string, or chunks split anywhere
(`DecompressionStream` is standard in browsers, Deno, and Node ≥ 18; where it
is missing, decompress first and pass the string). Each egg becomes a series
`egg-<id>` with Unix-ms timestamps. With the
default `align: 'none'` eggs keep their own gaps; `align: 'complete'` keeps
only the seconds at which every selected egg reported a kept value, so the
series are step-aligned for `analyzeEvent` and the surrogate generators. The
GCP formal analyses normalized each egg by its empirical mean and variance —
pass `calibration: { history }` to `analyzeEvent` to do the same.

## FieldREG segments

`analyzeFieldReg(series, segments, { scales, correction })` implements the
FieldREG design (Nelson, Bradish, Dobyns, Dunne & Jahn 1996): one REG
through an event that "subdivides naturally into temporal segments"
(sessions, presentations, days), declared before looking. Each segment
reports its Stouffer z and $\chi^2$; the claim is the most extreme segment,
corrected over the S segments — Šidák $1 - (1 - p_{\min})^S$ (default) or
Bonferroni $S\,p_{\min}$ — and again over the registered number of analysis
`scales`. Composites (Stouffer, $\sum z_s^2$, Fisher) cover all segments;
segments must be disjoint. The library record says only "appropriate
correction for multiple sampling" — name your correction in the
registration.

## Monitors: rolling windows

`rollingStouffer(sources, { windowSize, hopSize })` and
`rollingNetvar(...)` run negentropy's lock-step `session()` under the hood
and emit `{ at, z, n, sourceCount }` points on one shared N(0,1) dashboard
scale — `rollingStouffer` emits the window's Stouffer z directly,
`rollingNetvar` the normal-equivalent $z = \Phi^{-1}(1-p)$ of the window's
$\chi^2$ upper-tail p. Windows are recomputed from scratch per emission (a
ring buffer holds the window), so a batch recomputation over the same
recorded trials reproduces every point *exactly*. `rollingNetvar` never
reports below the exact discrete floor $\Phi^{-1}(P_{\min})$ of integer
trial sums (−1.59 for one 200-bit source and a one-trial window).
`sourceCount` shows how many sources contributed the newest trial; a source
that ends just drops from the roster. Abort via `signal` raises
`PsiError('aborted')`.

Rolling windows are for *watching*, not claiming: a monitor scans many
overlapping windows, so crossing z = 3 somewhere is expected under H0 far
more often than Φ(−3) suggests. Claims belong to pre-registered windows.

## Recording and replay

`recordSession(sources, opts)` yields JSONL lines in lock-step rounds (one
line per source per round), byte-deterministic for the same bytes and clock.
`readSession(lines)` groups them back into `TrialSeries[]` — and because
both the serialization and the analysis are deterministic,
`analyzeEvent(await readSession(lines), window)` reproduces the live
analysis exactly. Record first, analyze later, let others re-analyze: the
recording *is* the paper trail.

**Schema v1** (default, unchanged from 0.1.x):

```json
{"v":1,"t":1751980800000,"source":"anu","sum":104,"bitsPerTrial":200}
```

**Schema v2** (`chain: true` or `chain: { registration }`) opens with a
session header and hash-chains every trial line to the line before it:

```json
{"v":2,"kind":"session","sources":["anu","drand"],"bitsPerTrial":200,"registration":"9f86…","genesis":"9f86…"}
{"v":2,"i":0,"prev":"<sha256 of the header line>","t":1751980800000,"source":"anu","sum":104,"bitsPerTrial":200}
{"v":2,"i":1,"prev":"<sha256 of line i=0>","t":1751980800003,"source":"drand","sum":97,"bitsPerTrial":200,"arm":"experimental"}
```

`genesis` is the registration hash (or 64 zeros); `i` counts trial lines;
`prev` is the lower-case hex SHA-256 of the previous line's exact UTF-8 text;
optional `arm` (`experimental` | `control`), `segment`, and `run` tags come
from `opts.tags` (fixed, or a function of round and source).

```ts
import { readSession, recordSession, verifyChain } from '@mindpeeker/psi'

const lines: string[] = []
for await (const line of recordSession([anu, drand], {
  chain: { registration: registration.hash },
  tags: (round) => ({ segment: round < 3600 ? 'baseline' : 'event' }),
})) lines.push(line)

const check = await verifyChain(lines, { registration: registration.hash })
// { ok: true, lines: 7201, head: '…' } — or { ok: false, brokenAt, reason }
const series = await readSession(lines)
```

`verifyChain` requires a v2 header, contiguous `i`, declared sources, the
header's `bitsPerTrial`, canonical encoding (`serializeRecordLine(parseRecordLine(line)) === line`),
and every `prev` link; an edited, inserted, deleted, or reordered line breaks
the chain at the first bad link. It proves internal consistency, not time:
a truncated tail or a rewritten last line is only detectable against a
published `head`, so publish, timestamp, or seal the head.

`readSession` accepts v1 and v2 (never mixed): a whole file as one string,
arrays of lines with or without terminators, or byte-stream text chunks split
anywhere (a segment without a newline is carried into the next chunk unless
it is already a complete JSON object). Errors name the physical line.
Structural v2 checks (header first, contiguous `i`, declared sources) run on
read; hash links are `verifyChain`'s job. `serializeRecordLine` validates
before writing, so every emitted line parses back.

## Resampling nulls: surrogates and multiplicity

Recompute your statistic on each surrogate dataset, then

$$p = \frac{1 + \left|\{\, i : s_i \ge s_{\text{obs}} \,\}\right|}{1 + m}$$

via `permutationP` — the +1 correction (Davison & Hinkley 1997; Phipson &
Smyth 2010) counts the observed arrangement as a member of its own null
ensemble, so p is never zero. **Its resolution is $1/(m+1)$**: the default
$m = 100$ (`DEFAULT_SURROGATES`) cannot support a claim below 0.0099 — raise
`surrogates` (999 → 0.001) before looking at the data.

- **`labelShuffleSurrogates(labels, { surrogates, seed })`** — count-preserving
  relabelings: every distinct relabeling exactly once when few exist (the
  exact permutation test), otherwise `surrogates` seeded Fisher–Yates
  permutations (splitmix64 → xoshiro128**, so the `seed` belongs in the
  registration). `method: 'rotation'` keeps the cyclic group (identity
  copies included — exact but nearly powerless for periodic designs).
  `describeLabelShuffle` reports method, $m$, and resolution.
- **`timeOffsetSurrogates(series, { rotate })`** — circular rotations
  $x'_t = x_{(t+\tau) \bmod T}$ (Theiler et al. 1992) preserving each
  source's marginal distribution and autocorrelation. `rotate: 'one'`
  (default) rotates only `sourceIndex` and tests *that source* against the
  rest — with N ≥ 3 sources most pair alignments survive into the null, so it
  has little power against a network-wide effect. `rotate: 'all-but-one'`
  gives every other source its own offset (seeded `design: 'random'` or
  deterministic `'latin'`), misaligning every pair; `rotate: 'all'` is the
  circular GCP pseudo-event; `sourceOffsets` takes explicit vectors.
- **`placeboWindows`** — non-circular random-start pseudo-events (above).
- **`maxTAdjust(observed, surrogateRows)`** — Westfall–Young step-down maxT:
  family-wise control that uses the dependence among many statistics;
  **`holm`** (any dependence) and **`benjaminiHochberg`** (FDR) for plain
  p-value families.

## Bayes factors and anytime-valid monitoring

### Binomial: any chance rate, either direction

`binomialBayesFactor(k, n, { a, b, p0, alternative })` tests
$H_1: p \sim \mathrm{Beta}(a,b)$ against the chance null $H_0: p = p_0$:

$$BF_{10} = \frac{B(k+a,\; n-k+b)}{B(a,b)\; p_0^{k}\,(1-p_0)^{n-k}}.$$

| design | $p_0$ |
|---|---|
| bits, placement tests | ½ (default) |
| ganzfeld (one target, three decoys) | ¼ |
| Zener cards | ⅕ |
| a die face | ⅙ |

`alternative: 'greater'` truncates the prior to $p > p_0$ (psi-hitting),
`'less'` to $p < p_0$ (psi-missing): the factor gains the ratio of posterior
to prior mass on that side, via negentropy's regularized incomplete beta.
`binomialLogBayesFactor` (alias `lnBayesFactor`) returns $\ln BF_{10}$ and
never overflows — it expands around the posterior mean with Stirling's
series, so $n = 10^6$ keeps ~14 significant digits (fixture: mpmath at 40
digits, side masses cross-checked against `scipy.special.betainc`) where the
linear form is `Infinity`. Rank, sum, and compare log factors. Unlike a
p-value a Bayes factor can quantify support *for* chance; symmetric priors
with $a = b > 1$ encode the honest expectation that any real effect is tiny.

### Normal statistics: Δz and friends

`zBayesFactor(z, { g, oneSided })` is the closed form for a standard-normal
statistic with effect prior $\mu \sim N(0, g)$:

$$BF_{10} = (1+g)^{-1/2} \exp\!\Big(\frac{z^2 g}{2(1+g)}\Big), \qquad
BF_{+0} = 2\,BF_{10}\,\Phi\!\Big(z\sqrt{\tfrac{g}{1+g}}\Big)$$

(the one-sided form uses the half-normal prior on $\mu > 0$).
`tripolarBayesFactor(analysis, { perBitEffectSd })` states the prior on the
per-bit scale — $\Delta\varepsilon \sim N(0, \sigma^2)$ becomes
$g = \sigma^2/(1/N_H + 1/N_L)$ for the analysis' bit counts — and tests
high > low one-sided by default. PEAR-scale expectations are
$\sigma \approx 10^{-4}$; a diffuse prior always favors H0 at small $z$
(Lindley), which is a property of the prior, not of the data. Both closed
forms are checked against numerical integration in the tests.

### Anytime-valid monitoring: `CoinEProcess`

With the prior fixed in advance, the running Bayes factor $M_n = BF_{10}(k_n, n)$
is a test martingale under $H_0$ (Shafer, Shen, Vereshchagin & Vovk 2011),
so by Ville's inequality

$$P_{H_0}\big(\exists n : M_n \ge 1/\alpha\big) \le \alpha$$

no matter how often you look or when you stop. `CoinEProcess` (sync) and
`coinEProcess(stream)` (async) report $\ln BF_{10}$, its running maximum, the
anytime p $= \min(1, 1/\max_{s \le n} M_s)$, and `reject` once it reaches α
(`stopOnReject` ends the stream there). Observations are single outcomes
`0 | 1` or increments `{ k, n }` (a 200-bit trial is `{ k: sum, n: 200 }`).

```ts
import { coinEProcess } from '@mindpeeker/psi'

for await (const point of coinEProcess(trials, { alpha: 0.01, stopOnReject: true })) {
  dashboard.show(point.n, point.lnBf10, point.anytimeP)
}
```

Why it matters — the law of the iterated logarithm: checking a fixed-n
two-sided p ≤ 0.05 after every flip of a *fair* coin (from flip 10 to 2000)
rejects with probability **0.511**; the e-process at 1/α = 20 rejects with
probability **0.037** (both computed exactly by dynamic programming in the
test suite).

### Sequential designs

`sequentialPlan({ bfStop, bfStopNull, minTrials, maxTrials, looks, prior })`
validates and freezes a sequential Bayes-factor design;
`sequentialPlanDigest(plan)` is the SHA-256 of its canonical JSON to publish
before data. `runSequential(observations, plan)` evaluates $BF_{10}$ at the
registered looks (`'every'`, `{ every: m }`, or explicit trial counts; the
maximum is always a look), stops at the first `stop_h1` / `stop_h0` /
`stop_max`, closes the input, and returns every look, the decision, and the
plan digest. $P_{H_0}(\text{stop\_h1}) \le 1/\text{bfStop}$ holds for any look
schedule; no such bound covers `bfStopNull` — the rate of misleading evidence
for H0 depends on the true effect and must be simulated for the design
(Schönbrodt, Wagenmakers, Zehetleitner & Perugini 2017).

## Errors

Every failure is a `PsiError` with a stable `code`:
`invalid_plan` | `insufficient_data` | `source_mismatch` | `plan_mismatch` |
`aborted` | `bad_record`. Caller input — plans, series, labels, windows,
seeds, options — is validated at the boundary, so malformed values surface
as `invalid_plan` rather than a foreign `TypeError`/`RangeError`. Errors
thrown inside composed negentropy calls on valid input propagate unchanged
except aborts, which are re-thrown as `aborted` here.

## Behaviour changes in 0.2.0

- **Label-shuffle null fixed (breaking).** `labelShuffleSurrogates` used only
  circular rotations and skipped the ones that reproduced the observed
  labeling; for the alternating target/control design that left $m$ copies of
  the complement and a false-positive rate near 50% at α = 0.05. It now draws
  seeded uniform permutations (default `seed: 0`, 100 surrogates) or
  enumerates every distinct relabeling exactly; rotations are opt-in via
  `method: 'rotation'` and count identity elements. `count` is a deprecated
  alias of `surrogates`. Relabelings are fresh (not frozen) arrays.
  `analyzePresentiment`'s `permutationP` changes accordingly.
- **`timeOffsetSurrogates`** gains `rotate: 'all-but-one' | 'all'`,
  `sourceOffsets`, `design`, `seed`, and `surrogates` (`count` deprecated);
  each `Surrogate` now also carries per-source `offsets`. The default
  single-source rotation is unchanged but documented as a power-limited null.
- **Rolling monitors (breaking):** `windowTrials`/`hopTrials` renamed to
  `windowSize`/`hopSize`; `bitsPerTrial` (integer ≥ 8) and `stepTimeoutMs`
  (finite in (0, 2³¹ − 1] or `Infinity`) are validated eagerly as
  `invalid_plan`; `rollingNetvar` reports the exact discrete floor instead of
  z = −8.21 when the window statistic is at its minimum, and takes the lower
  tail from the χ² CDF; `RollingPoint` gains `sourceCount`; a source that ends
  its stream after an abort yields `aborted`.
- **`analyzeEvent`** accepts step windows, `alignment: 'round'`,
  `calibration`, and `blockSeconds`; the result gains `calibrations` (and
  `blocked`). Malformed series (e.g. `bitsPerTrial ≤ 0`, sums outside
  $[0, k]$) throw `invalid_plan` instead of leaking negentropy errors; the
  envelope is memoized and returned as a fresh copy.
- **Tripolar:** `TripolarPlan.trialsPerRun` and `bitsPerTrial` are optional
  (defaults 50 and 200); `order` adds `'counterbalanced'`, `'instructed'`
  (seeded, `seed` required), and `'volitional'` (`declare` callback);
  `xorSafeguard` records odd trials as $k - x$. Runs carry `arm`,
  `assignment`, `order`, `xorSafeguard`, and `scheduleDigest`.
  `runTripolar` races the abort signal (a source that ends after an abort
  now yields `aborted`, not `insufficient_data`), awaits stream cleanup, and
  supports a yoked `control` source. `analyzeTripolar` rejects unknown
  intention labels and malformed series with `invalid_plan` (was a
  `TypeError`/`RangeError`), rejects mixed arms, throws the new
  `plan_mismatch` for mixed schedule digests or divergence from a
  `registration`, and adds `variance` to each `IntentionSummary` plus
  `scheduleDigest`/`registration`/`deviations` to the analysis.
- **New:** `registerTripolar`, `verifyTripolarRegistration`,
  `tripolarSchedule`, `tripolarScheduleDigest`, `resolveTripolarPlan`,
  `controlContrast`, `tostEquivalence`, `PEAR_RUN_TRIALS`,
  `PEAR_BITS_PER_TRIAL`, `analyzeFieldReg`, `placeboWindows`,
  `globalRankEnvelope`, `maxTAdjust`, `holm`, `benjaminiHochberg`,
  `describeLabelShuffle`, `DEFAULT_SURROGATES`; error code `plan_mismatch`.
- **`presentimentEpochs` (breaking):** overlapping epochs
  ($at_{i+1} - at_i <$ `preWindow + postWindow`) throw `invalid_plan` unless
  `allowOverlap: true`, which reports `overlapping` and a warning; events with
  `labelDrawnAt` at or before the pre-window's last trial stamp are dropped
  (`droppedProvenance`); a non-integer `at`, an unknown stimulus label, or a
  malformed series is `invalid_plan` (a non-integer `at` was silently
  dropped). The result is frozen and adds `droppedOutOfRange`,
  `droppedProvenance`, `overlapping`, and `warnings`.
- **`analyzePresentiment`:** unknown stimulus labels throw `invalid_plan`
  (were counted as controls and could surface a `RangeError`); malformed
  window series throw `invalid_plan`; new options `surrogates`, `seed`,
  `method`; the result adds `shuffle` (the null ensemble's description).
  Window sums are computed once per epoch, so `deltaZ` may differ from 0.1.x
  in the last floating-point digits.
- **`binomialBayesFactor`** accepts `p0` and `alternative` (defaults keep the
  0.1.x null $p_0 = \tfrac12$, two-sided); it is now computed through a
  Stirling expansion around the posterior mean (identical to ~1e-14).
- **Recording (breaking types):** `parseRecordLine` returns the union
  `SessionLine` (v1 trial | v2 header | v2 trial); narrow with `'kind' in line`
  or a cast before reading `sum`. `serializeRecordLine` validates and throws
  `bad_record` for lines that would not round-trip (non-finite `t`, sum out of
  range, …) instead of writing `null`s. `readSession` accepts a plain string
  as one chunk (was iterated per character), carries partial lines across
  chunks, reports physical line numbers (newline-terminated elements were
  counted twice), accepts schema v2, and rejects mixed schemas;
  `{"v":2,…}` without a header is now a `bad_record` for a missing header
  rather than an unsupported version. `recordSession` races the abort signal
  (a source that ends its stream after an abort yields `aborted` instead of a
  clean finish), awaits stream cleanup, validates source names, and adds
  `chain` and `tags`.
- **New (Bayes, recording, archive):** `binomialLogBayesFactor`,
  `lnBayesFactor`, `zBayesFactor`, `tripolarBayesFactor`, `CoinEProcess`,
  `coinEProcess`, `sequentialPlan`, `sequentialPlanDigest`, `runSequential`,
  `SEQUENTIAL_SCHEMA`, `verifyChain`, `ZERO_HASH`, `parseBasketCsv`,
  `GCP_BASKET_FILTER`, and the types behind them.

## What this package will not tell you

The MMI hypothesis — that intention or collective attention correlates
with the output of physical random sources — is **contested**. PEAR's
results were not reproduced in the consortium replication (Jahn et al.
2000); GCP's cumulative excess has both proponent (Bancel & Nelson) and
skeptical (May & Spottiswoode) analyses that disagree about selection
effects. Nothing in this package settles that dispute, and running it on
your own hardware will not either, in any single session.

What these tools do guarantee: exact null distributions inherited from
negentropy's scipy/mpmath-validated numerics, deviation-from-chance
quantified under protocols you must state *before* looking at the data,
byte-exact recordings that let anyone re-derive your numbers, resampling
nulls and multiplicity adjustments that answer the multiplicity objection,
and Bayes factors that can come out in favor of chance. They quantify
deviation from chance under pre-registered protocols; they do not establish
mechanism. A significant deltaZ is a fact about your data, not an
explanation of it — RF pickup, temperature drift, and selection bias are all
"significant" too. Register first (`registerTripolar`, negentropy's
`registerExperiment`), record everything, report the composite, and let the
surrogates keep you honest.

## Development

```sh
bun test                              # fixtures are checked in — no Python needed
uv run scripts/fixtures/generate.py   # regenerate fixtures (scipy)
bun run typecheck && bun run build
```
