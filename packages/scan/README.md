# @mindpeeker/scan

An honest, application-level **radionic scanning and broadcasting** layer that
re-expresses [AetherOnePi](https://github.com/isuretpolos/AetherOnePi)'s (and
[AetherOnePy](https://github.com/isuretpolos/AetherOnePy)'s) analysis and
broadcast model on the mindpeeker-sdk primitives — and adds the one thing
AetherOne never had: **a real statistical null model.**

It composes, without re-implementing, four siblings:

- [`@mindpeeker/oracle`](../oracle) — the **unbiased** `uniformInt`
  (rejection sampling), `drawWithoutReplacement` (Fisher–Yates prefix), the
  MSB-first `bitReader`, and `byteReader`'s stream lifecycle. Every random
  choice here bottoms out in them; nothing uses a biased `x mod n` reduction.
- [`@mindpeeker/rate`](../rate) — `parseRate`, `dialToBase44`, the rate
  validity checks, and the `xorImprint` / `phaseModulate` / `rateMask` stream
  modulation a broadcast applies.
- [`@mindpeeker/psi`](../psi) — `binomialLogBayesFactor`, `holm`,
  `benjaminiHochberg`, and `runTripolar` / `analyzeTripolar` /
  `controlContrast` / `registerTripolar` for the rigorous PEAR MMI scan.
- [`@mindpeeker/negentropy`](../negentropy) — exact binomial tails
  (`binomialCdf` / `binomialSf`) and `chi2Sf` from its `./numerics` subpath.

Browser-safe (no `node:` imports), ESM, TypeScript strict, zero third-party
dependencies. Every `@mindpeeker/entropy` provider — the webcam TRNG, an
ESP32 serial TRNG (AetherOnePi reads one at 921 600 baud since April 2026), ANU
QRNG, a crypto fallback — drops in as a source **structurally**, no adapter:

```ts no-check
interface ByteSource {
  readonly name: string
  stream(opts?: { signal?: AbortSignal; chunkBytes?: number }): AsyncIterable<Uint8Array>
}
```

Every entry point opens **one** stream per call and closes it (so a serial
port's `close()` or a camera track's `stop()` runs) when the call completes,
fails, is aborted, or — for `broadcast` — when you stop iterating.

## Quick start

```ts
import {
  broadcast, defineCatalog, generalVitalitySf, scan, scanDeviation, scanTripolar,
} from '@mindpeeker/scan'
import { registerTripolar } from '@mindpeeker/psi'

const remedies = defineCatalog('kit', 'Travel kit', [
  { id: 'arn', name: 'Arnica' }, { id: 'nux', name: 'Nux vomica' }, { id: 'res', name: 'Rescue' },
])

// 1. scan a catalog: AetherOne EV race + General Vitality + honest deviation
const report = await scan(remedies, source) // source = any ByteSource
for (const r of report.results.slice(0, 5)) {
  console.log(r.rank, r.id, r.energy, r.vitality, r.vitalityP, r.deviation?.pHolm)
}
console.log(report.multiplicity?.omnibus.p) // "is the source off at all?"

// 2. the null model alone, with multiplicity bookkeeping
const deviation = await scanDeviation(remedies, source, { rounds: 256 })
console.log(deviation.multiplicity.expectedFalsePositives, generalVitalitySf(1400))

// 3. broadcast a rate/witness/signature; get a verifiable receipt
const run = broadcast({ signature: 'subject signature', kind: 'signature' }, source, { rounds: 100 })
let step = await run.next()
while (!step.done) step = await run.next() // step.value: BroadcastTick per round
const receipt = step.value // BroadcastReceipt v2: outputHash, witnessKind, …

// 4. the rigorous MMI version: a pre-registered tripolar protocol
const plan = { runsPerIntention: 10, order: 'instructed', seed: 'c0ffee' } as const
const registration = await registerTripolar(plan) // publish registration.hash first
const tri = await scanTripolar(remedies, source, plan, { registration, control: csprng })
console.log(tri.deltaZ, tri.analysis.deltaP, tri.control?.contrast.z)
```

## Reflection, not measurement

This is the project's governing stance, and it applies here without exception.
A quantum oracle reflects `mind ↔ chance`; radionics claims to both *diagnose*
(target → mind) and *broadcast* (mind → target). This package gives you the
mechanics of both, framed as **an exploratory synchronicity instrument, not a
validated effect.** It measures deviation from chance. It does not measure a
subject, a remedy, a field, or a mind.

### The two-tier honest fork (carried verbatim from the project)

Any reading has two interpretations, and we never pick one for you:

- **Reading A — the neutral key (well-supported).** The randomness carries
  *zero information* about you or your target. Whatever meaning a scan surfaces
  is made by the interpreter, the same way a coin toss or an I Ching cast
  becomes meaningful. On this reading the tool is a structured prompt for
  reflection, and it works exactly as well as any other aleatory method.
- **Reading B — the nudged substrate (contested / unproven).** Intention
  biases the entropy so "meaningful" items accumulate faster (micro-PK /
  mind–matter interaction). This is the claim AetherOne is built on. It is
  **not** established science (see below). We provide the statistics to *test*
  it honestly; we do not assert it.

## What the numbers mean — and don't

### The scan (`scan`, `race`, `generalVitality`)

`race` draws a random subset of the catalog — AetherOnePi's rule,
$s = \min(M, \mathrm{clamp}(\lfloor M/10 \rfloor, 120, 5000))$, via
`subsetFraction` / `subsetMin` / `subsetMax` — as a Fisher–Yates prefix, then
runs the **EV race**: each pass adds a `uniformInt(0..10)` to every raced
item's Energetic Value in draw order; the first to reach `maxValue` (default
100) wins. Within a pass an earlier position reaches the threshold first
(position 0 of 12 wins 0.118 of races, position 11 only 0.059), so the winner
is uniform over the catalog **only because** the draw order is a uniformly
random permutation prefix.

`generalVitality` is the best-of-three `uniformInt(0..1000)` with the
open-ended `>950` explosion. Its law under a fair source is known exactly —
`generalVitalitySf(t)` $= P(\mathrm{GV} > t)$, and every scan result carries
`vitalityP` $= P(\mathrm{GV} \ge \text{its value})$. `energy` has no chance
baseline at all; neither field says anything about an item. AetherOnePi's
**HIT** label marks the entry with the highest GV on the page, and its
**Auto-Mode** broadcasts a rate whose GV exceeds 1400 (or the target's GV by
700): under a fair source $P(\mathrm{GV} > 1400) \approx 0.00225$, about one
rate in 444. `GV_AUTO_MODE_THRESHOLD` exports the number.

### The deviation null model (`scanDeviation`, `deviation` field) — the value-add

Each catalog item is an **independent Bernoulli process with a known, exact
chance rate**: one fair coin per item per round, eight coins per source byte
(oracle's `bitReader`), so

$$p_0 = \tfrac12 \quad\text{(exact, not estimated).}$$

Over $N$ rounds it counts successes $k_i$ and reports, per item,

$$z_i = \frac{k_i - N/2}{\sqrt{N/4}}, \qquad
p_i = P\big(|K - \tfrac N2| \ge |k_i - \tfrac N2|\big),\ K \sim \mathrm{Binomial}(N, \tfrac12), \qquad
BF_{10} = \frac{B(k_i+a,\ N-k_i+b)}{B(a,b)}\,2^{N}.$$

- `p` is the **exact** two-sided binomial p (equal to scipy's `binomtest`); `z`
  is descriptive only. The normal tail it replaces rejected a fair coin with
  probability 0.077 at nominal 0.05 for $N = 16$; the exact test never exceeds
  its level.
- `lnBayesFactor` is psi's overflow-free $\ln BF_{10}$; items rank on it (ties
  broken by an id hash, never by catalog order), so a stuck-high source with
  $BF_{10} = \infty$ for every item still ranks deterministically.
- **Under a fair source** $z \approx 0$, $P(p \le \alpha) \le \alpha$ at every
  level, and $BF_{10}$ is typically **below 1** — median 0.095 at $N = 256$,
  below 1 for 98% of items — which is evidence *for* chance; only its mean is
  exactly 1. A source biased toward one item raises *that* item's
  $BF_{10}$ and $|z|$. The test suite asserts all of this.
- **Multiplicity is part of the report.** Each item carries `pBonferroni`,
  `pHolm` (family-wise error) and `qBH` (false discovery rate); the report's
  `multiplicity` states $M\alpha$ — how many unadjusted $p \le \alpha$ a fair
  source produces anyway — the counts at $\alpha$, and an omnibus
  $\sum_i z_i^2 \approx \chi^2(M)$ test that flags a *source* departing from a
  fair coin (slightly conservative: each $z_i^2$ has variance $2 - 2/N$).

A high deviation score is a **chance-deviation flag, not evidence of
mind–matter interaction.** RF pickup, a warm oscillator, a biased ADC, or a bug
all produce "significant" deviations. Read the adjusted values and register
your hypothesis before looking.

### Broadcasting (`broadcast`, `signatureToRate`)

`broadcast` modulates a live entropy stream by a target rate as **one
continuous stream** — reversibly via `xorImprint` (the default: the
concatenated ticks equal `xorImprint(rawStream, rate)`, and one inverse pass
recovers the raw bytes), or via `phaseModulate` / `rateMask`. It tallies a
rare "resonance" at $1/6765$ per round over the round's own bytes and returns a
JSONL v2 `BroadcastReceipt`
(`{v,t,mode,target,witnessKind?,witnessHash?,bytesConsumed,resonances,rounds,outputHash}`)
whose `outputHash` — SHA-256 of every modulated byte — lets a replay from
recorded raw bytes be verified rather than trusted.

Only a source that **ends** finishes a broadcast cleanly. A source that
**fails** — a health-test alarm from a stuck ESP32, an I/O error — rejects with
`ScanError('source_error')` (provider error as `cause`), never a clean-looking
receipt.

This is **deterministic digital signal processing over an entropy stream, plus
a reproducibility receipt — nothing more. No transmission, no
action-at-a-distance, and no physical effect on any subject is claimed or
occurs.** Even practitioner literature calls "broadcasting" a misnomer with no
radio technology involved [90979:3]. `signatureToRate` is a deterministic
SHA-256 → rate mapping (NFC-normalized, rejection-sampled digits, so base 44 is
exactly uniform and every base-336 digit is reachable); using a signature as a
witness goes back to Abrams' 1923 handwriting claims [7964:10].

### The rigorous MMI scan (`scanTripolar`)

If you actually want to *test* Reading B, this is the honest way: a
**pre-registered** PEAR tripolar protocol via `@mindpeeker/psi`. Intentions
(high / low / baseline), the schedule (`order`: fixed, interleaved,
counterbalanced, seeded instructed, or volitional with `declare`), bit budget,
and $p_0$ are fixed before the data; `registration` makes divergence
detectable; `control` runs a yoked control arm and reports psi's
`controlContrast`. The primary statistic is `deltaZ` (high minus low), standard
normal under $H_0$. One source stream serves both phases — the protocol, then
the per-intention catalog scoring in **the same intention sequence** — so a
replayable source never reuses bytes and `accounting` covers everything. A
non-zero `deltaZ` is a fact about your bytes, **not** proof of a mechanism; one
the control arm reproduces indicts the pipeline.

## Lineage: from stick pad to EV race (`sweepScan`)

The classical radionic scan has no random numbers in it. The operator puts the
witness in the well, sets every dial to its lowest setting, turns dial 1 (the
one nearest the well) slowly while stroking a rubber pad, stops at a "stick",
and moves to the next dial; an overshoot means starting over, and the dials
should not be watched [3047:38]; De La Warr's instructions describe the same
brushing strokes "until a stick is obtained" [51906:96]. The settings are the
rate. **The RNG race is AetherOne's invention**; the literature never states
how often a stick at a given position happens by chance.

`sweepScan(target, source, { model })` keeps the classical procedure and
replaces the stick with a draw of stated law, so the reading comes with its
exact null (`nullPmf`) and replays byte-for-byte:

- `'first-passage'` (default): at position $k$ of $P$ a stick occurs with
  probability $(k+1)/P$ — $P(k) = \frac{k+1}{P}\prod_{j<k}\big(1 - \frac{j+1}{P}\big)$,
  far from flat (mode near $\sqrt P$).
- `'uniform'`: every position has probability $1/P$.

The target is `{ dials, positions }` (stops form a `Rate`) or a catalog read
top to bottom.

## Fidelity and provenance vs AetherOne

Read from the AetherOnePi Java sources (`AnalysisService`, `HotbitsClient`,
`BroadcastElement`, `AnalyseScreen`, `GuiElements`) and AetherOnePy's
`analyzeService.py` / `hotbitsService.py`.

| Aspect | AetherOnePi (Java) | AetherOnePy | `@mindpeeker/scan` |
| --- | --- | --- | --- |
| Random numbers | `java.util.Random` seeded per call with time + a hotbit seed | `random.seed(hotbit)`, then `randint` | any `ByteSource`, rejection-sampled `uniformInt` / bit reader — replayable |
| Raced subset | shuffle, then size/10 clamped to [120, 5000] | 24 items (`getInt(0, len) − 1` gives the last item double weight); optional "enhanced" pre-race | Pi's rule by default; Py's 24 via `subsetMin: 24, subsetMax: 24`; exactly uniform prefix |
| EV increment | `nextInt(10)` = 0..9 | `randint(0, 10)` = 0..10 | 0..10 (Py) |
| Winning EV | 100 (1000 "very high") | 1000 | `maxValue`, default 100 |
| Race order within a pass | `HashMap` key order (follows name hashes) | shuffled list | draw order (uniform permutation prefix) |
| `numberOfTrials` | total EV increments | not reported | passes; the sum of `trials` is Pi's count |
| General Vitality | max of 3 × `nextInt(1000)`, explosion `nextInt(100)` | `randint(0, 1000)`, `randint(0, 100)` | Py's ranges, plus the exact tail `generalVitalitySf` |
| HIT / Auto-Mode | HIT = highest GV shown; broadcast if GV > 1400 or > target GV + 700 | not examined | `GV_AUTO_MODE_THRESHOLD`, $P(\mathrm{GV} > 1400) \approx 0.00225$ |
| Potency / level analyses | chance races over tables | potency in the domain model (not examined) | not ported |
| Resonance | `SecureRandom.nextInt(6765 + multiplier)` top value (multiplier default 1) per painted layer | not examined | `uniformInt(round, 6765)` top value per round, from the broadcast's own bytes |
| Hashed-signature broadcast | yes | signature broadcasts (hashing not examined) | `signatureToRate` (SHA-256, rejection) |
| Char-code LED rate | √Σ char codes, 2 dp | not examined | `rateFromCharCodes` (parity) |
| Null model, multiplicity | none | none | exact binomial p, $\ln BF_{10}$, Holm/BH, omnibus |
| Records | case / protocol files | SQLite database | JSONL receipt v2 with `outputHash` |
| Hardware | Raspberry Pi / webcam; ESP32 `esp_fill_random` at 921 600 baud with optional SHA-512 whitening (2026-04) | webcam / Pi | any `@mindpeeker/entropy` provider |

## Is there science behind any of this? Honestly:

- **Radionics as medicine is pseudoscience.** No plausible physical or
  biological mechanism; no controlled trial has shown diagnostic or therapeutic
  validity; regulators have acted against radionic devices. **This package
  makes no medical, diagnostic, or efficacy claim of any kind.** Do not use it
  as one. The historical tests (ark-db library references in brackets):
  - **Horder committee, 1924** — a British committee chaired by Sir Thomas
    Horder concluded that "the fundamental proposition originally announced by
    Dr. Albert Abrams must be regarded as established to a very high degree of
    probability" [52451:139]. What it examined were reaction tests with
    W. E. Boyd's emanometer [846:562] — reproducibility of a reaction, not
    diagnosis or treatment of disease.
  - **Drown, 1950** — a test of Ruth Drown's instrument under the auspices of
    the American Medical Association "was completely negative" [16745:326].
- **The underlying premise (intention biasing an RNG = micro-PK / MMI)** has a
  real but *contested and most-likely-null* record:
  - **PEAR** (Jahn & Dunne, 1979–2007) reported effects, but extraordinarily
    tiny (~$10^{-4}$ per bit).
  - **Radin & Nelson 1989** (*Foundations of Physics* 19:1499–1514) pooled the
    RNG studies into a highly significant combined deviation — criticised for
    selection and study-quality effects.
  - **Bösch, Steinkamp & Boller 2006** (*Psychological Bulletin*): the overall
    effect is tiny and heterogeneous, and *vanishes / reverses* once PEAR's
    huge "Mega-REG" study is included — attributed to **publication bias**.
  - A **three-lab consortium failed to replicate** PEAR's mean shift (Jahn et
    al. 2000).
  - **Maier, Dechamps & Pflitsch 2018** (*Frontiers in Psychology* 9:379) ran
    a **new** online experiment with a sequential Bayesian design (n = 12 571)
    and found **evidence _against_ micro-PK**, $BF_{01} = 10.07$.

The mindpeeker value-add over AetherOne is precisely this honesty: AetherOne's
GV thresholds and 1-in-6765 "resonance" have no stated chance baseline; this
package states one for every number it can, and says plainly that a deviation
is not evidence of the claimed mechanism.

## The anti-manipulation ethic (ported from AetherOnePi)

AetherOnePi ships an explicit ethic — a SAFETY_SWITCH that sprays LOVE /
BALANCE / DO NO HARM, dowsing-permission questions, "for the best and good of
all." We port that stance as documentation: **do not use this to target,
profile, or act upon a person without their knowledge and consent.** Broadcasts
here have no physical effect, but the intent to covertly influence is the thing
the ethic guards against. Keep it.

## Catalogs

```ts
import { catalogFromRateEntries, defineCatalog } from '@mindpeeker/scan'

defineCatalog('kit', 'Kit', [{ id: 'arn', name: 'Arnica', rate }, { name: 'Silica' }])

// bridge the frontend RateEntry.systems shape → base-44 rates, tolerant of
// missing systems (combe.base10 → dialToBase44; krt dials → base-100 → 44; …)
const catalog = catalogFromRateEntries(rateIndexEntries)
```

Ids (`id ?? name`) must be unique and names unique within a category — every
result row carries its item's `id`. `defineCatalog` stores deeply frozen
copies and validates rates with `@mindpeeker/rate`'s own checks. The KRT and
Delawarr projections are modeled and lossy (KRT fractions and the distinct
`100.00` setting are rounded away); rates are instrument-specific in the
literature [3047:36].

## Errors

Every failure of an entry point is a `ScanError` with a stable `code`:
`invalid_catalog` | `invalid_options` | `insufficient_entropy` |
`invalid_target` | `source_error` | `aborted`. Options and targets are
validated before any byte is read. Failures of the composed primitives map by
one rule: aborts → `aborted`; a source that ends → `insufficient_entropy`; a
source that fails (oracle `source_error`, negentropy `source_failed`, a
non-byte chunk) → `source_error` with the provider's own error as `cause`; a
rejected tripolar plan or registration → `invalid_options`. Errors thrown by
your own callbacks (`broadcast`'s `now`, `scanTripolar`'s `declare`) propagate
unchanged.

## Behaviour changes in 0.2.0

- **Streams are released.** `scan`, `scanDeviation`, `generalVitality`,
  `broadcast` (including an early `return()`/`break`), and `scanTripolar` close
  the source stream they open; 0.1 left serial ports and camera tracks open.
- **`broadcast` error contract (breaking).** Only a source that ends finishes
  cleanly; source failures reject with `source_error` instead of returning a
  shortened receipt. Invalid `resonanceOdds`/`resonanceValue` are rejected
  instead of silently never resonating; `roundBytes` must hold one resonance
  draw.
- **Validation.** New codes `invalid_options` and `source_error`. `maxValue`
  (finite ≥ 1), `subsetFraction` ((0, 1]), `rounds`/`deviationRounds`
  (integers ≥ 1; broadcast `rounds` ≥ 0), `prior` (finite shapes > 0),
  `alpha`, `roundBytes`, `durationMs`, `mode`, `signal`, and the source shape
  are checked up front — NaN/∞ no longer hang the race, and `RangeError`,
  `PsiError`, `OracleError`, `RateError` no longer leak. Rate-object broadcast
  targets are validated with rate's checks (`invalid_target`) before any byte
  is read. `scanDeviation` rejects an empty catalog.
- **Exact p-values (breaking).** `DeviationResult.p` is the exact two-sided
  binomial p (was the normal tail); `z` is unchanged and descriptive.
- **Ranking.** Deviation ranks use `lnBayesFactor` (new field) and compare
  without subtraction (`Infinity − Infinity` gave catalog order); ties break on
  a hash of the item **id** (was the name).
- **Multiplicity.** Results gain `pBonferroni`, `pHolm`, `qBH`; `ScanReport`,
  `DeviationReport` and `TripolarScanReport` gain `multiplicity`
  (expected false positives, counts, omnibus χ²).
- **Deviation coins (breaking for replays).** Eight coins per byte via the bit
  reader (was one byte per coin): 8× less entropy, different results for the
  same bytes; `bitsUsed` now counts bits that entered a decision.
- **Race subset rule (breaking).** Default subset is AetherOnePi's
  $\min(M, \mathrm{clamp}(\lfloor M/10 \rfloor, 120, 5000))$ (was
  $\max(12, \mathrm{round}(M/10))$); new `subsetMin`/`subsetMax`;
  `race`, `raceSubsetSize`, and their types are exported.
- **Results carry `id`** and, with vitality, `vitalityP`;
  `generalVitalitySf`, `GV_AUTO_MODE_THRESHOLD`, `generalVitalityReader`,
  `deviationStat`, `byBayesFactor`, `tieBreakKey`, `binomialTwoSidedP` are
  exported.
- **Catalogs.** `defineCatalog` rejects duplicate ids, duplicate names within a
  category, and invalid rates; it stores frozen copies instead of freezing the
  caller's rate object (whose `digits` stayed mutable).
- **Broadcast modulation is one stream (breaking).** The ring index no longer
  restarts each round, so outputs differ whenever `roundBytes` is not a multiple
  of the digit count. Receipts are **v2** (`mode`, `witnessKind`,
  `outputHash`); `parseReceipt` still reads v1 and is strict (unknown keys, bad
  counts or hashes are rejected). A rate-string target no longer gets a
  `witnessHash`.
- **`signatureToRate` (breaking).** NFC normalization and rejection-sampled
  digits from an extended digest: different rates for the same signature; base
  44 exactly uniform, base 336 fully reachable, no repetition past 32 digits;
  `length`/`base` validated; the returned rate is frozen.
- **`scanTripolar` (breaking).** One stream for both phases (was two, so a
  replayable source reused phase-1 bytes); catalog scoring follows the
  protocol's intention sequence (was fixed high → low → baseline blocks);
  `accounting` covers both phases (new `phaseAccounting`); new options `prior`,
  `alpha`, `control`, `registration`, `declare`; report gains `order`,
  `schedule`, `registration`, `control`.
- **New:** `sweepScan` / `sweepNullPmf` (classical dial sweep with an exact
  null), `WITNESS_KINDS` and `Witness.kind`.

## Development

```sh
bun test                              # fixtures are checked in — no Python needed
uv run scripts/fixtures/generate.py   # regenerate the scipy/statsmodels/exact-rational fixtures
bun run typecheck && bun run build
```

Attribution: the scanning and broadcasting model is inspired by
**AetherOnePi** and **AetherOnePy** by isuretpolos. This package is an
independent, honestly-framed re-expression on the mindpeeker-sdk, not a fork of
their code.
