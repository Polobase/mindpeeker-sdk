# Releases

Release notes for the `@mindpeeker/*` packages. Each package also has a `CHANGELOG.md` with its
full list of changes, generated from the changesets. How releases are made is described in
[docs/releasing.md](docs/releasing.md).

## v0.2.0 (unreleased)

<!-- At publish time: replace "(unreleased)" with the date and add the GitHub release link. -->

All fifteen packages are at **0.2.0**.

| Package | Status | Changelog |
|---|---|---|
| `@mindpeeker/entropy` | update from 0.1.0 | [CHANGELOG](packages/entropy/CHANGELOG.md) |
| `@mindpeeker/negentropy` | update from 0.1.0 | [CHANGELOG](packages/negentropy/CHANGELOG.md) |
| `@mindpeeker/flow` | update from 0.1.0 | [CHANGELOG](packages/flow/CHANGELOG.md) |
| `@mindpeeker/psi` | update from 0.1.0 | [CHANGELOG](packages/psi/CHANGELOG.md) |
| `@mindpeeker/rate` | update from 0.1.0 | [CHANGELOG](packages/rate/CHANGELOG.md) |
| `@mindpeeker/oracle` | update from 0.1.0 | [CHANGELOG](packages/oracle/CHANGELOG.md) |
| `@mindpeeker/vdf` | update from 0.1.0 | [CHANGELOG](packages/vdf/CHANGELOG.md) |
| `@mindpeeker/visualizer` | update from 0.1.0 | [CHANGELOG](packages/visualizer/CHANGELOG.md) |
| `@mindpeeker/scan` | first npm release | [CHANGELOG](packages/scan/CHANGELOG.md) |
| `@mindpeeker/field` | first npm release | [CHANGELOG](packages/field/CHANGELOG.md) |
| `@mindpeeker/gematria` | first npm release | [CHANGELOG](packages/gematria/CHANGELOG.md) |
| `@mindpeeker/ledger` | new package | [CHANGELOG](packages/ledger/CHANGELOG.md) |
| `@mindpeeker/coincidence` | new package | [CHANGELOG](packages/coincidence/CHANGELOG.md) |
| `@mindpeeker/ephemeris` | new package | [CHANGELOG](packages/ephemeris/CHANGELOG.md) |
| `@mindpeeker/judging` | new package | [CHANGELOG](packages/judging/CHANGELOG.md) |

While the packages are at 0.x, a minor release may change behaviour; every such change is
listed (see [decision 0008](docs/decisions/0008-semver-policy-0x.md)). Most of the breaking
changes in this release correct wrong mathematics or broken contracts.

### Highlights

#### Security fix in `@mindpeeker/vdf`

The 0.1.0 verifier accepted the negated output n − y together with a re-derived proof, for
every non-power-of-two T (and for power-of-two T with sign-flipped midpoints). Whoever computed
a seal could therefore choose between two values that both verified. 0.2.0 computes in the
signed quadratic residues QR_N+: every element is the canonical representative in
[1, (n − 1)/2], and the verifiers reject anything else, including elements with an inadmissible
Jacobi symbol. Transcripts bind the modulus and proof bytes carry a version and a modulus
fingerprint, so **every output, proof and seal stored under 0.1.0 must be recomputed**.

A seal remains a no-earlier-than bound: it shows that the sealer spent at least T sequential
squarings after seeing the input. It cannot show when the work finished; that needs an external
witness such as a later beacon round or a timestamp.

#### Statistical and numerical correctness

These fixes change results. The last column says whether the defect was in a version published
on npm.

| Package | What was wrong | What 0.2.0 does | On npm before? |
|---|---|---|---|
| `entropy` | With `safetyFactor ≤ 0` or H = ∞, a local provider emitted the constant block SHA-256('') as "entropy". | Conditioning options are validated at construction (`invalid_request`). | yes (0.1.0) |
| `entropy` | The Adaptive Proportion Test cutoff underflowed and silently disabled the test for credits below about 0.38 bits per sample at W = 512 (jitter and sensor providers). | Cutoffs are computed exactly in log space. | yes |
| `entropy` | The first health alarm ended the call. A perfectly uniform source credited at 7–8 bits per byte failed 6% of 1 MiB reads and 21% of 4 MB reads. | SP 800-90B restart semantics: the 3rd alarm of a session fails, giving about 4·10⁻⁵ for 1 MiB and 0.19% for 4 MB. | yes |
| `negentropy` | χ² p-values threw a raw `Error` for df above about 3.7·10⁶ when the statistic was near its mean, so `devvar` over a day of a GCP-size network crashed on about half of healthy runs; lower-tail `chi2Ppf` quantiles were clamped near 5.7e-14. | Temme's uniform asymptotic expansion near the transition point, correct lower-tail quantiles, typed `numerical` errors. | yes |
| `negentropy` | Under `missing: 'skip'` session series desynchronised, and `stop()` threw away the recording when a window had not elapsed. | One row per tick per source; `stop()` never throws and marks unfinished events `incomplete`. | yes |
| `negentropy` | Overlapping events were combined by plain Stouffer, whose null variance was about 1.93 in a simulation. | Brown's correction with exact null correlations (null variance about 1). | yes |
| `psi` | `rollingNetvar` showed z = −8.21 whenever the window statistic was 0, which is common for small windows of discrete trials. | Reports the exact discrete floor. | yes |
| `psi` | `timeOffsetSurrogates` rotated one source only, so with three or more sources most pair alignments survived into the null (a loss of power, not of false-positive control). | `rotate: 'all-but-one'` and `'all'`; the default is documented as power-limited. | yes |
| `psi` | The label-shuffle null of the presentiment protocol used rotations only; for alternating target/control designs about 50% of null datasets were rejected at α = 0.05. | Seeded uniform permutations or exact enumeration, checked by an H0 calibration test. | no (development version) |
| `scan` | The deviation p was a normal tail: at N = 16 rounds a fair source crossed p < 0.05 with probability 0.077. Bayes-factor ranking compared `Infinity − Infinity`. | Exact two-sided binomial p, ranking on the log Bayes factor, Bonferroni/Holm/BH fields. | no (first release) |
| `field` | The void p was e^−μ = 0.018 on essentially every random field, and in simulations the old void p was ≤ 0.05 in 88.5% (n = 60) and 100% (n = 300) of CSR fields. | An exact edge-corrected single-point tail plus a calibrated whole-field p; the attractor's whole-field p was ≤ 0.05 in 4.0% (n = 60) and 4.7% (n = 300) of CSR fields. | no (first release) |
| `gematria` | Reverse dropped Hebrew final letters (`שלום` reversed gave 102, not Atbash's 112) and mirrored the Greek glyph table instead of the 27 numerals; Arabic ؤ ئ scored 0; `achbi` implemented Aibat; words in other scripts matched each other at value 0. | Canonical alphabets with explicit folds, NFKD for Arabic (`موسى` is 116), correct Achbi, script-aware lexicons. | no (first release) |

None of these fixes makes an anomaly more or less likely to be real. They make the reported
p-values and Bayes factors mean what their documentation says under the stated null models.

#### New packages

- **`@mindpeeker/ledger`**: tamper-evident records from standard cryptography (RFC 8785
  canonical JSON, hash-chained JSONL, RFC 6962 Merkle proofs, C2SP signed notes, commit–reveal,
  a pre-registration schema, beacon/VDF time brackets). It proves what was written and roughly
  when, never that a hypothesis is true.
- **`@mindpeeker/coincidence`**: exact coincidence probabilities (birthday generalisations,
  Levin's k-fold matches, near matches, Fisher's 1924 scores, an exact clustering test). They
  say how cheap a coincidence is under a stated model, not what it means.
- **`@mindpeeker/ephemeris`**: Julian day, ΔT, sidereal time, low-precision Sun and Moon
  (Meeus), and Spottiswoode's local-sidereal-time window scan with a permutation null. The
  sidereal-time hypothesis is contested; the package lets you test it, including against its
  seasonal confound.
- **`@mindpeeker/judging`**: exact scoring for forced-choice and free-response designs
  (closed-deck matching, Read's feedback baseline, rank-matrix permutation tests, displacement
  variance, optional-stopping risk). Whether psi exists is not asserted.

#### Selected additions to existing packages

- `negentropy`: anytime-valid monitoring (`netvarMartingale`, `driftMartingale`, `anytimeP`,
  `villeCrossing`). In 1000 seeded null runs of 3000 steps, the pointwise χ² envelope was
  crossed in 46% of paths and the time-uniform boundaries in 0.9–3.2%. Also versioned
  registration digests and the GCP statistics `covar`, blocked netvar/devvar and
  `varianceRatio`.
- `psi`: tripolar schedules (`counterbalanced`, `instructed`, `volitional`), a yoked control arm
  with `controlContrast` and TOST equivalence, registration binding, Bayes factors with a `p0`
  parameter, `coinEProcess` and sequential plans, hash-chained JSONL v2 recordings with
  `verifyChain`, and GCP basket-file parsing. Checking a fixed-n p-value after every flip from
  10 to 2000 rejects a fair coin with probability 0.511; the e-process at 1/α = 20 rejects with
  probability 0.037.
- `entropy`: `drbgProvider` (SP 800-90A HMAC_DRBG) for seeded control runs, round metadata
  and `getRound` on beacons, opt-in NIST-family and drand structural verification, TrueRNG and
  OneRNG presets.
- `flow`: a χ² test for transfer entropy with an adequacy guard, conditional and collective
  transfer entropy, active information storage, lag scans and new surrogate families.
- `vdf`: Wesolowski proofs (526 bytes at 2048 bits), checkpoints, seal bytes, `checkModulus`.
- `oracle`: reader lifecycle, `recordingReader` for exact replay, and Ifá, sixteen cowries,
  kau cim, Mo, astragaloi and the Homer oracle.
- `visualizer`: Origin checks, a pointwise band next to an anytime-valid boundary, and
  `--record`/`--replay` with chain verification.

### Upgrade guide

Breaking changes per package, with what to do. The package CHANGELOGs and the "Behaviour
changes in 0.2.0" sections of the package READMEs have the complete lists.

**All packages.** `engines.node` is `>=20.19` (was `>=20.3`); the visualizer declares only Bun
`>=1.2`. Published tarballs now include `src`, so source maps resolve.

#### `@mindpeeker/vdf`

- Recompute every stored output, proof and seal: values, transcripts (`DOMAIN_TAG`
  `'mindpeeker-vdf-v2'`) and wire bytes (`PROOF_VERSION` 0x02) all changed. 0.1.0 proof bytes
  throw `unsupported_version`; handle the new `modulus_mismatch` code too.
- `pietrzakProve` rejects a `y` above (n − 1)/2.
- Progress totals changed (`pietrzakProveCost`), and `calibrate`'s `sampleMs` is a total budget
  split into `samples` windows.

```ts
import { evaluate, pietrzakProve, pietrzakVerify, sealBeacon, sealToBytes, verifySealBytes } from '@mindpeeker/vdf'

const input = new TextEncoder().encode('registration digest')
const T = 100_000
const { y, checkpoints } = await evaluate(input, T, { checkpoints: Math.ceil(Math.sqrt(T)) })
const proof = await pietrzakProve(input, T, y, { checkpoints })
await pietrzakVerify(input, T, y, proof) // → true

const pulseBytes = new TextEncoder().encode('nist-pulse 2026-07-08T12:00:00Z')
const seal = await sealBeacon(pulseBytes, 100_000)
const bytes = sealToBytes(seal, pulseBytes) // version, modulus fingerprint, SHA-256(pulse), T, y, proof
await verifySealBytes(pulseBytes, bytes) // → true
```

#### `@mindpeeker/entropy`

- Conditioning options must satisfy 0 < `minEntropyPerSample` ≤ 8 and `safetyFactor` ≥ 1.
- No output leaves a session before 1024 raw samples pass the health tests.
- A health alarm restarts the tests; the 3rd alarm of a session throws `health_test`. To keep
  0.1.0's behaviour pass `onHealthFailure: 'throw'`; for long unattended streams raise
  `maxHealthFailures`.
- Configuration errors and missing or malformed API keys throw `EntropyError('invalid_request')`
  instead of `TypeError`. A key read from a file must not keep its trailing newline.
- Streams report `aborted`, `timeout` and `network` instead of raw `DOMException`s; invalid
  `chunkBytes` rejects the first pull. Beacon streams always re-slice to `chunkBytes`.
- `randao` returns completed-epoch mixes and streams once per epoch. Walk-backs that return the
  wrong round throw `bad_response`.
- Types: beacon factories return `BeaconProvider`; `EntropyResult.sources` entries may carry
  `rounds`; `EntropyErrorCode` gains `permission` and `verification`.

```ts
import { jitterEntropy } from '@mindpeeker/entropy/providers'

const strict = jitterEntropy({ onHealthFailure: 'throw' }) // 0.1.0: the first alarm fails
const unattended = jitterEntropy({ maxHealthFailures: 1000 })
```

#### `@mindpeeker/negentropy`

- Registration hashes change. Register again and publish the new hash; hand-built
  `{ config, hash }` objects are refused, and `canonicalJson` rejects `Date`, `Map`, `Set`,
  `BigInt` and `undefined` members instead of coercing them.
- `session()` validates at construction; `stepTimeoutMs` must be finite in (0, 2³¹ − 1] or
  `Infinity`.
- `stop()` never throws: check `event.status` instead of catching `invalid_window`. Batch
  analysis likewise returns `incomplete` events for windows past the data.
- Under `missing: 'skip'`, archives hold `NaN` for absent sources, and statistics combine over
  the sources present at each step.
- Overlapping events change the composite (`independent: false`, Brown's method).
- Domain errors in the special functions are `NegentropyError('invalid_config')`, and
  non-convergence is `numerical`. Estimators throw `insufficient_data` instead of returning NaN.
- Exhaustive switches over `EventStatistic` must handle `'covar'`.

```ts
import { analyzeTrials, registerExperiment, session } from '@mindpeeker/negentropy'
import { cryptoProvider, drand } from '@mindpeeker/entropy/providers'

const registration = await registerExperiment({
  trial: { clock: { mode: 'interval', intervalMs: 1000 } },
  calibration: { trials: 600 },
  missing: 'skip',
  events: [{ id: 'session-1', statistic: 'netvar', start: 0, end: 3600 }],
})
const live = session({ sources: [drand(), cryptoProvider()], registration, stepTimeoutMs: Infinity })
// … iterate `live`, then:
const result = live.stop() // never throws
for (const event of result.events) {
  if (event.status === 'incomplete') console.log(event.id, event.reason)
}
// exact re-analysis, no second burn-in:
const again = analyzeTrials(result.series, { registration, calibration: result.calibration })
```

#### `@mindpeeker/psi`

- Rolling monitors: rename `windowTrials`/`hopTrials` to `windowSize`/`hopSize`.
- `analyzeTripolar` throws `invalid_plan` for unknown intentions and the new `plan_mismatch`
  for mixed schedules; `PsiErrorCode` gains `plan_mismatch`.
- A source that ends its stream after an abort now yields `aborted` in `runTripolar`,
  `recordSession` and the rolling monitors.
- `parseRecordLine` returns a union; narrow it before reading `sum`. `readSession` treats a
  plain string as one chunk.
- `timeOffsetSurrogates`: `count` is deprecated in favour of `surrogates`.

```ts
import { parseRecordLine, rollingStouffer, type TrialSource } from '@mindpeeker/psi'

declare const sources: readonly TrialSource[]
declare const raw: string

for await (const point of rollingStouffer(sources, { windowSize: 600, hopSize: 60 })) {
  console.log(point.at, point.z, point.sourceCount)
}

const line = parseRecordLine(raw)
if (!('kind' in line)) console.log(line.source, line.sum) // a trial line (v1 or v2)
```

#### `@mindpeeker/oracle`

- Custom `ByteReader` implementations need `close()` and `[Symbol.asyncDispose]()`.
- Casts close the reader they create, so an `AsyncIterable` passed directly is finished after
  one cast. To run several casts on one stream, share a reader and close it yourself.
- Source failures arrive as `OracleError('source_error')`; concurrent casts on one reader throw
  `invalid_input`.
- Widened types (`CastMethod`, `SpreadName`, nullable `Rune.aett`) can break exhaustive switches.

```ts
import { byteReader, castRunes, castShield } from '@mindpeeker/oracle'
import { cryptoProvider } from '@mindpeeker/entropy/providers'

const src = cryptoProvider()
{
  await using reader = byteReader(src) // closed at scope exit
  const runes = await castRunes(reader, 3, { merkstave: true })
  const shield = await castShield(reader)
  console.log(runes.runes.length, shield.judge.name)
}
```

#### `@mindpeeker/flow`

- Seeded surrogate ensembles change (`xoshiro128ss` replaces `xorshift32`); record new
  reference values. Seeds must be non-negative safe integers.
- `permutationTest` throws for an unknown `surrogate` and returns more fields; rotation tests
  with n − 1 ≤ `surrogates` enumerate all rotations.
- Aborts reject with `FlowError('aborted')` and upstream failures with the new `source_error`.
- `effectiveTransferEntropy`: prefer `surrogates` over the deprecated `nShuffles`.
- The package now depends on `@mindpeeker/negentropy`.

```ts
import { effectiveTransferEntropy, permutationTest } from '@mindpeeker/flow'

declare const x: Uint8Array
declare const y: Uint8Array

const { p, z, distinct } = permutationTest(x, y, { surrogates: 199, seed: 42 })
const { ete } = effectiveTransferEntropy(x, y, { surrogates: 20, seed: 42 })
```

#### `@mindpeeker/visualizer`

- Browser pages on another origin (for example behind a reverse proxy) need `allowedOrigins`.
- Inbound socket messages close the connection; `attachStatic` throws for unserializable
  documents; `createDashboard` validates `port` and `host`.
- Wire protocol 2: decoders compare a frame's first byte with the kind's layout version, not
  with `PROTOCOL_VERSION`. Clients that send no `?v=` still receive protocol 1.
- Objects implementing `Dashboard` need `setNote`.

```ts
import { createDashboard } from '@mindpeeker/visualizer'

const dashboard = createDashboard({ allowedOrigins: ['https://lab.example'] })
```

#### `@mindpeeker/rate`

No API change; only the `engines` range above.

#### `@mindpeeker/scan`, `@mindpeeker/field`, `@mindpeeker/gematria`

First npm releases. Their breaking changes matter only if you used the unpublished 0.1.0
versions from this repository:

- `scan`: exact binomial deviation p, eight coins per byte, the AetherOnePi race subset rule,
  receipts v2, stricter catalogs, and `broadcast` rejecting on source failures.
- `field`: `Hotspot.pValue` is the exact single-point tail (use `fieldSignificance` for a
  whole-field claim), n − 1 in the default radius, the new `csrEnvelope` signature, and the
  `insufficient_entropy`/`source_error` codes.
- `gematria`: canonical-alphabet reverse, `la-agrippa` = `la-jewish`, `achbi` corrected (the old
  mapping is `aibat`), script-aware lexicons, and `GematriaError` for every oracle-bridge failure.

```ts
import { csrEnvelope, type FieldInput, type FieldRegion, type Point } from '@mindpeeker/field'
import { aibat } from '@mindpeeker/gematria'

declare const points: readonly Point[]
declare const reader: FieldInput
declare const region: FieldRegion

const env = await csrEnvelope(points, reader, region, [2, 4, 6, 8, 10, 14], { runs: 999 })
console.log(env.global.p, env.global.mad.p) // one p over all radii; the MAD test

aibat('אבגד') // 'יטחז': the mapping 0.1.0 shipped as achbi
```

### Publish order

Each package is published after every workspace package it depends on (checked against every
`package.json`; see [docs/releasing.md](docs/releasing.md) for the procedure):

| # | Package | Workspace dependencies |
|---|---|---|
| 1 | `negentropy` | — |
| 2 | `entropy` | — |
| 3 | `rate` | — |
| 4 | `oracle` | — |
| 5 | `vdf` | — |
| 6 | `coincidence` | — |
| 7 | `ephemeris` | — |
| 8 | `ledger` | — |
| 9 | `flow` | `negentropy` |
| 10 | `judging` | `negentropy` |
| 11 | `gematria` | `oracle` |
| 12 | `psi` | `negentropy` |
| 13 | `field` | `negentropy`, `oracle` |
| 14 | `scan` | `negentropy`, `oracle`, `psi`, `rate` |
| 15 | `visualizer` | `entropy`, `negentropy`, `psi` |

Known issue at release time: since pulse 2/1925734 (2026-09-03) NIST beacon pulses carry
512-byte signatures but name a 2048-bit certificate, so `nistBeacon({ verify: true })` fails with
`verification`; `verify: 'hash'` passes.
