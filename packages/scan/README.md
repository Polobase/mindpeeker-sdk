# @mindpeeker/scan

An honest, application-level **radionic scanning and broadcasting** layer that
ports [AetherOnePi](https://github.com/isuretpolos/AetherOnePi)'s analysis and
broadcast model onto the published mindpeeker-sdk primitives — and adds the one
thing AetherOne never had: **a real statistical null model.**

It composes, without re-implementing, four siblings:

- [`@mindpeeker/oracle`](../oracle) — the **unbiased** `uniformInt`
  (rejection sampling) and `drawWithoutReplacement` that every random choice
  here bottoms out in. This is the whole reason the SDK version exists: the
  frontend `scanCatalog` selects with a biased `x mod n` reduction; this
  package never does.
- [`@mindpeeker/rate`](../rate) — `parseRate`, `dialToBase44`, and the
  `xorImprint` / `phaseModulate` / `rateMask` stream modulation a broadcast
  applies.
- [`@mindpeeker/psi`](../psi) — `binomialBayesFactor` for the deviation model
  and `runTripolar` / `analyzeTripolar` for the rigorous PEAR MMI scan.
- [`@mindpeeker/negentropy`](../negentropy) — `normSf` (scipy-validated) for
  the deviation z → p tail.

Browser-safe (only `crypto.subtle`, async), ESM, TypeScript strict. Every
`@mindpeeker/entropy` provider — the webcam TRNG, the ESP32 serial TRNG that
*is* the AetherOnePi board, ANU QRNG, a crypto fallback — drops in as a source
**structurally**, no adapter:

```ts
interface ByteSource {
  readonly name: string
  stream(opts?: { signal?: AbortSignal; chunkBytes?: number }): AsyncIterable<Uint8Array>
}
```

## Quick start

```ts
import { defineCatalog, scan, broadcast, scanTripolar } from '@mindpeeker/scan'

const remedies = defineCatalog('kit', 'Travel kit', [
  { name: 'Arnica' }, { name: 'Nux vomica' }, { name: 'Rescue' }, /* … */
])

// 1. scan a catalog: AetherOne EV race + General Vitality + honest deviation
const report = await scan(remedies, source)              // source = any ByteSource
for (const r of report.results.slice(0, 5)) {
  console.log(r.rank, r.name, r.energy, r.vitality, r.deviation?.bayesFactor)
}

// 2. broadcast a rate/witness/signature; get a reproducible receipt
const run = broadcast('subject signature', source, { rounds: 100 })
let step = await run.next()
while (!step.done) step = await run.next()   // step.value: BroadcastTick per round
const receipt = step.value                    // BroadcastReceipt (JSONL v1)

// 3. the rigorous MMI version: a pre-registered tripolar protocol
const tri = await scanTripolar(remedies, source, {
  trialsPerRun: 100, bitsPerTrial: 200, runsPerIntention: 10,
})
console.log(tri.deltaZ, tri.analysis.deltaP)  // high-minus-low, ~N(0,1) under H0
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

`race` is a faithful port of AetherOne's `AnalysisService.analyseRateList`: draw
a random subset of the catalog, then run the **EV race** — each pass adds a
`uniformInt(0..10)` to every item's Energetic Value; the first to cross
`maxValue` wins. `generalVitality` is AetherOne's best-of-three `uniformInt(0..1000)`
with the open-ended `>950` explosion.

**`energy`, `vitality`, and AetherOne's "hit" thresholds have no chance
baseline.** AetherOne calls `GV > 1400` a hit and fires a broadcast "resonance"
at a 1-in-6765 rate — but *a fair TRNG produces exactly those events at exactly
those rates.* Without a null model, a "hit" is not evidence of anything. These
fields are reported for parity and context only.

### The deviation null model (`scanDeviation`, `deviation` field) — the value-add

This is what AetherOne lacks. Each catalog item is treated as an **independent
Bernoulli process with a known, exact chance rate**: a fair per-item coin, one
unbiased bit per round, so

$$p_0 = \tfrac12 \quad\text{(exact, not estimated).}$$

Over $N$ rounds it counts successes $k_i$ and reports, per item,

$$z_i = \frac{k_i - N p_0}{\sqrt{N p_0 (1-p_0)}} = \frac{k_i - N/2}{\sqrt{N/4}},
\qquad p_i = 2\,\Phi(-|z_i|), \qquad
BF_{10} = \frac{B(k_i+a,\ N-k_i+b)}{B(a,b)}\,2^{N},$$

where $z_i$ is standard normal under $H_0$, $p_i$ is its two-sided normal tail
(negentropy's scipy-validated `normSf`), and $BF_{10}$ is `binomialBayesFactor`,
whose null is exactly this $p_0 = \tfrac12$.

- **Under a fair source every item is null:** $BF_{10} \approx 1$, $z \approx 0$,
  and the $p$-values are $\sim \mathrm{Uniform}(0,1)$. The test suite asserts
  this.
- **A source biased toward one item raises *that* item's** $BF_{10}$ and $|z|$
  and lowers its $p$. The test suite asserts this too.

A high deviation score is a **chance-deviation flag, not evidence of
mind–matter interaction.** RF pickup, a warm oscillator, a biased ADC, or a bug
all produce "significant" deviations. And because $M$ items are each tested,
some will look significant by luck — expect on the order of $M/20$ to cross
$p < 0.05$ under the null. **Correct for multiplicity** (Bonferroni $\alpha/M$,
or lean on the Bayes factors, which can come out *for* the null) and register
your hypothesis before looking.

### Broadcasting (`broadcast`, `signatureToRate`)

`broadcast` modulates a live entropy stream by a target rate — reversibly via
`xorImprint` (the default; applying it twice is the identity), or via
`phaseModulate` / `rateMask`. It tallies a rare "resonance" at the AetherOne
1-in-6765 rate and returns a JSONL v1 `BroadcastReceipt`
(`{v,t,target,witnessHash?,bytesConsumed,resonances,rounds}`).

This is **deterministic digital signal processing over an entropy stream, plus
a reproducibility receipt — nothing more. No transmission, no
action-at-a-distance, and no physical effect on any subject is claimed or
occurs.** The "resonance" is a labelled random event with a stated rate, not a
detected wave. `signatureToRate` is a deterministic SHA-256 → base-44 mapping
(the SDK-honest analogue of AetherOne's "Broadcast of Hashed Signatures"); no
signature is transmitted anywhere.

### The rigorous MMI scan (`scanTripolar`)

If you actually want to *test* Reading B, this is the honest way: a
**pre-registered** PEAR tripolar protocol via `@mindpeeker/psi`. Intentions
(high / low / baseline), schedule, bit budget, and $p_0$ are all fixed before
the data. The primary statistic is `deltaZ` (high minus low), standard normal
under $H_0$; common-mode device drift cancels in the difference. A non-zero
`deltaZ` is a fact about your bytes, **not** proof of a mechanism.

## Is there science behind any of this? Honestly:

- **Radionics as medicine is pseudoscience.** No plausible physical or
  biological mechanism; no controlled trial has shown diagnostic or therapeutic
  validity; regulators have acted against radionic devices (Wikipedia;
  Quackwatch; Skepdic). **This package makes no medical, diagnostic, or
  efficacy claim of any kind.** Do not use it as one.
- **The underlying premise (intention biasing an RNG = micro-PK / MMI)** has a
  real but *contested and most-likely-null* record:
  - **PEAR** (Jahn & Dunne, 1979–2007) reported effects, but extraordinarily
    tiny (~$10^{-4}$ bits/trial).
  - **Radin & Nelson**'s meta-analysis reported odds "$10^{50}$" against
    chance — heavily criticised for selection and quality effects.
  - **Bösch, Steinkamp & Boller 2006** (*Psychological Bulletin*): the overall
    effect is tiny and heterogeneous, and *vanishes / reverses* once PEAR's
    huge "Mega-REG" study is included — attributed to **publication bias**.
  - A **three-lab consortium failed to replicate** PEAR's mean shift (Jahn et
    al. 2000).
  - A **2018 Bayesian reanalysis** found **evidence _against_ micro-PK**.

The mindpeeker value-add over AetherOne is precisely this honesty: AetherOne's
`GV > 1400` "hit" and 1-in-6765 "resonance" have no chance baseline; our
`deviation` model supplies one, and this document says plainly that a deviation
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
import { defineCatalog, catalogFromRateEntries } from '@mindpeeker/scan'

defineCatalog('kit', 'Kit', [{ name: 'Arnica', rate }, { name: 'Silica' }])

// bridge the frontend RateEntry.systems shape → base-44 rates, tolerant of
// missing systems (combe.base10 → dialToBase44; krt two-dial → base-100 → 44; …)
const catalog = catalogFromRateEntries(rateIndexEntries)
```

## Errors

Every failure is a `ScanError` with a stable `code`: `invalid_catalog` |
`insufficient_entropy` | `invalid_target` | `aborted`. Aborts and source
starvation from the composed primitives are re-mapped onto these codes; all
other errors propagate unchanged.

## Development

```sh
bun test                              # fixtures are checked in — no Python needed
uv run scripts/fixtures/generate.py   # regenerate the scipy deviation fixture
bun run typecheck && bun run build
```

Attribution: the scanning and broadcasting model is inspired by
**AetherOnePi** by isuretpolos. This package is an independent, honestly-framed
re-expression on the mindpeeker-sdk, not a fork of its code.
