# @mindpeeker/entropy

Provider-pluggable **quantum (QRNG)** and **true (TRNG)** randomness for web and Node.js.

Eleven entropy backends behind one tiny interface, with composable combining strategies
(fallback chains, XOR mixing, racing), request/response *and* streaming access, and honest
source attribution — every result tells you where its bytes actually came from.

- **Runtime-agnostic**: standard `fetch`, `WebSocket`, `globalThis.crypto` only. Zero dependencies. ESM. Node ≥ 20.3 and evergreen browsers.
- **Exactly-n-or-throw**: `getBytes(n)` always resolves with exactly `n` bytes or throws a typed `EntropyError` — per-request caps and chunking are each provider's internal concern.
- **Honest metadata**: providers are classified by `kind` (`qrng` / `trng` / `beacon` / `csprng`) and `privacy` (`private` / `public`) so you can't accidentally seed a secret from a public beacon.

```sh
npm install @mindpeeker/entropy    # or bun add @mindpeeker/entropy
```

## Quick start

```ts
import { anuLegacy, cryptoProvider, fallback } from '@mindpeeker/entropy'

// The classic: try quantum first, fall back to the local CSPRNG — and know which one served.
const entropy = fallback([anuLegacy(), cryptoProvider()])

const { bytes, sources } = await entropy.getBytes(32)
console.log(sources.map((s) => s.name)) // ['anu-legacy'] … or ['crypto'] if ANU was down
```

## Providers

| Factory | Source | Kind | Privacy | Auth | Notes |
|---|---|---|---|---|---|
| `cryptoProvider()` | runtime CSPRNG | csprng | private | — | always available; last link of every good fallback chain |
| `anu({ apiKey })` | ANU quantum vacuum | qrng | private | `x-api-key` (AWS Marketplace) | ≤1024 numbers/request (chunked automatically) |
| `anuLegacy()` | ANU quantum vacuum | qrng | private | none | **1 request/minute** (client-side gate built in); retirement announced |
| `qrandomIo()` | IDQ Quantis photonics | qrng | private | none | free; Falcon-512-signed responses (not verified in v1) |
| `lfdr()` | IDQ Quantis PCIe | qrng | private | none | hobby-grade lab service, no SLA |
| `outshift({ apiKey })` | Cisco photonic QRNG | qrng | private | `x-id-api-key` (free signup) | 100k bits/day free tier |
| `qci({ apiToken })` | QCi photonic uQRNG | qrng | private | OAuth2 token exchange | bearer token cached; auto re-auth on 401 |
| `randomOrg({ apiKey })` | atmospheric radio noise | trng | private | JSON-RPC apiKey | honors `advisoryDelay`; 250k bits/day free |
| `superRand({ apiKey })` | EM background noise | trng | private | key in query | **WebSocket streaming**; ≤256 values/request; wire format live-verified |
| `drand()` | League of Entropy (threshold BLS) | beacon | **public** | none | 3 s rounds, 32 B each; mirror failover built in |
| `nistBeacon()` | NIST full-entropy source | beacon | **public** | none | 512 bits/min; NIST: *never use as secret keys* |
| `cameraEntropy()` | camera sensor noise (shot/thermal) | trng | private | camera permission | frame-diff sign bits (AetherOnePi-style); browser or injected frames |
| `micEntropy()` | microphone ADC noise | trng | private | mic permission | sample LSBs; browser or injected PCM |
| `serialEntropy({...})` | ESP32 / TrueRNG / OneRNG over serial | trng | private | — | Web Serial `port` or any injected byte `source` |
| `jitterEntropy()` | CPU timing jitter | trng | private | — | Node `hrtime` (credited 1/16 bit/delta); browser only via `allowCoarseClock` |

All network providers accept `fetch` (dependency injection / proxying) and a base-URL override.

## Randomness classes — what you're actually getting

"Random" hides four very different claims. Every provider's class, physical process and the
actual basis of its unpredictability:

| Source | Class | Physical process | Why it's unpredictable |
|---|---|---|---|
| `cryptoProvider` | **CSPRNG** (deterministic) | none — an algorithm seeded from OS entropy | computational hardness only; predictable to anyone holding the state |
| `anu`, `anuLegacy` | **Quantum** (QRNG) | vacuum fluctuations of the electromagnetic field | quantum measurement — non-deterministic by the laws of physics |
| `qrandomIo`, `lfdr` | **Quantum** (QRNG) | photon detection (ID Quantique Quantis) | quantum shot noise |
| `outshift`, `qci` | **Quantum** (QRNG) | photonic hardware (Cisco / QCi) | quantum optics |
| `cameraEntropy` | **Hybrid** quantum + classical | photon shot noise (lit scene — quantum) and sensor thermal noise (covered lens — classical) | photon-arrival statistics / Johnson noise |
| `randomOrg` | **Classical TRNG** | atmospheric radio noise | chaotic macroscopic physics — deterministic in principle, unmeasurable in practice |
| `superRand` | **Classical TRNG** | electromagnetic background noise | chaotic macroscopic physics |
| `serialEntropy` (ESP32) | **Classical TRNG** | SAR-ADC thermal/RF noise (`bootloader_random`) | thermal noise |
| `micEntropy` | **Classical TRNG** | microphone ADC / Johnson noise | thermal noise |
| `hwRng` | varies | whatever the kernel's `/dev/hwrng` driver trusts | device-dependent |
| `jitterEntropy` | **Software/physical hybrid** | CPU micro-architectural timing chaos | system state too complex to model — weakest physical claim |
| `drand` | **Cryptographic beacon** | none per round — threshold BLS signatures | cryptography + distributed trust; **PUBLIC** values |
| `nistBeacon` | **TRNG-backed beacon** | NIST-internal hardware entropy | single-operator trust; **PUBLIC** values |

Rules of thumb: only the quantum sources are non-deterministic *in principle*; classical TRNGs
are practically unpredictable but not fundamentally so; a CSPRNG is pure math; beacons are not
private entropy at all — they are shared, verifiable randomness.

## Local physical entropy

The four local providers share one pipeline: raw physical samples → **continuous NIST SP 800-90B
health tests** (Repetition Count + Adaptive Proportion, always on) → **SHA-256 extraction** with a
conservative per-source entropy credit — or, with `conditioning: 'raw'`, a health-tested
passthrough of the unwhitened physical bits (the provider then reports itself as `name(raw)` in
attribution, so results are always traceable). A failing source throws
`EntropyError('health_test')` — it never silently degrades to pseudo-randomness.

```ts
import { cameraEntropy, serialEntropy, xorMix, cryptoProvider } from '@mindpeeker/entropy'

// Browser webcam, whitened:
const cam = cameraEntropy() // getUserMedia; cover the lens for pure thermal noise

// Raw hotbits for oracle/radionics workflows — unwhitened frame-diff sign bits:
const rawCam = cameraEntropy({ conditioning: 'raw' })

// Defense in depth stays available:
const belt = xorMix([cam, cryptoProvider()])
```

### ESP32 (AetherOnePi firmware)

Flash the [AetherOnePi ESP32 sketch](https://github.com/isuretpolos/AetherOnePi) (streams raw
`esp_fill_random` bytes at 921 600 baud — keep `bootloader_random_enable()` on) and read it:

```ts
// Browser (Chromium, Web Serial):
const port = await navigator.serial.requestPort()
const esp32 = serialEntropy({ port, name: 'esp32' })

// Node (macOS/Linux, zero deps — stty + fs):
import { nodeSerialSource } from '@mindpeeker/entropy/node'
const esp32 = serialEntropy({
  source: await nodeSerialSource({ path: '/dev/cu.usbserial-110' }),
  name: 'esp32',
})
```

TrueRNG v3 works the same way (plain CDC read); OneRNG needs its init command via the
`init` option (check onerng.info for your firmware).

### Node camera & microphone

Node has no `getUserMedia`; inject frames/PCM — the built-in adapters spawn `ffmpeg`
(must be installed) with zero npm dependencies:

```ts
import { ffmpegFrameSource, ffmpegSampleSource, hwRng } from '@mindpeeker/entropy/node'

cameraEntropy({ source: ffmpegFrameSource({ device: '0' }) })        // avfoundation index / /dev/video0
micEntropy({ source: ffmpegSampleSource({ device: ':0' }) })         // ':0' avfoundation / 'default' alsa
hwRng()                                                              // /dev/hwrng (usually root-only)
```

## Measured performance

Real measurements from `bun scripts/bench.ts` (Apple Silicon macOS, Bun 1.3, residential
connection, 2026-07-07 — rerun it yourself; results vary with network, hardware and light):

| Rank | Provider | Kind | Transport | Request | Latency | Effective rate | Notes |
|---|---|---|---|---|---|---|---|
| 1 | `crypto` | csprng | in-process | 1 MiB | 1 ms | ~870 MiB/s | baseline, not physical entropy |
| 2 | `esp32` (raw) | trng | USB serial 921600 | 16 KiB | 233 ms | **~69 KiB/s** | AetherOnePi firmware, near wire speed |
| 3 | `esp32` (conditioned) | trng | USB serial 921600 | 2 KiB | 65 ms | ~31 KiB/s | SHA-256, 2× credit |
| 4 | `jitter` | trng | in-process | 1 KiB | 112 ms | ~9 KiB/s | hrtime deltas, conditioned |
| 5 | `camera` (raw) | trng | ffmpeg avfoundation | 1 KiB | 1.9 s | ~540 B/s | debiased sign bits |
| 6 | `lfdr.de` | qrng | https | 64 B | 139 ms | ~460 B/s | free, keyless |
| 7 | `random.org` | trng | https | 64 B | 196 ms | ~330 B/s | 250k bits/day |
| 8 | `qrandom.io` | qrng | https | 64 B | 232 ms | ~280 B/s | free, keyless |
| 9 | `outshift` | qrng | https | 64 B | 475 ms | ~135 B/s | 100k bits/day |
| 10 | `nist-beacon` | beacon | https | 64 B | 677 ms | ~95 B/s | PUBLIC bits |
| 11 | `drand` | beacon | https | 64 B | 890 ms | ~72 B/s | PUBLIC bits, 2 rounds |
| 12 | `anu` (keyed) | qrng | https | 64 B | 980 ms | ~65 B/s | quantum vacuum |
| 13 | `superrand` (REST) | trng | https | 64 B | 1.3 s | ~51 B/s | ≤256 values/request |
| 14 | `camera` (conditioned) | trng | ffmpeg | 64 B | 3.6 s | ~18 B/s | warmup + 8× credit dominate |
| 15 | `anu-legacy` | qrng | https | 16 B | 1.1 s | ~14 B/s | hard 1 req/min limit |

Reading the numbers:

- **Cloud rates are latency-bound**, not throughput limits — a 64-byte request costs one round
  trip, so bigger requests amortize much better (e.g. `random.org` serves up to 128 KiB per call).
- **The ESP32 is by far the fastest physical source** — orders of magnitude ahead of any cloud
  QRNG — which is exactly why local hardware is worth the USB cable.
- **Camera small reads pay fixed costs** (auto-exposure warmup + the deliberately paranoid 8×
  extraction credit). Streaming or raw mode is where it shines; covered-lens thermal mode works too.
- For **bulk + strongest-source guarantees**, mix fast local with a cloud QRNG:
  `xorMix([serialEntropy({...}), anu({...})])` costs one round trip regardless of size.

## Entropy quality (measured)

`bun scripts/quality.ts` collects RAW output from each local source and runs Shannon entropy,
NIST SP 800-90B estimators (most-common-value, binary Markov), chi-square, serial correlation,
monobit/runs, Monte-Carlo π and gzip compressibility. **Statistical tests can only fail a
source, never certify one** — whitened output (all cloud providers, anything conditioned)
passes everything by construction, so the honest subjects are the raw local sources:

| Source | Sample | Shannon (b/B) | 90B MCV (b/B) | 90B Markov (b/bit) | χ² p | Serial corr | Runs z | gzip |
|---|---|---|---|---|---|---|---|---|
| `crypto` (baseline) | 1 MiB | 8.000 | 7.88 | 0.999 | 0.43 | 0.0013 | −1.6 | 1.000 |
| `microphone` raw | 32 KiB | 7.994 | 7.40 | 0.996 | 0.57 | 0.0110 | 1.3 | 1.001 |
| `esp32` raw | 1 MiB | 7.880 | 7.06 | 0.932 | 0.00 | −0.0805 | 143.7 | 0.992 |
| `camera` raw | 64 KiB | 7.969 | 7.02 | 0.896 | 0.00 | −0.0003 | 54.7 | 1.001 |
| `jitter` raw | 512 KiB | 2.211 | 1.29 | 0.432 | 0.00 | 0.2196 | 1024 | 0.100 |

What the numbers say (and why the credited H values hold up):

- **`esp32` raw measures 7.06 b/B against a credited 7 b/B** — almost exactly on target. Note
  it is *not* perfectly white (visible serial correlation and run structure), which is precisely
  why the library still conditions it by default instead of trusting `esp_fill_random` blindly.
- **`camera` raw (post-von-Neumann) measures 7.02 b/B against a credited 1 b/B** — a 7× safety
  margin. The χ²/runs failures show real residual structure; the 8× extraction credit absorbs it.
- **`microphone` raw measures 7.40 b/B against a credited 2 b/B** — the MacBook mic's ADC noise
  LSBs are surprisingly clean; the 4× credit leaves a comfortable margin for worse microphones.
- **`jitter` raw is heavily structured** (Shannon 2.2, gzip-compressible to 10%!) — validating
  the ultra-conservative 1/16 b credit (measured MCV 1.29 → 20× margin).
- `crypto` aces everything, as any CSPRNG must — which is exactly why passing proves nothing.

### Whitened sources (sanity check, not a ranking)

The same battery over the cloud providers, with quota-polite sample sizes. All of these are
whitened server-side, so differences here are **sample-size artifacts, not quality differences**
— the 90B MCV estimator subtracts a confidence penalty that shrinks with √N, which is why
smaller samples score lower. The value of this table is catching a *broken* source (none were):

| Source | Sample | Shannon (b/B) | 90B MCV (b/B) | χ² p | Serial corr | Quota spent |
|---|---|---|---|---|---|---|
| `qrandom.io` | 32 KiB | 7.994 | 7.44 | 0.40 | 0.0037 | fair-use |
| `lfdr.de` | 32 KiB | 7.994 | 7.44 | 0.26 | −0.0072 | fair-use |
| `random.org` | 16 KiB | 7.989 | 7.22 | 0.43 | 0.0025 | ~52% of daily bits |
| `superrand` | 8 KiB | 7.972 | 6.91 | 0.01 | −0.0142 | ~1.6% of free allowance |
| `drand` | 8 KiB | 7.980 | 6.91 | 0.89 | 0.0026 | free (256 rounds) |
| `anu` | 8 KiB | 7.976 | 6.88 | 0.18 | 0.0125 | 8 requests |
| `nist-beacon` | 4 KiB | 7.959 | 6.67 | 0.80 | 0.0006 | free (64 pulses) |
| `outshift` | 4 KiB | 7.954 | 6.54 | 0.46 | 0.0010 | ~33% of daily bits |

(`anu-legacy` is skipped by design: at 1 request/minute a meaningful sample would take hours,
and the keyed `anu` endpoint reads the same physical source.)

### In plain English — what do these numbers mean?

Entropy quality = **how hard it is to guess the next byte**. A perfect source gives 8 bits of
surprise per byte; a broken source repeats itself. What each measure tells you:

| Measure | Good | Bad | In simple words |
|---|---|---|---|
| Shannon (b/B) | close to 8 | low | how much *surprise* each byte carries on average |
| 90B MCV (b/B) | close to 8 | low | how hard the *best possible guesser* finds the next byte — the strictest measure |
| 90B Markov (b/bit) | close to 1 | low | does the next bit depend on the previous one? low = it has "memory" |
| χ² p | 0.01 – 0.99 | ≈ 0 | are all 256 byte values used equally often? p ≈ 0 = suspiciously uneven |
| Serial corr | ≈ 0 | far from 0 | does one byte predict the next? |
| Runs z | between −3 and 3 | large | are there too many (or too few) streaks of same bits? |
| gzip | ≈ 1.0 | low | randomness cannot be compressed — if zip makes it smaller, it has patterns |

**Simple quality ranking of your real (raw) sources:**

| Rank | Source | Grade | In simple words |
|---|---|---|---|
| 🥇 | `esp32` raw | **excellent** | almost perfect randomness at high speed — the best real source you own. Tiny patterns exist, so we still clean it up by default |
| 🥇 | `camera` raw | **excellent** | real physical noise, ~7 of 8 bits are genuinely unguessable — and we only "count" 1 of them, a 7× safety margin |
| 🥈 | `microphone` raw | **excellent** | surprisingly clean noise from the mic; also runs with a big safety margin |
| 🥉 | `jitter` raw | **weak** | full of patterns (you can zip it to 10%!) — only safe because we squeeze 32 raw bytes into every 1 output byte |
| — | `crypto` | perfect but *fake* | flawless numbers, but from math, not physics — a very good magician, not nature |
| — | all cloud sources | pass | cleaned up (whitened) before they reach you, so tests cannot tell them apart — choose them by *trust and physics class*, not by these numbers |

Machine-readable version of all results: [`docs/quality.json`](docs/quality.json)
(regenerated on every `bun run quality`).

### Noise bitmaps

Raw bytes rendered as 256×256 grayscale (`docs/noise/`) — human eyes are ruthless pattern
detectors. The ESP32 is clean white noise; jitter shows its timer-quantization banding:

| `esp32` raw | `camera` raw | `jitter` raw | `crypto` |
|---|---|---|---|
| ![esp32 raw noise](docs/noise/esp32-raw.png) | ![camera raw noise](docs/noise/camera-raw.png) | ![jitter raw noise](docs/noise/jitter-raw.png) | ![crypto noise](docs/noise/crypto.png) |

### Sustained streaming (steady state)

`bun scripts/stream-bench.ts` measures `stream()` throughput after the first chunk — i.e.
without session setup, permissions or warmup:

| Source | Steady-state rate | Notes |
|---|---|---|
| `esp32` raw | 68.8 KiB/s | wire-speed passthrough |
| `esp32` conditioned | 29.7 KiB/s | SHA-256, 2× credit |
| `jitter` conditioned | 8.6 KiB/s | |
| `camera` conditioned | 0.28 KiB/s | 15× the single-call figure — warmup dominates small reads |
| `superrand` WebSocket | 0.09 KiB/s | round-trip bound (one 32 B request in flight) |
| `drand` beacon | 0.01 KiB/s | by design: one public 32 B round every 3 s |

### Honest labels

- `jitterEntropy()` in the browser requires `allowCoarseClock: true` and is named
  `jitter(coarse)`: real but **unquantified** entropy — only ever mix it via `xorMix`,
  never use it alone. The Node variant (nanosecond `hrtime`) is credited very
  conservatively at 1/16 bit per timing delta.
- Camera/mic quality varies wildly with device DSP (auto-exposure, noise suppression);
  the health tests are the guard, and cheap sensors are often *better* entropy sources.

## Combining strategies

Strategies implement the same `EntropyProvider` interface, so they nest arbitrarily.

```ts
import { anu, cryptoProvider, drand, fallback, race, randomOrg, xorMix } from '@mindpeeker/entropy'

// Priority order, first success wins:
fallback([anu({ apiKey }), randomOrg({ apiKey }), cryptoProvider()])

// Defense in depth: XOR of independent sources is as strong as the STRONGEST one.
// Fails closed — if any member fails, the call fails (wrap in fallback to degrade).
xorMix([anu({ apiKey }), cryptoProvider()])

// Latency-critical: all providers start, fastest response wins, losers are aborted.
race([anu({ apiKey }), randomOrg({ apiKey })])

// Composition: auditable-but-private, and never fails:
fallback([xorMix([drand(), cryptoProvider()]), cryptoProvider()])
```

**XOR privacy rule**: mixing a *public* beacon with at least one *independent private* source
yields a **private** result (`xorMix` reports `privacy: 'private'` if any member is private) —
the beacon adds public auditability without exposing the output. The independence of the
sources is your assumption to keep: don't feed the same upstream in twice.

`fallback` and `race` report the *pessimistic* privacy (public if any member is public),
because you can't know statically which member will serve.

## Streaming

Every provider has a lazy, pull-based `stream()` (`AsyncIterable<Uint8Array>`):

```ts
for await (const chunk of drand().stream()) {
  // one 32-byte value per new drand round (every ~3 s), deduplicated
}

// SuperRand streams over its WebSocket API with tagged in-flight requests,
// transparent reconnects (3 attempts, exponential backoff) and clean teardown:
for await (const chunk of superRand({ apiKey }).stream({ chunkBytes: 64 })) { /* … */ }
```

Default streams poll `getBytes` per pull, so provider rate limits are honored automatically
(`anuLegacy().stream()` naturally emits at most one chunk per minute). Stop a stream with
`break` / `return()` or an `AbortSignal`.

## Errors

Everything throws `EntropyError` with a `code`:
`rate_limited` (with `retryAfterMs` when known) · `auth` · `network` · `bad_response` ·
`insufficient_entropy` · `timeout` · `aborted` · `invalid_request` · `health_test`
(a local source failed its continuous NIST health tests).

When a strategy exhausts all members, you get `insufficient_entropy` whose `cause` is an
`AggregateError` holding each member's error in attempt order.

```ts
try {
  await provider.getBytes(64, { timeoutMs: 5000, signal })
} catch (error) {
  if (error instanceof EntropyError && error.code === 'rate_limited') {
    console.log(`retry in ${error.retryAfterMs}ms`)
  }
}
```

## Custom providers

```ts
import { defineProvider } from '@mindpeeker/entropy'

const myQrng = defineProvider({
  name: 'my-hardware',
  kind: 'qrng',
  privacy: 'private',
  async getBytes(n, { signal } = {}) {
    const bytes = await readFromMyDevice(n, signal)
    return { bytes, sources: [{ name: 'my-hardware', kind: 'qrng', privacy: 'private' }] }
  },
})
```

`defineProvider` gives you length validation, abort handling, whole-call timeouts and a
default poll-based `stream()` for free.

## Browser caveats

- **API keys in browser code are public.** For keyed providers, proxy server-side and point
  the provider at your proxy via `baseUrl` — or use only keyless providers client-side.
- CORS support is unverified for several keyless services (lfdr, qrandom.io); if a provider
  is blocked by CORS in the browser, route it through a small proxy.
- Node 20 has no global `WebSocket` (Node ≥ 21 does): pass `superRand({ WebSocketCtor })`,
  e.g. from the `ws` package.

## Verifying against live APIs

Mocked tests are authoritative for CI. To exercise real endpoints:

```sh
LIVE=1 bun test live                      # keyless providers
LIVE=1 ANU_API_KEY=… RANDOM_ORG_API_KEY=… bun test live   # + keyed ones
```

Instead of exporting keys inline, copy the workspace's `.env.example` to `.env` (git-ignored)
and fill in what you have — Bun loads it automatically, and each keyed provider's live test
runs only when its variable is set.

The live suite loads the nearest `.env` itself (walking up from the test file), so it works
from the workspace root and from inside `packages/entropy` alike.

## License

MIT
