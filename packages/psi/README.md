# @mindpeeker/psi

Mind-matter-interaction (MMI) experiment protocols and live anomaly
monitoring, composing [`@mindpeeker/negentropy`](../negentropy).

Negentropy owns the statistics — trials, calibration, Stouffer z, netvar,
devvar, cumulative deviation, envelopes, the pre-registered experiment
layer. This package owns the *experimental designs and workflows* built on
top of them:

- **PEAR-style tripolar protocols** — intention-tagged runs
  (high / low / baseline) over a live source, with the high-minus-low
  primary statistic and per-bit effect sizes
- **GCP-style formal event analysis** — the full netvar / devvar /
  cumulative-deviation bundle over recorded multi-source data
- **Rolling monitors** — dashboard-ready Stouffer and netvar windows over
  live sources, batch-reproducible
- **JSONL recording and deterministic replay** — sink-agnostic session
  records that reproduce a live analysis exactly
- **Time-offset surrogates** — honest family-wise empirical p-values
- **Binomial Bayes factors** — evidence that can also *support* chance

Zero runtime dependencies besides `@mindpeeker/negentropy` (workspace
sibling, itself zero-dep), browser-safe, ESM. Every `@mindpeeker/entropy`
provider works as an input source *structurally* — the packages share a
shape, not code:

```ts
interface TrialSource {
  readonly name: string
  stream(opts?: { signal?: AbortSignal; chunkBytes?: number }): AsyncIterable<Uint8Array>
}
```

Bits are MSB-first SDK-wide; a *trial* is the number of one-bits among
`bitsPerTrial` consecutive bits — Binomial(k, ½) under H0, normalized as
z = (x − k/2)/√(k/4). Default k = 200, the Global Consciousness Project
convention (mean 100, variance 50, one trial per second).

## Quick start

```ts
import {
  runTripolar, analyzeTripolar,
  recordSession, readSession, analyzeEvent,
  rollingStouffer, timeOffsetSurrogates, permutationP,
  binomialBayesFactor,
} from '@mindpeeker/psi'

// 1. run a tripolar protocol over any TrialSource
const runs = []
for await (const run of runTripolar(source, {
  trialsPerRun: 100, bitsPerTrial: 200, runsPerIntention: 10,
})) runs.push(run)

const result = analyzeTripolar(runs)
console.log(result.deltaZ, result.deltaP, result.high.effectSize)

// 2. record a multi-source session as JSONL, replay it later
for await (const line of recordSession([anu, drand], { bitsPerTrial: 200 })) {
  file.write(`${line}\n`) // sink-agnostic — you persist the lines
}
const series = await readSession(savedLines)
const event = analyzeEvent(series, { startMs, endMs })

// 3. honest family-wise p via surrogates
const nulls = [...timeOffsetSurrogates(series)].map(
  (s) => analyzeEvent(s.series, { startMs, endMs }).netvar.statistic,
)
const p = permutationP(event.netvar.statistic, nulls)
```

## Protocols: tripolar (PEAR)

The Princeton Engineering Anomalies Research tripolar design (Jahn, Dunne
et al. 1997, *Correlations of Random Binary Sequences with Pre-Stated
Operator Intention*) interleaves three intentions — aim high, aim low,
leave alone — so the primary statistic is a **difference**:

$$\Delta z = \frac{\varepsilon_H - \varepsilon_L}{\sqrt{1/N_H + 1/N_L}}
\;\sim\; N(0,1) \text{ under } H_0,$$

which reduces to $(z_H - z_L)/\sqrt{2}$ for balanced designs. Common-mode
device bias or drift shifts high and low runs equally and cancels in the
difference — that is the entire point of the design, and why
`order: 'interleaved'` (the default) is preferable to `'fixed'` blocks.

Per intention, `analyzeTripolar` reports Stouffer's combined
$z = \sum_i z_i/\sqrt{n}$, the per-bit effect size
$\varepsilon = z/\sqrt{N_\text{bits}}$ (which estimates $2(p - \tfrac12)$),
and a normal-approximation 95% CI $\varepsilon \pm z_{0.975}/\sqrt{N_\text{bits}}$.
Intention p-values are one-sided in the *pre-stated* direction; the
baseline is two-sided. PEAR-scale effects are $\varepsilon \sim 10^{-4}$ —
plan bit budgets accordingly before claiming a null result.

## Events: GCP formal analysis

`analyzeEvent(seriesBySource, { startMs, endMs })` follows the Global
Consciousness Project's formal-event conventions (Nelson et al. 2002;
Bancel & Nelson 2008): 200-bit trials at 1 Hz, $z = (x - 100)/\sqrt{50}$,
and the statistics

| field | definition | null |
|---|---|---|
| `netvar` | $\sum_t Z_s(t)^2$, $Z_s(t)$ the per-trial Stouffer across sources | $\chi^2(T)$ |
| `devvar` | $\sum_t \sum_i z_i(t)^2$ | $\chi^2(TN)$ |
| `cumdev` | $D(t) = \sum_{s\le t}(Z_s(s)^2 - 1)$ | flat, Var $= 2t$ |
| `envelope` | $\chi^2_{\text{ppf}}(1-p, t) - t$, pointwise | — |
| `composite` | $\sum_t Z_s(t)/\sqrt{T}$, pooled mean shift | $N(0,1)$ |

Every number is a thin composition of negentropy's `zScores`, `stoufferZ`,
`netvar`, `devvar`, `cumulativeDeviation`, and `significanceEnvelope` —
the test suite asserts field-for-field equality with the primitives so the
composition cannot drift. Sources must be step-aligned inside the window
(recordings from `recordSession` are, by construction); misalignment is a
`source_mismatch` error, never a silent truncation.

## Monitors: rolling windows

`rollingStouffer(sources, { windowTrials, hopTrials })` and
`rollingNetvar(...)` run negentropy's lock-step `session()` under the hood
and emit `{ at, z, n }` points on one shared N(0,1) dashboard scale —
`rollingStouffer` emits the window's Stouffer z directly, `rollingNetvar`
the normal-equivalent $z = \Phi^{-1}(1-p)$ of the window's $\chi^2$
upper-tail p. Windows are recomputed from scratch per emission, so a batch
recomputation over the same recorded trials reproduces every point
*exactly*. Abort via `signal` raises `PsiError('aborted')`; a source that
ends just drops from the roster.

Rolling windows are for *watching*, not claiming: a monitor scans many
overlapping windows, so crossing z = 3 somewhere is expected under H0 far
more often than Φ(−3) suggests. Claims belong to pre-registered windows.

## Recording and replay

`recordSession(sources)` yields JSONL lines (schema v1, fixed key order,
byte-deterministic):

```json
{"v":1,"t":1751980800000,"source":"anu","sum":104,"bitsPerTrial":200}
```

`readSession(lines)` groups them back into `TrialSeries[]` — and because
both the serialization and the analysis are deterministic,
`analyzeEvent(await readSession(lines), window)` reproduces the live
analysis exactly. Record first, analyze later, let others re-analyze: the
recording *is* the paper trail.

## Surrogates: honest family-wise p

negentropy documents its significance envelope as **pointwise** — an H0
path crosses it *somewhere* far more often than p. For family-wise honesty,
`timeOffsetSurrogates` circularly rotates one source's trial series
relative to the others ($x'_t = x_{(t+\tau) \bmod T}$, Theiler et al. 1992;
the GCP resampling convention). Each surrogate preserves the rotated
source's marginal distribution and autocorrelation exactly while destroying
cross-source simultaneity. Recompute your statistic per surrogate, then

$$p = \frac{1 + \left|\{\, i : s_i \ge s_{\text{obs}} \,\}\right|}{1 + m}$$

via `permutationP` — the +1 correction (Davison & Hinkley 1997; North,
Curtis & Sham 2002) counts the observed arrangement as a member of its own
null ensemble, so p is never zero. Deterministic: offsets are explicit or
evenly spaced, no RNG.

## Bayes factors

`binomialBayesFactor(k, n, { a, b })` tests $H_1: p \sim \mathrm{Beta}(a,b)$
against the chance null $H_0: p = \tfrac12$:

$$BF_{10} = \frac{B(k+a,\; n-k+b)}{B(a,b)}\, 2^n,$$

computed in log space via negentropy's fixture-validated `lnGamma`
(cross-checked here against `scipy.special.betaln`). Unlike a p-value, a
Bayes factor can quantify support *for* chance — for MMI claims that is
usually the number you actually want. Symmetric priors with $a = b > 1$
encode the honest expectation that any real effect is tiny.

## Errors

Every failure is a `PsiError` with a stable `code`:
`invalid_plan` | `insufficient_data` | `source_mismatch` | `aborted` |
`bad_record`. Errors thrown inside composed negentropy calls propagate
unchanged except aborts, which are re-thrown as `aborted` here.

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
byte-exact recordings that let anyone re-derive your numbers, surrogate
nulls that answer the multiplicity objection, and Bayes factors that can
come out in favor of chance. They quantify deviation from chance under
pre-registered protocols; they do not establish mechanism. A significant
deltaZ is a fact about your data, not an explanation of it — RF pickup,
temperature drift, and selection bias are all "significant" too. Register
first (negentropy's `registerExperiment`), record everything, report the
composite, and let the surrogates keep you honest.

## Development

```sh
bun test                              # fixtures are checked in — no Python needed
uv run scripts/fixtures/generate.py   # regenerate fixtures (scipy)
bun run typecheck && bun run build
```
