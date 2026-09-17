# Cookbook

Twelve end-to-end recipes that combine several mindpeeker-sdk packages. Each one answers a
concrete question, says what its result can and cannot mean, shows the complete script, and
shows what the script printed.

The rule from the root README holds throughout: the mathematics is asserted, the contested
hypotheses are not. A recipe can tell you that a source, a log or a design behaves unlike its
stated null model. It cannot tell you why, and none of them is evidence for or against
mind–matter interaction, divination or radionics as such.

| # | Recipe | Question it answers | Packages |
|---|---|---|---|
| 1 | [Live monitor with an anytime-valid boundary](#1-live-monitor-with-an-anytime-valid-boundary) | When may I stop watching a live cumulative-deviation plot and claim something? | entropy, negentropy |
| 2 | [Pre-registered tripolar run with a control arm](#2-pre-registered-tripolar-run-with-a-control-arm) | How does a reader check that the plan came first, the data are unedited and a control arm was compared? | entropy, psi, ledger, vdf, negentropy |
| 3 | [Transfer-entropy independence check](#3-transfer-entropy-independence-check) | Does one entropy source leak into another? | entropy, flow, psi, negentropy |
| 4 | [Oracle casts with exact accounting and replay](#4-oracle-casts-with-exact-accounting-and-replay) | Which bytes produced this reading, and did the cast follow its stated odds? | entropy, oracle |
| 5 | [Is my field special?](#5-is-my-field-special) | Is the densest point of a random field unusual, or just the densest point? | entropy, oracle, field |
| 6 | [Pricing a gematria coincidence](#6-pricing-a-gematria-coincidence) | How cheap is an equal-value "match" in a given lexicon? | gematria, coincidence, oracle, entropy |
| 7 | [Radionic scan with an honest null](#7-radionic-scan-with-an-honest-null) | What does a catalog scan show on a fair source, and on a broken one? | scan, entropy |
| 8 | [Scoring forced-choice studies](#8-scoring-forced-choice-studies) | How are ganzfeld hits and Zener runs scored exactly, and what does picking the best batch cost? | judging, oracle, entropy |
| 9 | [Local sidereal time scan](#9-local-sidereal-time-scan) | Does an effect depend on sidereal time once the search itself is part of the null? | ephemeris, negentropy, oracle, entropy |
| 10 | [Beacon rounds and structural checks](#10-beacon-rounds-and-structural-checks) | Where did public randomness come from, and what can I check without trusting the mirror? | entropy |
| 11 | [Tamper-evident log with Merkle proofs](#11-tamper-evident-log-with-merkle-proofs) | Can I prove one record is in a published log, and that the log only grew? | ledger, psi, entropy |
| 12 | [Custom provider with health tests](#12-custom-provider-with-health-tests) | How do I wrap my own device, and what do health tests catch that statistics miss (and vice versa)? | entropy, negentropy |

## Running the recipes

The scripts live in the private workspace member [`examples/`](../examples) and import the
packages from source, so no build is needed:

```sh
bun install
bun examples/src/01-live-monitor.ts                  # offline and deterministic
bun examples/src/01-live-monitor.ts --source crypto  # the runtime CSPRNG instead
bun run examples                                     # smoke test: every recipe with --smoke
```

Every script accepts the same flags. `--source` picks the entropy (offline, crypto, drand,
curby, nqsn, anu-legacy, qrandom-io, padova), `--control` picks a second, independent source
where a recipe needs one, `--live` fetches beacon rounds over the network instead of the
recorded fixture (recipes 2 and 10), and `--smoke` shrinks every size. Public beacons are slow (drand publishes
32 bytes every 3 s) and serve only one role per script, because two instances would return the
same bytes.

The default source, `offline`, is HMAC_DRBG (NIST SP 800-90A) over a fixed seed written in
the helper below. Offline runs therefore reproduce byte for byte: the smoke test runs every
recipe twice and requires identical output. A DRBG is a deterministic control. It is never a
secret, and it is not physical randomness. Every "Output" block below is the unedited offline
output of the script above it (Bun 1.3.1, 2026-09-17), except where a block says otherwise.

The smoke test also checks that every code block in this page is identical to its file in
`examples/src/`, and `scripts/check-readme-imports.ts` checks every import against the real
package exports.

### Shared helpers

`examples/src/lib/cli.ts` parses the flags and opens sources:

```ts
/**
 * Shared command line of the cookbook recipes (docs/cookbook.md).
 *
 *   --source <name>   entropy for the recipe (default: offline)
 *   --control <name>  a second, independent source where a recipe needs one (default: offline)
 *   --live            fetch public beacon rounds over the network instead of the recorded fixture
 *   --smoke           tiny sizes; used by examples/test/smoke.test.ts
 *
 * `offline` is HMAC_DRBG (SP 800-90A) over a fixed seed printed in this file, so every
 * offline run reproduces byte for byte. It is a deterministic control, never a secret.
 */
import type { EntropyProvider } from '@mindpeeker/entropy'
import {
  anuLegacy,
  cryptoProvider,
  curby,
  drand,
  drbgProvider,
  nqsn,
  padova,
  qrandomIo,
} from '@mindpeeker/entropy/providers'

export interface RecipeArgs {
  readonly source: string
  readonly control: string
  readonly live: boolean
  readonly smoke: boolean
}

export const SOURCE_NAMES = [
  'offline',
  'crypto',
  'drand',
  'curby',
  'nqsn',
  'anu-legacy',
  'qrandom-io',
  'padova',
] as const

const PUBLIC_BEACONS = new Set(['drand', 'curby', 'nqsn'])
const opened = new Set<string>()

function sourceName(value: string | undefined, flag: string): string {
  if (value === undefined || !(SOURCE_NAMES as readonly string[]).includes(value)) {
    throw new Error(`${flag} must be one of ${SOURCE_NAMES.join(', ')}; got ${String(value)}`)
  }
  return value
}

/** Parse the shared flags; unknown flags are an error, not silently ignored. */
export function parseArgs(argv: readonly string[] = process.argv.slice(2)): RecipeArgs {
  let source = 'offline'
  let control = 'offline'
  let live = false
  let smoke = false
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = (argv[i] ?? '').split('=', 2)
    const value = () => inline ?? argv[++i]
    if (flag === '--source') source = sourceName(value(), '--source')
    else if (flag === '--control') control = sourceName(value(), '--control')
    else if (flag === '--live') live = true
    else if (flag === '--smoke') smoke = true
    else
      throw new Error(`unknown argument ${argv[i]} (flags: --source, --control, --live, --smoke)`)
  }
  return { source, control, live, smoke }
}

/**
 * Open a named source for one role in a recipe. The provider is renamed to
 * `<label>=<provider name>` so several roles stay distinct in recordings. Offline
 * roles get independent DRBG streams (the label is part of the seed). A public
 * beacon can serve only one role: two instances would return identical bytes.
 */
export function openSource(name: string, label: string): EntropyProvider {
  if (PUBLIC_BEACONS.has(name)) {
    if (opened.has(name)) throw new Error(`${name} is public: two roles would be identical streams`)
    opened.add(name)
  }
  const seed = new TextEncoder().encode(`mindpeeker cookbook offline seed v1 / ${label}`)
  const providers: Record<string, () => EntropyProvider> = {
    offline: () => drbgProvider({ seed }),
    crypto: () => cryptoProvider(),
    drand: () => drand(),
    curby: () => curby(),
    nqsn: () => nqsn(),
    'anu-legacy': () => anuLegacy(),
    'qrandom-io': () => qrandomIo(),
    padova: () => padova(),
  }
  const provider = (providers[sourceName(name, 'source')] as () => EntropyProvider)()
  return Object.freeze({ ...provider, name: `${label}=${provider.name}` })
}

/** Full size for a real run, a small one under --smoke. */
export function size(args: RecipeArgs, full: number, smoke: number): number {
  return args.smoke ? smoke : full
}

/** Compact number formatting for the printed reports. */
export function fmt(value: number, digits = 4): string {
  if (Number.isInteger(value)) return String(value)
  return Math.abs(value) < 1e-3 && value !== 0 ? value.toExponential(2) : value.toFixed(digits)
}
```

`examples/src/lib/drand-fixture.ts` holds recorded drand responses for offline runs. The drand
provider accepts an injected `fetch`, so offline runs go through exactly the checks a live run
goes through:

```ts
/**
 * Recorded drand quicknet responses for offline runs. Captured from
 * https://api.drand.sh (round 32285086 also from api2.drand.sh, identical) on
 * 2026-09-17T15:23:55Z. The provider checks these exactly as it checks live
 * responses; only the transport is replaced.
 */
import { drand } from '@mindpeeker/entropy/providers'

export const RECORDED_DRAND = Object.freeze({
  capturedAt: '2026-09-17T15:23:55Z',
  info: {
    public_key:
      '83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a',
    period: 3,
    genesis_time: 1692803367,
    genesis_seed: 'f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e',
    chain_hash: '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
    scheme: 'bls-unchained-g1-rfc9380',
    beacon_id: 'quicknet',
  },
  rounds: [
    {
      round: 32285085,
      signature:
        '81dbce51d584d90d618547f4b50391d53ace6f6b9aeb8fb67e1879427af9d0310ac0ec6f519271d9a313ee84b378d416',
    },
    {
      round: 32285086,
      signature:
        'a64d99fd7fa3e48912be7209c7b69c72c88fc5224be2516949b6f29f3a4b7e3fa069dd58b2bbb4bf2c34ae61ef631a44',
    },
  ],
})

/** The newest recorded round: what `rounds/latest` answers offline. */
export const RECORDED_LATEST_ROUND = 32285086

type Edit = (path: string, body: Record<string, unknown>) => Record<string, unknown>

/**
 * A `fetch` that answers drand's v2 routes from the recording. `edit` lets a
 * recipe play a misbehaving mirror by rewriting a response body.
 */
export function recordedDrandFetch(edit: Edit = (_path, body) => body): typeof fetch {
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const path = new URL(request.url).pathname
    const round = /\/v2\/beacons\/quicknet\/rounds\/(latest|\d+)$/.exec(path)?.[1]
    const wanted = round === 'latest' ? RECORDED_LATEST_ROUND : Number(round)
    const body = path.endsWith('/v2/beacons/quicknet/info')
      ? RECORDED_DRAND.info
      : RECORDED_DRAND.rounds.find((r) => r.round === wanted)
    if (!body) return new Response('not recorded', { status: 404 })
    return Response.json(edit(path, { ...body }))
  }
  return impl as typeof fetch
}

/** drand quicknet with structural verification, live or from the recording. */
export function drandBeacon(live: boolean, fetchImpl = recordedDrandFetch()) {
  return drand({ verify: 'structural', ...(live ? {} : { fetch: fetchImpl }) })
}
```

## 1. Live monitor with an anytime-valid boundary

**Question.** Three sources feed a live session, one 200-bit trial each per step. The plot shows
the cumulative deviation $D_t = \sum_{s \le t} (Z_s^2 - 1)$ of the Stouffer $Z$. When may I stop
and say the variance is off?

**What the result can and cannot mean.** `significanceEnvelope` gives the pointwise χ² quantile:
a valid test only at one step fixed in advance. Every tick of a negentropy session also carries
an e-value $M_t$, the Gamma(1, 1) mixture test martingale on the variance-excess side. By Ville's
inequality $P_{H_0}(\exists t: M_t \ge 1/\alpha) \le \alpha$, so it may be watched at every
step. For fair-bit trials under theoretical calibration it is an exact test supermartingale;
under empirical calibration it is an approximation. A crossing means the trial sums are not
behaving like independent fair bits. Drifting hardware, serial correlation, electromagnetic
pickup and bugs all do that. It says nothing about why, and nothing about minds.

```ts
/**
 * Recipe 1: a live negentropy monitor with an anytime-valid boundary.
 * bun examples/src/01-live-monitor.ts [--source crypto] [--control offline] [--smoke]
 */
import {
  anytimeEnvelope,
  anytimeP,
  cumulativeDeviation,
  netvarMartingale,
  probitBytes,
  session,
  significanceEnvelope,
} from '@mindpeeker/negentropy'
import { fmt, openSource, parseArgs, size } from './lib/cli.js'

const args = parseArgs()
const steps = size(args, 3000, 300)
const alpha = 0.05
const pointwise = significanceEnvelope(steps, alpha) // χ² upper quantile − t, per step
const anytime = anytimeEnvelope(steps, alpha, { sided: 'upper' }).upper // D_t ≥ upper ⇔ M_t ≥ 1/α

// 1. Watch three sources in lock-step: one 200-bit trial per source per step.
const sources = ['egg-1', 'egg-2', 'egg-3'].map((label) => openSource(args.source, label))
const live = session({ sources, events: [], stepTimeoutMs: 60_000 })
const stouffer: number[] = []
const logE: number[] = []
let firstPointwise = 0
let firstAnytime = 0
for await (const tick of live) {
  stouffer.push(tick.stouffer)
  logE.push(tick.logEValue)
  const t = tick.step + 1
  if (!firstPointwise && tick.cumdev > (pointwise[tick.step] as number)) firstPointwise = t
  if (!firstAnytime && tick.eValue >= 1 / alpha) firstAnytime = t
  if (t >= steps) break
}
const result = live.stop() // total: the full step-aligned archive, never throws

const batch = netvarMartingale(stouffer, { sided: 'upper' })
console.log('sources            ', sources.map((s) => s.name).join(', '))
console.log('steps analysed     ', result.analysedSteps)
console.log('final cumdev D_t   ', fmt(cumulativeDeviation(stouffer).at(-1) ?? Number.NaN))
console.log('final e-value M_t  ', fmt(Math.exp(logE.at(-1) ?? Number.NaN)))
console.log('anytime p          ', fmt(anytimeP(logE).at(-1) ?? Number.NaN))
console.log('pointwise crossing ', firstPointwise ? `step ${firstPointwise}` : 'none')
console.log('anytime crossing   ', firstAnytime ? `step ${firstAnytime}` : 'none')
console.log('live = batch       ', batch.at(-1) === logE.at(-1))

// 2. Why the pointwise envelope cannot be watched: simulate H0 paths and look at every step.
const paths = size(args, 400, 20)
const { bytes } = await openSource(args.control, 'null-paths').getBytes(paths * steps)
let crossedPointwise = 0
let crossedAnytime = 0
for (let p = 0; p < paths; p++) {
  const zs = probitBytes(bytes.subarray(p * steps, (p + 1) * steps), { source: `path-${p}` })
  const curve = cumulativeDeviation(zs) // exactly N(0, 1) steps under H0
  if (curve.some((d, t) => d > (pointwise[t] as number))) crossedPointwise++
  if (curve.some((d, t) => d >= (anytime[t] as number))) crossedAnytime++
}
for (const t of [100, 1000, steps].filter((t) => t <= steps)) {
  const i = t - 1
  console.log(`bands at t=${t}`.padEnd(19), fmt(pointwise[i] as number), fmt(anytime[i] as number))
}
console.log('H0 paths crossing  ', `pointwise ${crossedPointwise}/${paths}`)
console.log('                   ', `anytime   ${crossedAnytime}/${paths} (Ville: ≤ ${alpha})`)
```

**Output.**

```text
sources             egg-1=hmac-drbg(seed:33e1f6c1), egg-2=hmac-drbg(seed:c5e4fe3b), egg-3=hmac-drbg(seed:4c92205f)
steps analysed      3000
final cumdev D_t    112.7800
final e-value M_t   0.0980
anytime p           0.2746
pointwise crossing  step 49
anytime crossing    none
live = batch        true
bands at t=100      24.3421 49.5594
bands at t=1000     74.6794 159.2295
bands at t=3000     128.5367 282.9342
H0 paths crossing   pointwise 180/400
                    anytime   14/400 (Ville: ≤ 0.05)
```

The offline sources are a deterministic DRBG, so there is nothing to find. The live path still
crossed the pointwise 5% envelope at step 49, while its e-value never reached 20. In the
simulation, 180 of 400 null paths (45%) crossed the pointwise envelope somewhere in 3000 steps,
and 14 of 400 (3.5%) crossed the anytime-valid boundary. The negentropy README reports 46% and
0.9–3.2% over 1000 paths. The price of looking at every step is a wider boundary: 159.2 against
74.7 at $t = 1000$, a factor of 2.1. With `--source crypto` the eggs use the runtime CSPRNG;
`--control` sets the source of the simulated null paths.

**Why this is statistically honest.**

- The boundary's level holds under continuous monitoring, which is how live dashboards are used.
  The pointwise envelope is printed as the comparison, not used as a test.
- The simulation draws $Z$ from `probitBytes`, which is exactly $N(0,1)$ per byte under the
  null, so the crossing rates test the method rather than a lattice approximation.
- `live = batch` checks that the live e-value equals `netvarMartingale` recomputed from the
  Stouffer Z values, the batch function a reader would run on a recording.
- The prior ($a = b = 1$), the side and $\alpha$ are fixed in the script. Choosing them after
  looking would be optional stopping again.

Sources: Shafer, Shen, Vereshchagin & Vovk,
[Test martingales, Bayes factors and p-values](https://arxiv.org/abs/0912.4269) (2011); Howard,
Ramdas, McAuliffe & Sekhon,
[Time-uniform, nonparametric, nonasymptotic confidence sequences](https://arxiv.org/abs/1810.08240)
(2021); Ramdas, Grünwald, Vovk & Shafer,
[Game-theoretic statistics and safe anytime-valid inference](https://arxiv.org/abs/2210.01948)
(2023). The visualizer's demo dashboard draws both boundaries live
([`packages/visualizer`](../packages/visualizer)).

## 2. Pre-registered tripolar run with a control arm

**Question.** A PEAR-style tripolar session (aim high, aim low, baseline) is run on an
experimental source with a yoked control source. How can a reader check that the plan was fixed
first, that the recorded trials were not edited, and how the result compares with the control?

**What the result can and cannot mean.** The script builds the evidence in layers, and each
proves less than it may seem to:

- `registerTripolar` hashes the plan, including the instructed schedule's seed. The seed must
  stay hidden from the operator until the session ends; the experimenter knows it. If the
  experimenter must be blind as well, the registration can instead commit to a future beacon
  round from which the seed is derived (NIST IR 8213 §7.2, as the ledger README describes).
- The ledger registration hash proves **what** was registered, not when. Publish it where it
  cannot be rewritten; only such an outside witness bounds the registration from above.
- The time bracket binds the registration hash to drand round 32285086. Together with the VDF
  seal it proves that the bracket, and the recording whose genesis is the bracket hash, were
  made **no earlier than** that round's publication, if the round value is genuine and was
  unpredictable. The seal adds ≈ T sequential squarings after the bracket was fixed. T = 100 000
  here is a demonstration; size a real T with `calibrate().suggestT` and a hardware speed-up
  margin (the vdf README recommends about 1000).
- The hash chain proves that no trial line was edited, inserted, deleted or reordered relative
  to the published head. A truncated tail is visible only against a head published earlier.
- $\Delta z$ is $N(0,1)$ under the null. A significant $\Delta z$ is a fact about the bytes: radio
  pickup, temperature drift and selection produce it too. An effect the control arm reproduces
  indicts the pipeline, which is psi's stated methodological stance rather than a consensus.

```ts
/**
 * Recipe 2: a pre-registered tripolar run with a yoked control arm, a hash-chained
 * recording and a beacon + VDF time bracket.
 * bun examples/src/02-preregistered-tripolar.ts [--source crypto] [--control offline] [--live] [--smoke]
 */
import { DRAND_CHAINS } from '@mindpeeker/entropy/providers'
import {
  verifyChain as ledgerVerifyChain,
  type Registration,
  registrationHash,
  type TimeBracket,
  timeBracketHash,
  timeBracketSealInput,
  toHex,
  validateTimeBracket,
  verifyTimeBracket,
} from '@mindpeeker/ledger'
import { normPpf } from '@mindpeeker/negentropy/numerics'
import {
  analyzeTripolar,
  controlContrast,
  readSession,
  recordSession,
  registerTripolar,
  type TrialSeries,
  type TripolarRun,
  tostEquivalence,
  tripolarBayesFactor,
  tripolarSchedule,
  verifyChain,
} from '@mindpeeker/psi'
import { sealBeacon, sealToBytes, verifySealBytes } from '@mindpeeker/vdf'
import { fmt, openSource, parseArgs, size } from './lib/cli.js'
import { drandBeacon } from './lib/drand-fixture.js'

const args = parseArgs()
const experimental = openSource(args.source, 'experimental')
const control = openSource(args.control, 'control') // a source the operator cannot influence

// 1. Freeze the protocol. The schedule seed stays with the experimenter until the end.
const tripolar = await registerTripolar({
  runsPerIntention: size(args, 10, 2),
  trialsPerRun: size(args, 50, 10),
  order: 'instructed',
  seed: '9b1c62d4',
})
const { runsPerIntention, trialsPerRun } = tripolar.plan
const eps0 = 0.02 // control-arm equivalence margin per bit, fixed now
const perBitEffectSd = 1e-4 // Bayes-factor prior scale: PEAR-sized effects
const registration: Registration = {
  title: 'Cookbook: tripolar REG run with a yoked control arm',
  hypotheses: [
    {
      id: 'H1',
      statement: 'high-intention runs exceed low-intention runs',
      kind: 'confirmatory',
      statistic: 'deltaZ from psi analyzeTripolar',
      null: 'N(0, 1)',
      direction: 'greater',
    },
    {
      id: 'C1',
      statement: `the control arm's deltaEffect lies within ±${eps0} per bit (TOST)`,
      kind: 'exploratory',
    },
  ],
  primary: 'H1',
  alpha: 0.05,
  sample: { kind: 'fixed', size: 3 * runsPerIntention * trialsPerRun, unit: 'trials per arm' },
  analysisPlanHash: tripolar.hash,
  exclusions: [],
  dataSources: [
    { name: experimental.name, role: 'experimental' },
    { name: control.name, role: 'control' },
  ],
  notes: `Bayes factor prior sd ${perBitEffectSd} per bit; schedule ${tripolar.scheduleDigest}`,
}
const regHash = await registrationHash(registration) // publish this before collecting

// 2. Bracket: bind the registration to a beacon round published after it, then seal.
const beacon = drandBeacon(args.live)
const { bytes: pulse, sources } = await beacon.getBytes(32)
const round = sources[0]?.rounds?.[0]
if (round?.timestamp === undefined) throw new Error('beacon round without a timestamp')
const bracket = validateTimeBracket({
  registrationHash: regHash,
  notBefore: {
    beacon: {
      source: 'drand',
      chain: DRAND_CHAINS.quicknet.hash,
      round: round.round,
      timestamp: new Date(round.timestamp).toISOString(),
      valueHex: toHex(pulse),
    },
  },
})
const sealInput = timeBracketSealInput(bracket)
const seal = await sealBeacon(sealInput, size(args, 100_000, 1_000)) // a demo T, not a real delay
const sealed: TimeBracket = {
  ...bracket,
  seal: { kind: 'vdf-pietrzak', bytesHex: toHex(sealToBytes(seal, sealInput)) },
}
const genesis = await timeBracketHash(sealed) // the recording starts from the sealed bracket

// 3. Collect both arms in lock-step, every trial line hash-chained to the previous one.
const schedule = tripolarSchedule(tripolar.plan)
const rounds = 3 * runsPerIntention * trialsPerRun
const lines: string[] = []
const start = Date.parse(sealed.notBefore.beacon.timestamp)
const offline = args.source === 'offline' && args.control === 'offline'
for await (const line of recordSession([experimental, control], {
  chain: { registration: genesis },
  tags: (r, source) => ({
    arm: source === control.name ? 'control' : 'experimental',
    run: Math.floor(r / trialsPerRun),
    segment: schedule[Math.floor(r / trialsPerRun)] as string,
  }),
  now: offline ? () => start + lines.length : Date.now, // reproducible offline head
})) {
  lines.push(line)
  if (lines.length === 1 + 2 * rounds) break
}

// 4. Anyone holding the lines, the head and the bracket can check all of it offline.
const psiCheck = await verifyChain(lines, { registration: genesis })
const ledgerCheck = await ledgerVerifyChain(lines, { format: 'psi', genesis, head: psiCheck.head })
const tampered = [...lines]
const edited = JSON.parse(tampered[7] as string) as { sum: number }
edited.sum = edited.sum === 0 ? 1 : edited.sum - 1
tampered[7] = JSON.stringify(edited)
const tamperCheck = await ledgerVerifyChain(tampered, { format: 'psi', genesis })
const replay = await beacon.getRound(round.round) // fetch the round yourself
const bracketCheck = await verifyTimeBracket(sealed, {
  registrationHash: regHash,
  beacon: { valueHex: toHex(replay.bytes) },
  verifySeal: verifySealBytes,
  requireSeal: true,
})

// 5. Analyze the verified recording against the registered plan.
const series = await readSession(lines)
function runsOf(name: string, arm: 'experimental' | 'control'): TripolarRun[] {
  const s = series.find((x) => x.source === name) as TrialSeries
  return schedule.map((intention, sequence) => ({
    intention,
    run: schedule.slice(0, sequence).filter((i) => i === intention).length,
    sequence,
    arm,
    assignment: 'instructed',
    order: tripolar.plan.order,
    xorSafeguard: tripolar.plan.xorSafeguard,
    scheduleDigest: tripolar.scheduleDigest,
    series: {
      source: s.source,
      bitsPerTrial: s.bitsPerTrial,
      sums: s.sums.slice(sequence * trialsPerRun, (sequence + 1) * trialsPerRun),
    },
  }))
}
const exp = analyzeTripolar(runsOf(experimental.name, 'experimental'), { registration: tripolar })
const ctl = analyzeTripolar(runsOf(control.name, 'control'), { registration: tripolar })
const contrast = controlContrast(exp, ctl)
const tost = tostEquivalence(ctl, { eps0 })
const bayes = tripolarBayesFactor(exp, { perBitEffectSd })
const bitsForEps = (e: number) => Math.ceil(2 * (normPpf(0.95) / e) ** 2) // per intention

console.log('tripolar plan hash ', tripolar.hash)
console.log('registration hash  ', regHash)
console.log('beacon round       ', round.round, sealed.notBefore.beacon.timestamp)
console.log(
  'bracket            ',
  bracketCheck.ok,
  `beacon ${bracketCheck.beacon}`,
  `seal ${bracketCheck.seal}`,
)
console.log('chain head         ', psiCheck.head, `(${psiCheck.lines} lines)`)
console.log('psi / ledger verify', psiCheck.ok, ledgerCheck.ok, ledgerCheck.head === psiCheck.head)
console.log(
  'one edited sum     ',
  tamperCheck.ok,
  tamperCheck.failure,
  `at line ${tamperCheck.brokenAt}`,
)
console.log('deltaZ (H1)        ', fmt(exp.deltaZ), `p ${fmt(exp.deltaP)}`)
console.log('deltaEffect 95% CI ', exp.deltaCi95.map((x) => fmt(x, 5)).join(' … '))
console.log('baseline bind z    ', fmt(exp.baseline?.variance.z ?? Number.NaN))
console.log('control contrast z ', fmt(contrast.z), `p ${fmt(contrast.pValue)}`)
console.log(
  'control TOST       ',
  `equivalent ${tost.equivalent}`,
  `p ${fmt(tost.pValue)}`,
  `eps0 ${eps0}`,
)
console.log('BF10 (sd 1e-4/bit) ', fmt(bayes.bf10))
console.log(
  'bits/intention     ',
  `${exp.high.bits} used; ${bitsForEps(1e-4)} for a TOST at eps0 1e-4`,
)
```

**Output.**

```text
tripolar plan hash  cbe5aade3cb388f62d4927a247b98a6528c5cd3550c467a25980cb62f7ed1ad5
registration hash   3db567753eafa759b823599f5264045acad1759129d64cefea9c7490bd689835
beacon round        32285086 2026-09-17T15:23:42.000Z
bracket             true beacon ok seal verified
chain head          69fc36689de9418923b4f053c393db2e63605ea3bc5eafffe6ddb3ffb707f4dd (3001 lines)
psi / ledger verify true true true
one edited sum      false bad_prev at line 8
deltaZ (H1)         0.9660 p 0.1670
deltaEffect 95% CI  -0.00445 … 0.01309
baseline bind z     -2.0053
control contrast z  0.5218 p 0.3009
control TOST        equivalent true p 1.10e-5 eps0 0.02
BF10 (sd 1e-4/bit)  1.0172
bits/intention      100000 used; 541108691 for a TOST at eps0 1e-4
```

Editing one trial sum (line 7) breaks the chain at the next line. The analysis rebuilds the runs
from the verified recording and the registered schedule, so `analyzeTripolar` would throw
`plan_mismatch` for a missing or reordered run. On this DRBG data $\Delta z = 0.97$ ($p = 0.17$).
The control arm's $\Delta\varepsilon$ lies within ±0.02 per bit (TOST $p = 1.1 \cdot 10^{-5}$),
but that margin is 200 times the PEAR-scale effect of about $10^{-4}$ per bit. An equivalence test
at $\varepsilon_0 = 10^{-4}$ can succeed at zero true effect only when
$z_{0.95}\sqrt{2/N} < \varepsilon_0$, that is with more than 541 million bits per intention. The
Bayes factor with a $10^{-4}$ prior scale is 1.02: 100 000 bits per intention cannot discriminate
at that scale, which is a property of the prior and the budget, not evidence either way. The
baseline variance z of −2.01 is one of several secondary statistics and is not the registered
hypothesis.

**Why this is statistically honest.**

- Hypothesis, direction, sample size, equivalence margin and prior scale are fixed and hashed
  before any trial is drawn; `analyzeTripolar(runs, { registration })` enforces the run count,
  run length and schedule.
- The instructed schedule removes order confounds in expectation. Fixed cycling confounds
  intention with drift, and interleaved cycling cancels only a constant bias (psi README,
  "Schedules").
- The control arm consumes one trial per experimental trial on the same schedule, and
  `controlContrast` is exactly $N(0,1)$ under the joint null.
- The equivalence test can support "no effect" at a stated bound, and the script prints the bit
  budget a PEAR-scale bound would need, so the demo margin is not mistaken for one.
- Every check at step 4 runs offline from the lines, the head and the bracket; `--live` fetches
  the beacon round instead of the recording.

Sources: NIST IR 8213 (draft),
[A Reference for Randomness Beacons: Format and Protocol Version 2](https://nvlpubs.nist.gov/nistpubs/ir/2019/NIST.IR.8213-draft.pdf);
Pietrzak, [Simple Verifiable Delay Functions](https://eprint.iacr.org/2018/627) (2019);
[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html) (JSON canonicalization). PEAR's protocol
and results are summarized, with sources, in the [psi README](../packages/psi/README.md).

## 3. Transfer-entropy independence check

**Question.** Two entropy sources sit side by side. Does the past of one predict the next bit of
the other?

**What the result can and cannot mean.** Transfer entropy $TE_{X \to Y}$ (Schreiber 2000) with
one bit of history each way is tested twice: by the χ² law $G = 2N \ln 2 \cdot TE \sim \chi^2(\text{df})$
with $\text{df} = (A_Y - 1) A_Y^{k} (A_X^{l} - 1) = 1$ for binary streams (Barnett &
Bossomaier 2012), trusted only when `adequate`, and by circular-shift surrogates, which keep each
stream's own autocorrelation. A small p is evidence of lagged predictive information. It is not
causation: a common driver produces it too. A large p is not independence either: a leak too
weak for 8000 bits to reveal passes unnoticed. And transfer entropy uses lags ≥ 1, so it cannot
see coupling within the same sample.

```ts
/**
 * Recipe 3: are two entropy sources independent? Transfer entropy both ways with the
 * χ² test and a circular-shift permutation test, plus a zero-lag check TE cannot do.
 * bun examples/src/03-transfer-entropy-check.ts [--source crypto] [--control offline] [--smoke]
 */
import {
  chiSquareTest,
  mutualInformation,
  permutationTest,
  symbolsFromBytes,
} from '@mindpeeker/flow'
import { chi2Sf } from '@mindpeeker/negentropy/numerics'
import { holm } from '@mindpeeker/psi'
import { fmt, openSource, parseArgs, size } from './lib/cli.js'

const args = parseArgs()
const bytes = size(args, 1000, 100) // 8 bits per byte
const surrogates = size(args, 999, 99)
const read = async (name: string, label: string) =>
  symbolsFromBytes((await openSource(name, label).getBytes(bytes)).bytes, { alphabet: 2 })

const a = await read(args.source, 'A')
const b = await read(args.control, 'B')

// Two planted couplings so the tests have something to find:
// `leaky` copies A's previous bit about a quarter of the time; `twin` copies A's current bit.
const coin = await read('offline', 'coupling')
const leaky = b.map((bit, t) =>
  t > 0 && coin[t] === 1 && coin[(t + 1) % coin.length] === 1 ? (a[t - 1] as number) : bit,
)
const twin = Uint8Array.from(a)

const pairs = [
  ['A → B', a, b],
  ['B → A', b, a],
  ['A → leaky', a, leaky],
  ['A → twin', a, twin],
] as const
const results = pairs.map(([label, x, y]) => {
  const chi = chiSquareTest(x, y, { k: 1, l: 1 }) // G = 2N ln2 · TE ~ χ²(df) if adequate
  const perm = permutationTest(x, y, {
    k: 1,
    l: 1,
    surrogate: 'circularShift',
    surrogates,
    seed: 7,
  })
  return { label, te: perm.te, chi, perm }
})
const adjusted = holm(results.map((r) => r.perm.p)).adjusted // four tests were run

console.log('bits per stream    ', a.length)
for (const [i, r] of results.entries()) {
  console.log(
    r.label.padEnd(19),
    `TE ${fmt(r.te, 5)} bits`,
    `χ² p ${fmt(r.chi.p)} (${r.chi.adequate ? 'adequate' : 'inadequate'})`,
    `perm p ${fmt(r.perm.p)} (Holm ${fmt(adjusted[i] as number)}, ${r.perm.distinct} distinct)`,
  )
}

// Zero lag is invisible to TE (lags ≥ 1): test the same-sample dependence separately.
for (const [label, y] of [
  ['A ~ B', b],
  ['A ~ twin', twin],
] as const) {
  const mi = mutualInformation(a, y) // bits; G = 2N ln2 · MI ~ χ²(1) for binary streams
  console.log(
    label.padEnd(19),
    `MI ${fmt(mi, 5)} bits`,
    `G-test p ${fmt(chi2Sf(2 * a.length * Math.LN2 * mi, 1))}`,
  )
}
```

**Output.**

```text
bits per stream     8000
A → B               TE 2.41e-4 bits χ² p 0.2628 (adequate) perm p 0.2570 (Holm 0.7710, 943 distinct)
B → A               TE 1.05e-4 bits χ² p 0.5580 (adequate) perm p 0.5610 (Holm 1, 943 distinct)
A → leaky           TE 0.04781 bits χ² p 7.49e-116 (adequate) perm p 0.0010 (Holm 0.0040, 943 distinct)
A → twin            TE 0 bits χ² p 1 (adequate) perm p 1 (Holm 1, 943 distinct)
A ~ B               MI 3.42e-5 bits G-test p 0.5383
A ~ twin            MI 0.99998 bits G-test p 0
```

The planted `leaky` stream, which copies A's previous bit about a quarter of the time, is found
by both tests. The permutation p stops at its floor $1/(999 + 1)$. The `twin` stream is an exact
copy of A, yet its transfer entropy is exactly 0: A's past adds nothing once the twin's own past
is known. The mutual-information G-test on the same samples finds it at once.

**Why this is statistically honest.**

- Both directions and both planted streams count as tests, and Holm's adjustment covers all four.
- The χ² p is used only with its adequacy guard; the surrogate p needs no asymptotics, and
  `distinct` reports its real resolution.
- Circular shifts preserve each stream's autocorrelation, the honest null for sources whose
  bits are not independent in time.
- The zero-lag blind spot is shown, not only stated: an independence claim needs the same-sample
  test as well.

Sources: Schreiber, [Measuring information transfer](https://doi.org/10.1103/PhysRevLett.85.461),
Phys. Rev. Lett. 85, 461 (2000); Barnett & Bossomaier,
[Transfer entropy as a log-likelihood ratio](https://journals.aps.org/prl/abstract/10.1103/PhysRevLett.109.138105),
Phys. Rev. Lett. 109, 138105 (2012). The flow README lists the measured false-positive rates of
the χ² test.

## 4. Oracle casts with exact accounting and replay

**Question.** A reading was cast from a live source. Which bytes produced it, can anyone
reproduce it, and did the cast follow the odds it claims?

**What the result can and cannot mean.** Every oracle cast maps uniform bytes to symbols with
exact rational probabilities (rejection sampling, dyadic weights, Fisher–Yates) and reports how
many bytes it consumed, fetched and used. `recordingReader` captures the consumed bytes, so a
replay reproduces the reading exactly. That proves the reading is a function of those bytes. It
does not prove the bytes were random or honestly recorded; for that, combine it with source
attribution, a beacon (recipe 10) or a published log (recipe 11). The package makes no claim about
what a hexagram or a geomantic figure means.

```ts
/**
 * Recipe 4: oracle casts with exact accounting and a byte-exact recorded replay.
 * bun examples/src/04-oracle-replay.ts [--source crypto] [--smoke]
 */
import {
  byteReader,
  castHexagram,
  castShield,
  type HexagramCast,
  houses,
  LINE_WEIGHTS,
  partOfFortune,
  reconciler,
  recordingReader,
  type ShieldCast,
} from '@mindpeeker/oracle'
import { fmt, openSource, parseArgs, size } from './lib/cli.js'

const args = parseArgs()
const source = openSource(args.source, 'oracle')

// 1. One session on one recorded stream: yarrow odds, one moving line, a geomantic chart.
const rec = recordingReader(source)
const yarrow = await castHexagram(rec.reader, { method: 'yarrow' })
const single = await castHexagram(rec.reader, { method: 'singleLine' })
const shield = await castShield(rec.reader)
await rec.reader.close() // releases the provider's stream
const recorded = rec.bytes()

const hexagram = (c: HexagramCast) =>
  `#${c.primary.kingWen} ${c.primary.name.en}; moving [${c.changing}]` +
  (c.relating ? ` → #${c.relating.kingWen}` : '')
const receipt = (c: HexagramCast | ShieldCast) =>
  `${c.bytesConsumed} bytes consumed, ${c.bytesFetched} fetched, ${c.bitsUsed} bits used`
const fortune = partOfFortune(shield)
console.log('yarrow             ', hexagram(yarrow), `(${receipt(yarrow)})`)
console.log('single moving line ', hexagram(single), `(${receipt(single)})`)
console.log('shield judge       ', shield.judge.name, `(${receipt(shield)})`)
console.log('reconciler         ', reconciler(shield).name)
console.log(
  'part of fortune    ',
  `${fortune.total} points → figure ${fortune.index} ${fortune.figure.name}`,
)
console.log('ascendant (GD)     ', houses(shield, { system: 'goldenDawn' })[0]?.name)

// 2. Replay: the recorded bytes reproduce every reading, in order.
const replay = byteReader(recorded)
const again = [
  await castHexagram(replay, { method: 'yarrow' }),
  await castHexagram(replay, { method: 'singleLine' }),
  await castShield(replay),
] as const
const same =
  hexagram(again[0]) === hexagram(yarrow) &&
  hexagram(again[1]) === hexagram(single) &&
  again[2].mothers.map((m) => m.binary).join() === shield.mothers.map((m) => m.binary).join()
console.log(
  'recorded bytes     ',
  recorded.length,
  '= consumed',
  yarrow.bytesConsumed + single.bytesConsumed + shield.bytesConsumed,
)
console.log('replay identical   ', same)

// 3. The exact line odds against observed frequencies from the same source.
const casts = size(args, 2000, 50)
const counts = { yarrow: [0, 0, 0, 0], coins: [0, 0, 0, 0] }
const reader = byteReader(source)
for (let i = 0; i < casts; i++) {
  for (const method of ['yarrow', 'coins'] as const) {
    const cast = await castHexagram(reader, { method })
    for (const line of cast.lines) (counts[method][line.value - 6] as number)++
  }
}
await reader.close()
for (const method of ['yarrow', 'coins'] as const) {
  const total = LINE_WEIGHTS[method].reduce((a, b) => a + b, 0)
  const rows = LINE_WEIGHTS[method].map(
    (w, i) => `${6 + i}: ${w}/${total} vs ${fmt((counts[method][i] as number) / (6 * casts), 3)}`,
  )
  console.log(`${method} odds`.padEnd(19), rows.join('  '))
}

// 4. The derivation against its primary text: Liber XCVI's worked chart is the bytes CA 34.
const liber = await castShield(new Uint8Array([0xca, 0x34]))
console.log(
  'Liber XCVI chart   ',
  liber.judge.name,
  partOfFortune(liber).total,
  partOfFortune(liber).figure.name,
)
```

**Output.**

```text
yarrow              #64 Before Completion; moving [2] → #35 (3 bytes consumed, 32 fetched, 24 bits used)
single moving line  #11 Peace; moving [2] → #36 (2 bytes consumed, 0 fetched, 14 bits used)
shield judge        Fortuna Minor (2 bytes consumed, 0 fetched, 16 bits used)
reconciler          Puella
part of fortune     72 points → figure 12 Fortuna Major
ascendant (GD)      Fortuna Major
recorded bytes      7 = consumed 7
replay identical    true
yarrow odds         6: 1/16 vs 0.061  7: 5/16 vs 0.315  8: 7/16 vs 0.432  9: 3/16 vs 0.192
coins odds          6: 1/8 vs 0.125  7: 3/8 vs 0.376  8: 3/8 vs 0.377  9: 1/8 vs 0.122
Liber XCVI chart    Populus 74 Amissio
```

The first cast fetched a 32-byte chunk (the default `chunkBytes`) and consumed 3 bytes; the next
two casts used buffered bytes, so they fetched none. Seven bytes replay all three readings. Over
2000 casts per method (12 000 lines each), the observed line frequencies sit within about two
standard errors of the exact odds (the standard error is about 0.002 at 1/16). The last line
checks the geomancy derivation against *Liber XCVI*'s own worked chart: the bytes `CA 34` give
the Judge Populus and 74 points, so the Part of Fortune falls on figure II, Amissio, as the text
says.

**Why this is statistically honest.**

- Probabilities are exact fractions of the model, never floating-point thresholds or `x mod n`.
- Accounting separates bytes consumed (what a replay needs) from bytes fetched (what the source
  delivered), so nothing is silently discarded.
- The frequency check compares against the stated weights with the cast method fixed in advance;
  it can only fail an implementation, not validate a tradition.
- Physical procedures (coins, yarrow stalks) are idealized models; whether real objects match
  them is an empirical question the package does not answer.

Sources: the systems catalogue and primary texts are cited in the
[oracle README](../packages/oracle/README.md) (Hellmut Wilhelm and Legge for the line odds,
Crowley's *Liber XCVI* and Skinner for geomancy).

## 5. Is my field special?

**Question.** A point field drawn from an entropy source has an "attractor": the point with the
most neighbours. Is this field unusual, or does every random field have such a point?

**What the result can and cannot mean.** `attractors` always finds a densest and a sparsest
point. `pSingle` is the exact binomial tail for a neighbourhood chosen **before** looking.
Applied to the most extreme of n dependent counts it is not a p-value for the field: in the
field package's simulations of complete spatial randomness (rect 100 × 80, default radius) the
attractor's `pSingle` was ≤ 0.05 in 58% of fields at n = 60 and in 100% at n = 300.
`fieldSignificance` asks the right question: it draws `runs` random fields from the same sampler
and ranks the observed maximum and minimum counts,
$p = (1 + \text{simulated at least as extreme})/(1 + \text{runs})$. `csrEnvelope` adds a global
test of Besag's $L(r) - r$ over all six radii. A small whole-field p says the field is unlikely
under complete spatial randomness from this source. It does not say why: a source defect, a
sampling bug or a hypothesized intention effect all qualify.

```ts
/**
 * Recipe 5: is my point field special? Single-point tails versus calibrated whole-field
 * p-values and a global envelope test, on a random field and on a planted cluster.
 * bun examples/src/05-field-significance.ts [--source crypto] [--smoke]
 */
import {
  attractors,
  csrEnvelope,
  fieldSignificance,
  type Point,
  sampleField,
} from '@mindpeeker/field'
import { byteReader } from '@mindpeeker/oracle'
import { fmt, openSource, parseArgs, size } from './lib/cli.js'

const args = parseArgs()
const region = { kind: 'rect', width: 100, height: 80 } as const
const n = size(args, 300, 60)
const runs = size(args, 499, 39) // simulated CSR fields per test: p resolution 1/(runs + 1)
const radii = [2, 4, 6, 8, 10, 14] // registered before drawing
const reader = byteReader(openSource(args.source, 'field')) // one reader: disjoint bytes per call

async function report(label: string, points: readonly Point[]): Promise<void> {
  const { attractor, void: empty, radius } = attractors(points, region)
  const whole = await fieldSignificance(reader, points, region, { runs })
  const envelope = await csrEnvelope(points, reader, region, radii, { runs })
  console.log(`${label} (n = ${points.length}, radius ${fmt(radius, 2)})`)
  console.log(
    '  attractor        ',
    `${attractor.neighbours} neighbours, expected ${fmt(attractor.expected, 2)}`,
    `pSingle ${fmt(attractor.pSingle)}`,
    `whole-field p ${fmt(whole.attractor.p)}`,
  )
  console.log(
    '  void             ',
    `${empty.neighbours} neighbours, expected ${fmt(empty.expected, 2)}`,
    `pSingle ${fmt(empty.pSingle)}`,
    `whole-field p ${fmt(whole.void.p)}`,
  )
  console.log(
    '  L(r) − r envelope',
    `global rank p ${fmt(envelope.global.p)}`,
    `MAD p ${fmt(envelope.global.mad.p)}`,
    `smallest pointwise p ${fmt(Math.min(...envelope.pointwiseP))}`,
  )
}

// 1. A field drawn from the source: its densest point always looks like an "attractor".
const { points, accounting } = await sampleField(reader, n, region)
await report('random field', points)

// 2. Positive control: replace 5% of the points by a tight cluster at the centre.
const k = Math.round(n * 0.05)
const { points: blob } = await sampleField(reader, k, { kind: 'disk', radius: 3 })
const planted = [...points.slice(k), ...blob.map((p) => ({ x: 50 + p.x, y: 40 + p.y }))]
await report('planted cluster', planted)

await reader.close()
console.log('bytes per field    ', accounting.bytesConsumed, '(8 per point)')
```

**Output.**

```text
random field (n = 300, radius 5.84)
  attractor         10 neighbours, expected 3.62 pSingle 0.0039 whole-field p 0.5660
  void              0 neighbours, expected 4.00 pSingle 0.0178 whole-field p 0.9980
  L(r) − r envelope global rank p 0.3080 MAD p 0.2400 smallest pointwise p 0.1000
planted cluster (n = 300, radius 5.84)
  attractor         18 neighbours, expected 4.00 pSingle 1.80e-7 whole-field p 0.0020
  void              0 neighbours, expected 4.00 pSingle 0.0178 whole-field p 1
  L(r) − r envelope global rank p 0.0020 MAD p 0.0040 smallest pointwise p 0.0040
bytes per field     2400 (8 per point)
```

On the random field the attractor has 10 neighbours where 3.62 were expected and
`pSingle` = 0.0039, yet more than half of the 499 simulated random fields had an attractor at
least as dense (whole-field p = 0.566). The planted cluster (15 of 300 points in a disk of
radius 3) reaches the resolution floor $1/(499 + 1)$ of the whole-field test, and the global
envelope tests reject too. The void's whole-field p stays near 1 because the sparsest point of a
random field almost always has zero neighbours. The offline run takes about 10 s here; HMAC_DRBG
is the slow part.

**Why this is statistically honest.**

- The number to report is the whole-field p, with the statistic, radius and run count fixed
  before the field is drawn; `pSingle` is kept only as a description.
- Simulated fields come from the same source and sampler, read through one reader so no bytes
  are reused. A replayed field would make the test powerless, and the package throws
  `invalid_config` instead.
- Pointwise envelope bands are valid at one radius fixed in advance: over 1000 random fields the
  band was crossed at a pre-chosen radius in 4.7% of fields but at some radius in 14.2%, while
  the global rank test rejected 4.5% (field README). The script reports the global p.
- The positive control shows the test has power against a real cluster. It shows nothing about
  whether real fields contain one.

Sources: Myllymäki, Mrkvička, Grabarnik, Seijo & Hahn,
[Global envelope tests for spatial processes](https://arxiv.org/abs/1307.0239) (JRSS-B, 2017),
who recommend at least 2499 simulations for a stable global envelope at α = 0.05. The
Randonautica comparison and the spatstat parity tables are in the
[field README](../packages/field/README.md).

## 6. Pricing a gematria coincidence

**Question.** Two words share a gematria value. How cheap is that coincidence in the lexicon the
match came from?

**What the result can and cannot mean.** Gematria values are exact integers; the idea that
equal values mean related words is a contested hermeneutic and contemplative tradition, not a
scientific claim (gematria README). The script prices equal values before any word is looked up:
the collision probability $q = \sum_v p_v^2$ of the value histogram, the exact probability that
n random words share a value, and a check of that probability by drawing words from a source.
Unequal value frequencies always make matches cheaper than equal ones would (Haigh's
non-uniformity lemma, in the coincidence README). The price holds for **this** lexicon: the
bundled 160 Hebrew entries are a curated, value-indexed reference dictionary, not a random sample
of the language. And a pair found by searching is priced by the search, not by one draw.

```ts
/**
 * Recipe 6: pricing a gematria coincidence. Equal values in a lexicon, the exact
 * probability that random words collide, and a draw-based check of that probability.
 * bun examples/src/06-gematria-coincidence.ts [--source crypto] [--smoke]
 */
import {
  birthdayMatch,
  noMatchNonUniform,
  peopleForKWayMatch,
  peopleForMatch,
} from '@mindpeeker/coincidence'
import { collisionProfile, lookup, matches, value } from '@mindpeeker/gematria'
import { defaultLexicon } from '@mindpeeker/gematria/lexicon'
import { byteReader, uniformInt } from '@mindpeeker/oracle'
import { fmt, openSource, parseArgs, size } from './lib/cli.js'

const args = parseArgs()
const cipher = 'he-hechrachi'
const words = defaultLexicon(cipher) // registers the bundled corpus; Hebrew words only

// 1. The "discovery": words that share a value.
const truth = matches('אמת', cipher)
const messiah = lookup(358, cipher, { colel: true })
console.log(
  'אמת                ',
  truth.value,
  truth.matches.join(' '),
  `commonness ${fmt(truth.commonness)}`,
)
console.log(
  '358 ± 1            ',
  messiah.matches.join(' · '),
  `commonness ${fmt(messiah.commonness)}`,
)

// 2. Price equal values for the whole lexicon before looking at any word.
const profile = collisionProfile(words, cipher)
const probs = profile.histogram.map((bin) => bin.probability)
console.log('lexicon            ', `${profile.n} words, ${profile.distinct} distinct values`)
console.log('two random words   ', `share a value with q = ${fmt(profile.collisionProbability)}`)
console.log('equal pairs        ', `${profile.observedEqualPairs} observed among the entries`)
for (const draws of [5, 10, 20]) {
  const uneven = noMatchNonUniform(draws, probs).match // the real value histogram
  const even = birthdayMatch(draws, profile.distinct) // if every value were equally likely
  console.log(
    `${draws} random words`.padEnd(19),
    `P(shared value) ${fmt(uneven)} (equal values: ${fmt(even)})`,
  )
}
console.log(
  'words for 50%      ',
  `${peopleForKWayMatch(0.5, probs, 2)} exact (equal values: ${peopleForMatch(0.5, profile.distinct)})`,
)

// 3. Check the exact number by drawing 10 words with replacement, many times.
const trials = size(args, 20_000, 200)
const values = words.map((word) => value(word, cipher))
const reader = byteReader(openSource(args.source, 'lexicon-draws'))
let collisions = 0
for (let t = 0; t < trials; t++) {
  const seen = new Set<number>()
  let hit = false
  for (let d = 0; d < 10; d++) {
    const v = values[await uniformInt(reader, values.length)] as number
    hit ||= seen.has(v)
    seen.add(v)
  }
  if (hit) collisions++
}
await reader.close()
const exact = noMatchNonUniform(10, probs).match
const se = Math.sqrt((exact * (1 - exact)) / trials)
console.log(
  'drawn, 10 words    ',
  `${fmt(collisions / trials)} over ${trials} draws (exact ${fmt(exact)} ± ${fmt(se)} SE)`,
)
```

**Output.**

```text
אמת                 441 אמת אילת commonness 0.0125
358 ± 1             משיח · נחש · יבא שילה commonness 0.0187
lexicon             160 words, 115 distinct values
two random words    share a value with q = 0.0105
equal pairs         55 observed among the entries
5 random words      P(shared value) 0.1012 (equal values: 0.0843)
10 random words     P(shared value) 0.3845 (equal values: 0.3314)
20 random words     P(shared value) 0.8772 (equal values: 0.8270)
words for 50%       12 exact (equal values: 13)
drawn, 10 words     0.3812 over 20000 draws (exact 0.3845 ± 0.0034 SE)
```

Two random entries share a value with probability $q = 27/2560 \approx 0.0105$, yet among ten
random entries a shared value has probability 0.3845, and twelve make it more likely than not.
If the 115 values were equally likely it would be 0.3314 and thirteen words. Drawing ten words
20 000 times gave 0.3812, within one standard error of the exact value. A "discovery" such as
אמת = אילת = 441 is one of the 55 equal pairs the bundled entries already contain.

**Why this is statistically honest.**

- The denominator is fixed before the lookup: the admissible lexicon under the cipher, with its
  real value histogram rather than an equal-frequency idealization.
- The exact recursion and the Monte Carlo draw are independent routes to the same number, and
  they agree within their stated error.
- `commonness` is printed next to every match, so a coincidence is visibly a coincidence.
- Lists of striking pairs need the pairing permutation test instead (`pairMatchTest`), which
  compares them with random re-pairings of the same words.

Sources: Diaconis & Mosteller,
[Methods for studying coincidences](https://doi.org/10.1080/01621459.1989.10478847), JASA 84
(1989); McKay, Bar-Natan, Bar-Hillel & Kalai,
[Solving the Bible Code Puzzle](https://doi.org/10.1214/ss/1009212243), Statistical Science 14
(1999). The lexicon's editions and licensing are documented in the
[gematria README](../packages/gematria/README.md).

## 7. Radionic scan with an honest null

**Question.** A catalog scan ranks items by how far each item's coin flips deviate from chance.
What does it report on a fair source, and what on a source with a known defect?

**What the result can and cannot mean.** In deviation mode each item gets one fair coin per round,
so its chance rate is exactly ½ and its p-value is the exact two-sided binomial tail. Sixty
items mean sixty tests, so the report carries Holm and Benjamini–Hochberg adjustments, the
expected number of nominal hits ($M\alpha$) and an omnibus $\sum z_i^2 \approx \chi^2(M)$ test
that asks whether the **source** is off at all. A deviation is a chance-deviation flag. It is not
a diagnosis, not evidence about the item, and not evidence of mind–matter interaction. Radionics
as medicine is pseudoscience, and the scan package makes no medical or diagnostic claim.

```ts
/**
 * Recipe 7: a radionic catalog scan with an honest null. Deviation mode on a fair
 * source (expect nulls), then the same scan on a deliberately biased fake source.
 * bun examples/src/07-radionic-scan-null.ts [--source crypto] [--control offline] [--smoke]
 */
import { defineCatalog, type ScanReport, scan } from '@mindpeeker/scan'
import { fmt, openSource, parseArgs, size } from './lib/cli.js'

const args = parseArgs()
const items = size(args, 60, 12)
const rounds = size(args, 256, 64) // one fair coin per item per round: p0 = 1/2 exactly
const catalog = defineCatalog(
  'demo',
  'Demo catalog',
  Array.from({ length: items }, (_, i) => ({ id: `item-${i + 1}`, name: `Item ${i + 1}` })),
)

// A fake source with a known defect: every bit is a | (b & c) of three fair bits, P(1) = 5/8.
const input = openSource(args.control, 'bias-input')
const biased = {
  name: 'biased-5/8',
  async *stream(opts?: { signal?: AbortSignal; chunkBytes?: number }) {
    let carry: number[] = []
    for await (const chunk of input.stream(opts)) {
      const bytes = [...carry, ...chunk]
      const out = new Uint8Array(Math.floor(bytes.length / 3))
      for (let i = 0; i < out.length; i++) {
        out[i] =
          (bytes[3 * i] as number) | ((bytes[3 * i + 1] as number) & (bytes[3 * i + 2] as number))
      }
      carry = bytes.slice(3 * out.length)
      if (out.length > 0) yield out
    }
  },
}

function print(label: string, report: ScanReport): void {
  const m = report.multiplicity
  if (!m) throw new Error('deviation mode always reports multiplicity')
  const bfs = report.results
    .map((r) => r.deviation?.bayesFactor ?? Number.NaN)
    .sort((a, b) => a - b)
  console.log(`${label}: ${report.source}, ${m.tests} items × ${rounds} rounds`)
  console.log('  p ≤ 0.05 expected ', fmt(m.expectedFalsePositives, 1), `observed ${m.nominalHits}`)
  console.log('  after Holm / BH   ', m.holmRejections, '/', m.bhRejections)
  console.log(
    '  omnibus Σz²       ',
    fmt(m.omnibus.statistic, 1),
    `df ${m.omnibus.df}`,
    `p ${fmt(m.omnibus.p)}`,
  )
  console.log('  median BF10       ', fmt(bfs[Math.floor(bfs.length / 2)] as number))
  for (const r of report.results.slice(0, 3)) {
    const d = r.deviation
    if (d)
      console.log(
        `  rank ${r.rank} ${r.id}`.padEnd(20),
        `${d.successes}/${d.rounds}`,
        `p ${fmt(d.p)}`,
        `Holm ${fmt(d.pHolm)}`,
      )
  }
}

const scanOpts = { mode: 'deviation', deviationRounds: rounds } as const
print('fair source', await scan(catalog, openSource(args.source, 'scan'), scanOpts))
print('biased source', await scan(catalog, biased, scanOpts))
```

**Output.**

```text
fair source: scan=hmac-drbg(seed:9fc10955), 60 items × 256 rounds
  p ≤ 0.05 expected  3 observed 2
  after Holm / BH    0 / 0
  omnibus Σz²        64.0 df 60 p 0.3395
  median BF10        0.1034
  rank 1 item-45     111/256 p 0.0390 Holm 1
  rank 2 item-6      111/256 p 0.0390 Holm 1
  rank 3 item-9      112/256 p 0.0525 Holm 1
biased source: biased-5/8, 60 items × 256 rounds
  p ≤ 0.05 expected  3 observed 59
  after Holm / BH    55 / 59
  omnibus Σz²        1037.6 df 60 p 3.14e-178
  median BF10        411.8435
  rank 1 item-47     178/256 p 3.68e-10 Holm 2.21e-8
  rank 2 item-53     176/256 p 1.89e-9 Holm 1.11e-7
  rank 3 item-19     176/256 p 1.89e-9 Holm 1.11e-7
```

On the fair source, 2 items fall below p = 0.05 where 3 were expected, none survives Holm, the
omnibus p is 0.34, and the median Bayes factor 0.10 favours chance. The scan README states the
median as 0.095 at 256 rounds. The biased source, whose bits are 1 with probability 5/8, makes
59 of 60 items "resonate" and the omnibus p collapses. Its ranking is a ranking of noise from a
broken source. At `--smoke` size (12 items, 64 rounds) the fair source happens to give one Holm
rejection: family-wise error control keeps that to at most 5% of fair scans, not to none.

**Why this is statistically honest.**

- The p-values are exact binomial tails, and the adjusted values and $M\alpha$ are printed
  beside the raw ones.
- The omnibus test separates "the source is off" from "this item is special": when every item
  deviates, the source is the explanation to rule out first.
- Bayes factors can come out below 1, which is evidence for chance, and they do on a fair source.
- The fake source is a positive control with a known defect, so the scan's power is shown rather
  than asserted.

Sources: the deviation model, AetherOne fidelity table and the historical tests are in the
[scan README](../packages/scan/README.md). For the underlying micro-PK claim, Maier, Dechamps &
Pflitsch ran a new sequential Bayesian experiment (n = 12 571) and found evidence against it,
$BF_{01} = 10.07$: [Frontiers in Psychology 9:379](https://doi.org/10.3389/fpsyg.2018.00379)
(2018).

## 8. Scoring forced-choice studies

**Question.** A ganzfeld-style study (one target among four clips per session) and a series of
Zener runs (a shuffled 25-card pack) need exact scores. What does picking the best batch
afterwards cost?

**What the result can and cannot mean.** Every p-value here comes from the design's randomization:
targets drawn uniformly, calls fixed before the target is known, no feedback between calls. The
script simulates the null by construction, since the receiver draws from a source independent of
the target draw. With real data the same numbers are facts about calls versus targets under that
design; they become evidence for anything only if the design really held (blind judging,
sensory shielding, no feedback). No library can check that.

```ts
/**
 * Recipe 8: scoring a ganzfeld-style study and Zener closed-deck runs exactly, and pricing
 * the best of several looks. The data are simulated under the null: the "receiver" draws
 * from a source independent of the target draw.
 * bun examples/src/08-judging-forced-choice.ts [--source crypto] [--control offline] [--smoke]
 */
import {
  closedDeckTest,
  deflatedCriticalValue,
  directHits,
  expectedMaxOfLooks,
  forcedChoiceBayesFactor,
  forcedChoiceTest,
  maxOfLooksPValue,
} from '@mindpeeker/judging'
import { byteReader, drawWithoutReplacement, uniformInt } from '@mindpeeker/oracle'
import { fmt, openSource, parseArgs, size } from './lib/cli.js'

const args = parseArgs()
const targets = byteReader(openSource(args.source, 'targets'))
const receiver = byteReader(openSource(args.control, 'receiver'))

// 1. Ganzfeld: one target among four clips per session, scored as a direct hit.
const batches = 5
const perBatch = size(args, 40, 8)
const batchHits: number[] = []
for (let b = 0; b < batches; b++) {
  let hits = 0
  for (let s = 0; s < perBatch; s++) {
    if ((await uniformInt(targets, 4)) === (await uniformInt(receiver, 4))) hits++
  }
  batchHits.push(hits)
}
const hits = batchHits.reduce((a, b) => a + b, 0)
const sessions = batches * perBatch
const g = directHits(hits, sessions, 4)
const bf = forcedChoiceBayesFactor(hits, sessions, { p0: 1 / 4, alternative: 'greater' })
console.log('ganzfeld           ', `${hits}/${sessions} hits, chance 1/4`)
console.log('  critical ratio   ', fmt(g.criticalRatio), `exact P(X ≥ ${hits}) ${fmt(g.pOneSided)}`)
console.log(
  '  hit rate 95% CI  ',
  `${fmt(g.confidenceInterval.lower)} … ${fmt(g.confidenceInterval.upper)}`,
)
console.log('  BF10 (p0 = 1/4)  ', fmt(bf.bf10), `(BF01 ${fmt(bf.bf01)})`)

// 2. Post-hoc selection: report only the best of the five batches.
const zs = batchHits.map((h) => directHits(h, perBatch, 4).criticalRatio)
const best = Math.max(...zs)
console.log(
  'best batch z       ',
  fmt(best),
  `naive p ${fmt(forcedChoiceTest(Math.max(...batchHits), perBatch, 1 / 4).pOneSided)}`,
)
console.log('  best-of-5 p      ', fmt(maxOfLooksPValue(best, batches)))
console.log(
  '  E[best of 5 | H0]',
  fmt(expectedMaxOfLooks(batches).exact),
  `bar at α = 0.05: ${fmt(deflatedCriticalValue(batches).z)}`,
)

// 3. Zener runs: a shuffled closed 5 × 5 pack against a balanced call sequence.
const runs = size(args, 20, 4)
const pack = [5, 5, 5, 5, 5]
let zenerHits = 0
for (let r = 0; r < runs; r++) {
  const cards = (await drawWithoutReplacement(targets, 25, 25)).map((i) => Math.floor(i / 5))
  const calls = (await drawWithoutReplacement(receiver, 25, 25)).map((i) => Math.floor(i / 5))
  zenerHits += cards.filter((card, i) => card === calls[i]).length
}
await targets.close()
await receiver.close()
const zener = closedDeckTest(zenerHits, pack, { callCounts: pack, runs })
console.log('zener              ', `${zenerHits} hits in ${runs} runs of 25 (mean ${zener.mean})`)
console.log(
  '  exact closed deck',
  `CR ${fmt(zener.criticalRatio)}`,
  `P(X ≥ ${zenerHits}) ${fmt(zener.pOneSided)}`,
)
console.log(
  '  binomial shortcut',
  `CR ${fmt(zener.openDeckCriticalRatio)}`,
  `run SD ${fmt(zener.distribution.sd)} vs 2`,
)
```

**Output.**

```text
ganzfeld            52/200 hits, chance 1/4
  critical ratio    0.3266 exact P(X ≥ 52) 0.3983
  hit rate 95% CI   0.2007 … 0.3266
  BF10 (p0 = 1/4)   0.0705 (BF01 14.1809)
best batch z        1.0954 naive p 0.1791
  best-of-5 p       0.5204
  E[best of 5 | H0] 1.1630 bar at α = 0.05: 2.3187
zener               115 hits in 20 runs of 25 (mean 100)
  exact closed deck CR 1.6432 P(X ≥ 115) 0.0580
  binomial shortcut CR 1.6771 run SD 2.0412 vs 2
```

52 hits in 200 sessions against 50 expected: exact $P(X \ge 52) = 0.40$, and the one-sided Bayes
factor with $p_0 = 1/4$ is 0.07, so the data favour chance by a factor of 14. The best of the five
batches has z = 1.10 and a naive p of 0.18, but the chance that the best of five null batches
looks at least that good is 0.52. Under the null the best of five standard normals averages
1.16, and it must exceed 2.32 to be significant at α = 0.05. For the Zener runs the exact
closed-deck p is 0.058; treating each pack as Binomial(25, 1/5) understates the run SD (2 instead
of 2.0412) and inflates the critical ratio from 1.643 to 1.677, the 2% error Epstein describes.

**Why this is statistically honest.**

- The Zener null is the exact matching distribution of a shuffled pack, not the binomial
  shortcut, and both ratios are printed.
- The Bayes factor uses the design's chance rate $p_0 = 1/4$, not ½, and can favour the null.
- Post-hoc selection is priced with the expected maximum and the Šidák bar instead of reporting
  the best batch's naive p. The per-batch z is the normal approximation of a binomial count.
- The calls in the Zener simulation are a balanced pack, so one call composition fits every run
  and `closedDeckTest` is exact. Free calls need each run's own composition
  (`closedDeckMatchDistribution`).

Sources: Epstein, *The Theory of Gambling and Statistical Logic*, ch. 11 (ark-db library, The
Theory of Gambling and Statistical Logic, pp. 420–421 for the exact Zener table and the 2%
critical-ratio error; p. 422 on choosing the best displacement after the fact). The judging
README lists the other classic critiques with sources.

## 9. Local sidereal time scan

**Question.** Does a per-trial effect depend on local sidereal time (LST), once the search over
all windows is part of the null?

**What the result can and cannot mean.** The astronomy is exact to its stated precision. The
hypothesis is contested: Spottiswoode (1997) reported free-response effect sizes peaking near
13.47 h LST, and the ephemeris README explains why that is disputed, notably because LST is a
linear function of solar time and day of year, so a seasonal effect in daytime sessions appears
as an LST effect. The script simulates three labs running daytime sessions over two years, with
effects that are exactly $N(0,1)$ plus, in the planted studies, 0.6 SD inside 20 h ± 1 h LST.
`lstPermutationTest` reruns the whole 240-window scan on every relabeling, so the peak search is
paid for. `lstWindowTest` then tests one window registered from the exploration on **new** data.
Detecting a planted effect shows the tests have power; it says nothing about real data.

```ts
/**
 * Recipe 9: a local-sidereal-time scan with a planted effect, its scan-aware permutation
 * test, and a confirmatory test of one registered window on fresh data.
 * bun examples/src/09-lst-window-scan.ts [--source crypto] [--smoke]
 */
import {
  julianDay,
  type LstTimedTrial,
  lst,
  lstPermutationTest,
  lstWindowTest,
} from '@mindpeeker/ephemeris'
import { probitBytes } from '@mindpeeker/negentropy'
import { byteReader, uniformInt } from '@mindpeeker/oracle'
import { fmt, openSource, parseArgs, size } from './lib/cli.js'

const args = parseArgs()
const n = size(args, 1200, 150)
const permutations = size(args, 9999, 199)
const seed = 20260917
const labs = [
  { id: 'edinburgh', lon: -3.19 },
  { id: 'zurich', lon: 8.54 },
  { id: 'palo-alto', lon: -122.14 },
]
const plant = { centerHours: 20, halfWidthHours: 1, shift: 0.6 } // the simulated "true" effect
const reader = byteReader(openSource(args.source, 'lst'))

/** Simulated sessions over two years, 09:00–17:00 local mean time, effect ~ N(0, 1) (+ shift). */
async function study(tag: string, shift: number): Promise<LstTimedTrial[]> {
  const bytes = new Uint8Array(n)
  for (let i = 0; i < n; i++) bytes[i] = await uniformInt(reader, 256)
  const noise = probitBytes(bytes, { source: tag }) // exactly N(0, 1) under H0
  const trials: LstTimedTrial[] = []
  for (let i = 0; i < n; i++) {
    const lab = labs[await uniformInt(reader, labs.length)] as (typeof labs)[number]
    const day = await uniformInt(reader, 730)
    const localMinutes = 9 * 60 + (await uniformInt(reader, 8 * 60))
    const utcMinutes = day * 1440 + localMinutes - (lab.lon / 15) * 60
    const time = new Date(Date.UTC(2024, 0, 1) + Math.round(utcMinutes * 60_000))
    const hours = lst(julianDay(time), lab.lon)
    const distance = Math.abs(((hours - plant.centerHours + 36) % 24) - 12)
    const effect = (noise[i] as number) + (distance < plant.halfWidthHours ? shift : 0)
    trials.push({ time, longitudeEastDeg: lab.lon, effect, stratum: lab.id })
  }
  return trials
}

// 1. Exploration: scan all 240 windows; the permutation null repeats the whole search.
let explored = 0
for (const [label, shift] of [
  ['null study', 0],
  ['planted study', plant.shift],
] as const) {
  const result = lstPermutationTest(await study(label, shift), { permutations, seed })
  const peak = result.scan.peak
  if (shift > 0) explored = Math.round(peak.centroidHours * 2) / 2 // nearest half hour
  console.log(
    label.padEnd(19),
    `peak ${fmt(peak.centerHours, 1)} h (centroid ${fmt(peak.centroidHours, 2)} h, n ${peak.n})`,
    `mean ${fmt(peak.mean, 3)}`,
    `scan p ${fmt(result.pValue)} (${result.exceedances}/${result.permutations}, ${result.strata} strata)`,
  )
}

// 2. Confirmation: register one window from the exploration, then test it on NEW data.
const registered = { centerHours: explored, halfWidthHours: 1 }
console.log('registered window  ', `${registered.centerHours} h ± ${registered.halfWidthHours} h`)
for (const [label, shift] of [
  ['confirm, no effect', 0],
  ['confirm, effect', plant.shift],
] as const) {
  const test = lstWindowTest(await study(label, shift), { ...registered, permutations, seed })
  console.log(
    label.padEnd(19),
    `inside ${fmt(test.inside.mean, 3)} (n ${test.inside.n}) vs outside ${fmt(test.outside.mean, 3)}`,
    `p ${fmt(test.pValue)}`,
  )
}
await reader.close()
```

**Output.**

```text
null study          peak 22.9 h (centroid 22.91 h, n 100) mean 0.142 scan p 0.9849 (9848/9999, 3 strata)
planted study       peak 20 h (centroid 19.96 h, n 89) mean 0.556 scan p 1.00e-4 (0/9999, 3 strata)
registered window   20 h ± 1 h
confirm, no effect  inside -0.038 (n 109) vs outside 0.021 p 0.7156
confirm, effect     inside 0.529 (n 129) vs outside 0.006 p 1.00e-4
```

The null study's highest window (22.9 h) is unremarkable once the search is counted: 9848 of 9999
relabelings found a window at least as high. The planted study reaches the floor $1/(9999 + 1)$.
The window registered from its centroid, 20 h ± 1 h, is confirmed on fresh data with the effect
($p = 10^{-4}$) and not on fresh data without it ($p = 0.72$).

**Why this is statistically honest.**

- Exploration and confirmation use different data, and the confirmatory window is fixed before
  that data is drawn.
- The scan's p includes the search over all windows; the add-one estimator never reports 0.
- Relabeling happens within labs (`stratum`), so effects never move between studies that ran at
  different longitudes and times. For studies that differ in effect size and in when they ran,
  the ephemeris README reports an unstratified null rejecting in more than 90% of datasets.
- To separate LST from time of day and season, stratify by clock-time or (hour × season) cells,
  as the ephemeris README recommends. The loss of power that costs is the price of the confound.

Sources: Spottiswoode,
[Apparent association between effect size in free response anomalous cognition experiments and local sidereal time](https://jsasoc.com/docs/JSE-LST.pdf),
J. Scientific Exploration 11(2) (1997). The counter-arguments (Ryan 2008; Ryan & Spottiswoode
2015) and page references are in the [ephemeris README](../packages/ephemeris/README.md).

## 10. Beacon rounds and structural checks

**Question.** A script used public randomness from drand. Which rounds did the bytes come from,
when were they published, and what can be checked without trusting the mirror that served them?

**What the result can and cannot mean.** Every beacon result names its rounds, and `getRound`
re-fetches any of them. With `verify: 'structural'` the drand provider checks that the mirror
serves the pinned chain (hash, genesis, period, scheme), that the signature has the scheme's
length, that the round is not from the future by the local clock, and that a served `randomness`
equals SHA-256 of the signature. It does **not** verify the BLS signature, which needs a pairing
library. So a passing check means the response is shaped like the pinned chain, not that the
League of Entropy signed it. drand values are public: never use them as secrets.

```ts
/**
 * Recipe 10: drand round metadata, round arithmetic, re-fetching a round, and what the
 * structural checks catch. Offline it replays a recorded round; --live fetches.
 * bun examples/src/10-beacon-rounds.ts [--live] [--smoke]
 */
import { EntropyError } from '@mindpeeker/entropy'
import { DRAND_CHAINS, drandRoundAt, drandRoundTime } from '@mindpeeker/entropy/providers'
import { parseArgs } from './lib/cli.js'
import { drandBeacon, RECORDED_LATEST_ROUND, recordedDrandFetch } from './lib/drand-fixture.js'

const args = parseArgs()
const chain = DRAND_CHAINS.quicknet
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

// 1. Two rounds of public randomness, each with the round it came from.
const beacon = drandBeacon(args.live) // verify: 'structural'
const { bytes, sources } = await beacon.getBytes(64)
const rounds = sources[0]?.rounds ?? []
for (const [i, r] of rounds.entries()) {
  console.log(
    `round ${r.round}`.padEnd(19),
    new Date(r.timestamp ?? Number.NaN).toISOString(),
    `value ${hex(bytes.subarray(32 * i, 32 * i + 8))}…`,
    `sig ${r.signature?.slice(0, 16)}…`,
  )
}

// 2. Round arithmetic: rounds are a clock, fixed by the chain's genesis and period.
const newest = rounds[0]
if (!newest) throw new Error('no round metadata')
const published = drandRoundTime(newest.round, chain)
console.log(
  'published at       ',
  new Date(published).toISOString(),
  published === newest.timestamp,
)
console.log(
  'round at that time ',
  drandRoundAt(published, chain),
  'and 3 s later',
  drandRoundAt(published + 3000, chain),
)

// 3. Anyone can fetch the same round again and compare the bytes.
const replay = await beacon.getRound(newest.round)
console.log('re-fetched value   ', hex(replay.bytes) === hex(bytes.subarray(0, 32)))

// 4. What the structural checks catch, on doctored copies of the recording.
const attacks: [string, typeof fetch][] = [
  [
    'foreign chain info',
    recordedDrandFetch((path, body) =>
      path.endsWith('/info') ? { ...body, chain_hash: DRAND_CHAINS.default.hash } : body,
    ),
  ],
  [
    'short signature',
    recordedDrandFetch((path, body) =>
      path.includes('/rounds/')
        ? { ...body, signature: String(body.signature).slice(0, 64) }
        : body,
    ),
  ],
  [
    'stale caching proxy',
    recordedDrandFetch((path, body) =>
      path.includes('/rounds/') ? { ...body, round: RECORDED_LATEST_ROUND } : body,
    ),
  ],
]
for (const [label, fetchImpl] of attacks) {
  try {
    await drandBeacon(false, fetchImpl).getRound(RECORDED_LATEST_ROUND - 1)
    console.log(label.padEnd(19), 'accepted')
  } catch (error) {
    const cause = error instanceof EntropyError ? error.code : String(error)
    console.log(label.padEnd(19), `rejected: ${cause}`)
  }
}
```

**Output.**

```text
round 32285086      2026-09-17T15:23:42.000Z value 13bfa6a42a5a93d0… sig a64d99fd7fa3e489…
round 32285085      2026-09-17T15:23:39.000Z value d42020c3c65a4ec6… sig 81dbce51d584d90d…
published at        2026-09-17T15:23:42.000Z true
round at that time  32285086 and 3 s later 32285087
re-fetched value    true
foreign chain info  rejected: verification
short signature     rejected: verification
stale caching proxy rejected: bad_response
```

With `--live` the same script printed rounds 32285412 and 32285411 (the newer one published at
2026-09-17T15:40:00Z) and the same three rejections. The round clock is plain arithmetic:
round r of quicknet is published at $(1692803367 + 3(r - 1))$ seconds after the Unix epoch.

**Why this is statistically honest.**

- Every byte is attributed to a round that anyone can re-fetch and compare.
- The fixture is a recording of real responses, replayed through the provider's own checks, and
  its capture time is part of the file.
- The doctored mirrors show what the structural checks catch: a foreign chain, a malformed
  signature and a caching proxy that answers every round with the latest one.
- The limits are stated where they apply: no BLS verification, a local clock for the future
  check, and public values.

Sources: the [drand specification](https://docs.drand.love/docs/specification/); the per-beacon
verification table in the [entropy README](../packages/entropy/README.md).

## 11. Tamper-evident log with Merkle proofs

**Question.** A lab publishes checkpoints of its session log. Can a reader prove that one record is
in the published log, and that a later checkpoint only appended to an earlier one?

**What the result can and cannot mean.** The records are hash-chained psi session lines. An RFC
6962 Merkle tree over them gives a root per log size. An inclusion proof shows that a line is in
the tree with a given root, in $O(\log n)$ hashes. A consistency proof shows that the tree at size
n extends the tree at size m, so nothing published earlier was rewritten. A C2SP signed checkpoint
shows that the key holder signed (origin, size, root). None of it shows **when** anything was
written, that the operator did not sign two diverging logs (collect checkpoints over time, or
use witnesses), or that the data came from where the log says.

```ts
/**
 * Recipe 11: a tamper-evident session log. RFC 6962 Merkle checkpoints over hash-chained
 * psi records, a signed checkpoint, an inclusion proof and a consistency proof.
 * bun examples/src/11-merkle-log.ts [--source crypto] [--control offline] [--smoke]
 */
import {
  checkpointOf,
  checkpointText,
  ed25519VerifierKey,
  merkleTree,
  serializeCheckpoint,
  signNote,
  toHex,
  verifyChain,
  verifyCheckpoint,
  verifyConsistency,
  verifyInclusion,
} from '@mindpeeker/ledger'
import { recordSession } from '@mindpeeker/psi'
import { openSource, parseArgs, size } from './lib/cli.js'

const args = parseArgs()
const origin = 'example.org/mindpeeker-cookbook/session-log'
const early = size(args, 601, 61) // lines at the first published checkpoint
const total = size(args, 2001, 201) // header + trial lines at the second

// 1. Records: a hash-chained two-source psi session (one line per source per round).
const sources = [openSource(args.source, 'log-a'), openSource(args.control, 'log-b')]
const lines: string[] = []
const offline = args.source === 'offline' && args.control === 'offline'
for await (const line of recordSession(sources, {
  chain: true,
  now: offline ? () => Date.UTC(2026, 8, 17) + lines.length : Date.now,
})) {
  lines.push(line)
  if (lines.length === total) break
}

// 2. Two checkpoints of the same growing log; the log operator signs the newer one.
const keys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, [
  'sign',
  'verify',
])) as CryptoKeyPair
const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey))
const signer = { name: 'cookbook-log', privateKey: keys.privateKey, publicKey }
const before = await checkpointOf(origin, lines.slice(0, early))
const after = await checkpointOf(origin, lines)
const signed = serializeCheckpoint(after, [await signNote(checkpointText(after), signer)])
const verifierKey = await ed25519VerifierKey(signer.name, publicKey)
const status = await verifyCheckpoint(signed, [verifierKey], { origin })
console.log('checkpoint sizes   ', before.size, '→', after.size)
console.log('signed checkpoint  ', status.status, `root ${toHex(after.root).slice(0, 16)}…`)

// 3. Inclusion: one line, one O(log n) proof, checked against the signed root.
const tree = await merkleTree(lines)
const index = Math.floor(total / 2)
const proof = tree.inclusionProof(index)
const line = lines[index] as string
console.log(
  'inclusion          ',
  await verifyInclusion(line, index, tree.size, proof, after.root),
  `(${proof.length} hashes)`,
)
const forged = line.replace(
  /"sum":(\d+)/,
  (_m, s: string) => `"sum":${Number(s) === 0 ? 1 : Number(s) - 1}`,
)
console.log(
  'edited line        ',
  await verifyInclusion(forged, index, tree.size, proof, after.root),
)

// 4. Consistency: the newer tree extends the older one, so nothing published was rewritten.
const consistency = tree.consistencyProof(early)
console.log(
  'append-only        ',
  await verifyConsistency(early, tree.size, before.root, after.root, consistency),
  `(${consistency.length} hashes)`,
)
const rewritten = [...lines]
rewritten[5] = lines[6] as string // history changed before the first checkpoint
const rewrittenTree = await merkleTree(rewritten)
console.log(
  'rewritten history  ',
  await verifyConsistency(
    early,
    tree.size,
    before.root,
    rewrittenTree.root,
    rewrittenTree.consistencyProof(early),
  ),
)

// 5. The chain view of the same file: links hold, and a published head exposes truncation.
const chain = await verifyChain(lines, { format: 'psi' })
const truncated = await verifyChain(lines.slice(0, -1), { format: 'psi', head: chain.head })
console.log('hash chain         ', chain.ok, `head ${chain.head?.slice(0, 16)}…`)
console.log('truncated file     ', truncated.ok, truncated.failure)
```

**Output.**

```text
checkpoint sizes    601 → 2001
signed checkpoint   verified root 211e17deddd7727e…
inclusion           true (11 hashes)
edited line         false
append-only         true (12 hashes)
rewritten history   false
hash chain          true head cdae9dd6f050fdcb…
truncated file      false head_mismatch
```

One line of 2001 is proven with 11 hashes, and 601 → 2001 is proven append-only with 12. Editing a
trial sum fails inclusion, rewriting a line before the first checkpoint fails consistency, and
the chain view detects a dropped last line only because the head was published. The Ed25519 key is
generated per run and not stored, so the signature differs between runs while the status does not.

**Why this is statistically honest.**

- Every proof is checked against a root from a published checkpoint (the newer one is signed
  here), never against a root that came with the proof: a proof alone does not authenticate the
  tree size.
- The failure cases are run, not described: an edited line, a rewritten history and a truncated
  file each fail the check designed to catch them.
- Verification needs only the lines, the proof and the published checkpoint, so any conforming
  RFC 6962 implementation can repeat it.

Sources: [RFC 6962](https://www.rfc-editor.org/rfc/rfc6962.html) and
[RFC 9162](https://www.rfc-editor.org/rfc/rfc9162.html) (Certificate Transparency Merkle trees);
[C2SP tlog-checkpoint](https://c2sp.org/tlog-checkpoint) and
[signed-note](https://c2sp.org/signed-note); Crosby & Wallach,
[Efficient Data Structures for Tamper-Evident Logging](https://www.usenix.org/conference/usenixsecurity09/technical-sessions/presentation/efficient-data-structures-tamper-evident)
(USENIX Security 2009).

## 12. Custom provider with health tests

**Question.** I have my own noise device. How do I turn it into a provider, what do the health
tests catch, and what do they miss?

**What the result can and cannot mean.** `defineProvider` wraps the driver and checks the provider
contract: exact lengths, aborts and timeouts. `serialEntropy({ source })` runs NIST SP 800-90B
health tests over the device's byte stream at the credited min-entropy H = 7 bits per byte: a
start-up test over 1024 samples, the repetition count test with cutoff $1 + \lceil 20/H \rceil = 4$,
and the adaptive proportion test. With `onHealthFailure: 'retest'` an alarm discards the pending
data and reruns the start-up test; the third alarm in a session throws `health_test`. Health tests
catch catastrophic failures relative to the credit. They do not certify fairness, and passing
statistical tests proves nothing about unpredictability, since any CSPRNG passes them.

```ts
/**
 * Recipe 12: a custom provider for your own device. defineProvider wraps the driver,
 * serialEntropy adds SP 800-90B health tests with restart semantics, and negentropy
 * analyses what comes out.
 * bun examples/src/12-custom-provider.ts [--source crypto] [--smoke]
 */
import { defineProvider, EntropyError, type EntropyProvider } from '@mindpeeker/entropy'
import { serialEntropy } from '@mindpeeker/entropy/providers'
import { analyzeBytes, chiSquareBytes, mcvMinEntropy } from '@mindpeeker/negentropy'
import { fmt, openSource, parseArgs, size } from './lib/cli.js'

type Fault = 'healthy' | 'stuck burst' | 'dead after 2 KiB' | 'biased'
const args = parseArgs()
const upstream = openSource(args.source, 'device') // stands in for the physical noise

/** A driver stub with a fault model. defineProvider checks lengths, aborts and timeouts. */
function device(fault: Fault): EntropyProvider {
  let offset = 0
  return defineProvider({
    name: `bench-device(${fault})`,
    kind: 'trng',
    privacy: 'private',
    defaultChunkBytes: 512,
    async getBytes(n, opts) {
      const raw = (await upstream.getBytes(fault === 'biased' ? 5 * n : n, opts)).bytes
      const out = new Uint8Array(n)
      for (let i = 0; i < n; i++, offset++) {
        const u = (k: number) => raw[5 * i + k] as number
        out[i] = raw[i] as number
        if (fault === 'stuck burst' && offset >= 2048 && offset < 2064) out[i] = 0xa5
        if (fault === 'dead after 2 KiB' && offset >= 2048) out[i] = 0
        if (fault === 'biased') out[i] = u(0) | (u(1) & u(2) & u(3) & u(4)) // P(bit = 1) = 17/32
      }
      return {
        bytes: out,
        sources: [{ name: `bench-device(${fault})`, kind: 'trng', privacy: 'private' }],
      }
    },
  })
}

/** SP 800-90B start-up and continuous tests over the device's byte stream. */
function healthTested(
  fault: Fault,
  onHealthFailure: 'throw' | 'retest',
  raw = true,
): EntropyProvider {
  return serialEntropy({
    source: device(fault).stream({ chunkBytes: 512 }),
    name: `tested(${fault})`,
    conditioning: raw ? 'raw' : 'conditioned',
    minEntropyPerSample: 7, // the credit you claim for your device, in bits per byte
    onHealthFailure,
    maxHealthFailures: 3,
    warmupBytes: 0,
  })
}

const bytes = size(args, 16_384, 4_096)
const outputs: { label: string; bytes: Uint8Array }[] = []
const cases: [Fault, 'throw' | 'retest', boolean][] = [
  ['healthy', 'retest', true],
  ['stuck burst', 'throw', true],
  ['stuck burst', 'retest', true],
  ['dead after 2 KiB', 'retest', true],
  ['biased', 'retest', true],
  ['biased', 'retest', false],
]
for (const [fault, mode, raw] of cases) {
  const label = `${fault}, ${mode}, ${raw ? 'raw' : 'conditioned'}`
  try {
    const result = await healthTested(fault, mode, raw).getBytes(bytes)
    outputs.push({ label, bytes: result.bytes })
    console.log(label.padEnd(34), `delivered ${result.bytes.length} bytes`)
  } catch (error) {
    if (!(error instanceof EntropyError)) throw error
    console.log(label.padEnd(34), `failed: ${error.code}`)
  }
}

// Health tests certify the credited min-entropy, not fairness. Ask the statistics.
const steps = Math.floor((bytes * 8) / 200)
for (const { label, bytes: data } of outputs) {
  const result = analyzeBytes([{ source: label, bytes: data }], {
    events: [{ id: 'whole-output', statistic: 'netvar', start: 0, end: steps }],
  })
  const event = result.events[0]
  console.log(
    label.padEnd(34),
    `netvar z ${fmt(event?.z ?? Number.NaN)}`,
    `byte χ² p ${fmt(chiSquareBytes(data).pValue)}`,
    `MCV H ${fmt(mcvMinEntropy(data), 2)} b/B`,
  )
}
```

**Output.**

```text
healthy, retest, raw               delivered 16384 bytes
stuck burst, throw, raw            failed: health_test
stuck burst, retest, raw           delivered 16384 bytes
dead after 2 KiB, retest, raw      failed: health_test
biased, retest, raw                delivered 16384 bytes
biased, retest, conditioned        delivered 16384 bytes
healthy, retest, raw               netvar z -0.3252 byte χ² p 0.8788 MCV H 7.22 b/B
stuck burst, retest, raw           netvar z -1.2869 byte χ² p 0.2136 MCV H 7.21 b/B
biased, retest, raw                netvar z 10.5596 byte χ² p 3.21e-38 MCV H 6.88 b/B
biased, retest, conditioned        netvar z 0.0140 byte χ² p 0.7471 MCV H 7.15 b/B
```

A 16-byte stuck burst fails at once with `'throw'` and is survived with `'retest'`; a device that
goes dead fails at its third alarm (the error message says "alarm 3 of 3"). The biased device (each bit 1 with probability 17/32) passes
the health tests, because its true min-entropy, $8 \log_2(32/17) \approx 7.30$ bits per byte, is
above the credit of 7. The statistics catch what the health tests were never meant to: its trial
variance (netvar z = 10.6) and byte histogram (χ² p ≈ $3 \cdot 10^{-38}$) are far from fair bits.
SHA-256 conditioning of the same device passes both. The most-common-value estimates are
conservative on 16 KiB, which is why even the DRBG reads about 7.2 bits per byte.

**Why this is statistically honest.**

- Each fault is injected at a known offset, so what the health tests catch is shown rather than
  assumed.
- The alarm rate is not zero on a healthy source: at a credit of 7–8 bits per byte the RCT
  raises about 1/16 of a false alarm per MiB of raw samples (entropy README), which is why
  `'retest'` and a failure budget exist.
- Health tests and statistics answer different questions, and the script reports both instead
  of treating one as a certificate for the other.
- Raw and conditioned output are labelled separately; the conditioned result must not be read as
  evidence that the raw device is fair.

Sources: NIST [SP 800-90B](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/nist.sp.800-90b.pdf),
§4.3–4.4 (health tests); the conditioning and restart semantics in the
[entropy README](../packages/entropy/README.md).
