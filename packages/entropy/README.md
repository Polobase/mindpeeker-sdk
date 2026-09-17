# @mindpeeker/entropy

Provider-pluggable **quantum (QRNG)** and **true (TRNG)** randomness for web and Node.js.

Thirty entropy backends (29 in `/providers`, plus `hwRng` in `/node`; the count is asserted
against the code by a test) behind one tiny interface, with composable combining strategies
(fallback chains, XOR mixing, racing), request/response *and* streaming access, and honest
source attribution — every result tells you where its bytes actually came from, and beacon
results name the exact rounds they used.

- **Runtime-agnostic**: standard `fetch`, `WebSocket`, `globalThis.crypto` only. Zero dependencies. ESM. Node ≥ 20.19 (the first 20.x with unflagged `require(esm)`) and evergreen browsers.
- **Exactly-n-or-throw**: `getBytes(n)` always resolves with exactly `n` bytes or throws a typed `EntropyError` — per-request caps and chunking are each provider's internal concern, and `defineProvider` verifies the byte count of every result (`bad_response` otherwise).
- **Honest metadata**: providers are classified by `kind` (`qrng` / `trng` / `beacon` / `csprng`, and `mixed` for composites whose members differ) and `privacy` (`private` / `public`) so you can't accidentally seed a secret from a public beacon.

```sh
npm install @mindpeeker/entropy    # or bun add @mindpeeker/entropy
```

Three entry points:

| Import | Contents |
|---|---|
| `@mindpeeker/entropy` | the core: types, `EntropyError`, strategies (`fallback`/`xorMix`/`race`), `defineProvider` |
| `@mindpeeker/entropy/providers` | **all providers** (cloud, beacons, local sensors/hardware) |
| `@mindpeeker/entropy/node` | Node-only adapters (`nodeSerialSource`, ffmpeg, `hwRng`, `rtlSdrSource`) — browser bundlers cannot resolve this on purpose |

## Quick start

```ts
import { fallback } from '@mindpeeker/entropy'
import { anuLegacy, cryptoProvider } from '@mindpeeker/entropy/providers'

// The classic: try quantum first, fall back to the local CSPRNG — and know which one served.
const entropy = fallback([anuLegacy(), cryptoProvider()])

const { bytes, sources } = await entropy.getBytes(32)
console.log(sources.map((s) => s.name)) // ['anu-legacy'] … or ['crypto'] if ANU was down
```

## Providers

| Factory | Source | Kind | Privacy | Auth | Notes |
|---|---|---|---|---|---|
| `cryptoProvider()` | runtime CSPRNG | csprng | private | — | always available; last link of every good fallback chain |
| `drbgProvider({ seed })` | SP 800-90A HMAC_DRBG (SHA-256) | csprng | private | — | **deterministic**: seeded control runs and exact replay; named `hmac-drbg(seed:…)` |
| `anu({ apiKey })` | ANU quantum vacuum | qrng | private | `x-api-key` (AWS Marketplace) | ≤1024 numbers/request (chunked automatically) |
| `anuLegacy()` | ANU quantum vacuum | qrng | private | none | **1 request/minute** (client-side gate built in); retirement announced |
| `qrandomIo()` | IDQ Quantis photonics | qrng | private | none | free; Falcon-512-signed responses (not verified in v1) |
| `lfdr()` | IDQ Quantis PCIe | qrng | private | none | hobby-grade lab service, no SLA |
| `outshift({ apiKey })` | Cisco photonic QRNG | qrng | private | `x-id-api-key` (free signup) | 100k bits/day free tier; decimals parsed strictly |
| `qci({ apiToken })` | QCi photonic uQRNG | qrng | private | OAuth2 token exchange | bearer token cached; auto re-auth on 401; one shared exchange that a single caller's abort cannot cancel |
| `randomOrg({ apiKey })` | atmospheric radio noise | trng | private | JSON-RPC apiKey | honors `advisoryDelay`; Developer tier: ≤ 1,000 requests/day, ≤ 10 requests/s (no bit allowance published — the server's `bitsLeft` is authoritative) |
| `superRand({ apiKey })` | EM background noise | trng | private | key in query (masked in errors) | **WebSocket streaming**; ≤256 values/request; wire format live-verified |
| `drand()` | League of Entropy (threshold BLS) | beacon | **public** | none | 3 s rounds, 32 B each; mirror failover; `getRound`, round arithmetic, `verify: 'structural'` |
| `nistBeacon()` | NIST full-entropy source | beacon | **public** | none | 512 bits/min; NIST IR 8213 *draft* format, NIST-labelled beta service; `verify`; NIST: *never use as secret keys* |
| `nqsn()` | NQSN Singapore quantum beacon | beacon | **public** | none | IR 8213 format, 60 s pulses; `verify: true` works end to end |
| `uchile()` | Random UChile hybrid beacon | beacon | **public** | none | quantum device + seismic/radio mixers, 60 s; cipherSuite 1 → unverifiable here |
| `inmetro()` | Inmetro Brazil beacon | beacon | **public** | none | `variant: 'combination'` = 10-min multi-beacon VDF mix; `verify: 'hash'` |
| `curby()` | CURBy (CU Boulder + NIST) | beacon | **public** | none | Twine chain, 64-byte sha3-512 CID digests, freshness guard built in |
| `padova()` | Univ. of Padova QRNG (VSIX) | qrng | private | none | keyless PRIVATE quantum draws — the simplest QRNG API alive |
| `qbck({apiKey})` | Quantum Blockchains aggregator (IDQ/qStream/SeQRNG/Tropos) | qrng | private | email-registration key | response parse marked VERIFY-WITH-KEY |
| `randao()` | Ethereum RANDAO | beacon | **public** | none | final mixes of completed epochs (one per 6.4 min); proposer-biasable ~1 bit — see caveats |
| `bitcoinBeacon()` | Bitcoin block hashes | beacon | **public** | none | ~10 min cadence; miner-grindable at high cost |
| `solanaBeacon()` | Solana blockhashes | beacon | **public** | none | ~400 ms slots; leader-influenced |
| `tezosBeacon()` | Tezos block hashes | beacon | **public** | none | via the TzKT indexer (extra third-party trust); `getRound(level)` |
| `flowBeacon()` | Flow protocol randomness | beacon | **public** | none | 8 B per script execution |
| `cameraEntropy()` | camera sensor noise (shot/thermal) | trng | private | camera permission | frame-diff sign bits (AetherOnePi-style); browser or injected frames |
| `micEntropy()` | microphone ADC noise | trng | private | mic permission | sample LSBs; browser or injected PCM |
| `serialEntropy({...})` | ESP32 / TrueRNG / OneRNG over serial | trng | private | — | Web Serial `port` or any injected byte `source`; `truerng`/`onerng` mode presets |
| `sensorEntropy()` | phone/tablet motion sensors | trng | private | motion permission | quantized readings → tiny credit; breadth source |
| `sdrEntropy({source})` | RTL-SDR radio noise | trng | private | — | community-verified tier; `rtlSdrSource` from `/node` |
| `jitterEntropy()` | CPU timing jitter | trng | private | — | Node `hrtime` (credited 1/16 bit/delta, start-up timer self-test); browser only via `allowCoarseClock` |
| `hwRng()` (from `/node`) | kernel `/dev/hwrng` | trng | private | device permissions | Linux/Raspberry Pi hardware RNG, ChaosKey |

All network providers accept `fetch` (dependency injection / proxying) and either `baseUrl` (one
URL, e.g. a server-side proxy) or `baseUrls` (mirrors tried in order when a request fails with
anything but an abort or `invalid_request`; must be non-empty). Passing both, an empty list or an
empty entry throws `invalid_request` at construction; `solanaBeacon`'s old `url` option is a
deprecated alias of `baseUrl`. API keys never appear in error messages: URLs are quoted without
their query string, UUID-shaped path segments and every configured key are masked (the `cause`
still holds the raw transport error).

## Randomness classes — what you're actually getting

"Random" hides four very different claims. Every provider's class, physical process and the
actual basis of its unpredictability:

| Source | Class | Physical process | Why it's unpredictable |
|---|---|---|---|
| `cryptoProvider` | **CSPRNG** (deterministic) | none — an algorithm seeded from OS entropy | computational hardness only; predictable to anyone holding the state |
| `drbgProvider` | **DRBG** (deterministic, *your* seed) | none — HMAC_DRBG over the seed you pass | none beyond the seed: anyone holding the seed reproduces every byte — a control, not a secret |
| `anu`, `anuLegacy` | **Quantum** (QRNG) | vacuum fluctuations of the electromagnetic field | quantum measurement — non-deterministic by the laws of physics |
| `qrandomIo`, `lfdr` | **Quantum** (QRNG) | photon detection (ID Quantique Quantis) | quantum shot noise |
| `outshift`, `qci`, `padova` | **Quantum** (QRNG) | photonic hardware (Cisco / QCi / Univ. Padova) | quantum optics |
| `qbck` | **Quantum** (QRNG) | aggregated IDQ/qStream/SeQRNG/Tropos hardware | quantum optics, multi-vendor |
| `cameraEntropy` | **Hybrid** quantum + classical | photon shot noise (lit scene — quantum) and sensor thermal noise (covered lens — classical) | photon-arrival statistics / Johnson noise |
| `randomOrg` | **Classical TRNG** | atmospheric radio noise | chaotic macroscopic physics — deterministic in principle, unmeasurable in practice |
| `superRand` | **Classical TRNG** | electromagnetic background noise | chaotic macroscopic physics |
| `serialEntropy` (ESP32) | **Classical TRNG** | SAR-ADC thermal/RF noise (`bootloader_random`) | thermal noise |
| `micEntropy` | **Classical TRNG** | microphone ADC / Johnson noise | thermal noise |
| `sensorEntropy` | **Classical TRNG** | accelerometer/gyroscope MEMS noise | thermal/mechanical noise (heavily quantized in browsers) |
| `sdrEntropy` | **Classical TRNG** | radio front-end thermal noise (RTL-SDR) | thermal noise; RF-injectable — mixing tier |
| `hwRng` | varies | whatever the kernel's `/dev/hwrng` driver trusts | device-dependent |
| `jitterEntropy` | **Software/physical hybrid** | CPU micro-architectural timing chaos | system state too complex to model — weakest physical claim |
| `drand` | **Cryptographic beacon** | none per round — threshold BLS signatures | cryptography + distributed trust; **PUBLIC** values |
| `nistBeacon`, `nqsn`, `uchile`, `inmetro`, `curby` | **TRNG/QRNG-backed beacons** | operator-run physical sources | operator trust; **PUBLIC** values |
| `randao`, `bitcoinBeacon`, `solanaBeacon`, `tezosBeacon`, `flowBeacon` | **Chain beacons** | none — consensus artifacts | economic cost of bias; **PUBLIC** and participant-influenceable |

Rules of thumb: only the quantum sources are non-deterministic *in principle*; classical TRNGs
are practically unpredictable but not fundamentally so; a CSPRNG is pure math; beacons are not
private entropy at all — they are shared, verifiable randomness.

### Chain-beacon caveats (read before using `randao`/`bitcoinBeacon`/…)

Blockchain values are **public and participant-influenceable**: an Ethereum proposer can bias
RANDAO by roughly one bit per slot by withholding a block (and more with forking strategies —
eprint 2025/037); Bitcoin miners can discard unfavourable blocks, though at a cost estimated in
six figures per bit (Bonneau et al., eprint 2015/1015); Solana values pass through the slot
leader, and `tezosBeacon` additionally trusts the TzKT indexer. Use them for commitments,
audits and `xorMix` transparency inputs. For well-engineered public randomness with distributed
trust, prefer `drand`.

## Beacon rounds, history and verification

Public beacons are only useful when a result can be traced to a round anyone can look up. Every
beacon result lists the rounds it used — `sources[0].rounds`, in byte order, each
`{ round, chain?, timestamp?, signature? }` — and the beacons with historical access expose
`getRound(n)`, returning that round's full value:

```ts
import { DRAND_CHAINS, drand, drandRoundAt, drandRoundTime } from '@mindpeeker/entropy/providers'

const beacon = drand()
const { bytes, sources } = await beacon.getBytes(64) // two 32-byte rounds
const [newest] = sources[0]?.rounds ?? []            // { round, timestamp, signature }

// Anyone can fetch the same round again and compare:
const replay = await beacon.getRound(newest?.round ?? 1)

// drand's round clock (the drand client's roundAt / roundTime formulas):
const round = drandRoundAt(Date.parse('2026-09-17T12:24:54Z'), DRAND_CHAINS.quicknet) // 32281510
drandRoundTime(round, DRAND_CHAINS.quicknet) // 1789647894000
```

Every historical fetch checks that the server answered the round that was asked for — a caching
proxy serving the latest pulse for every path fails with `bad_response` instead of silently
repeating bytes. NIST-family walks cross chain boundaries (`/chain/{c−1}/pulse/last`), and their
streams dedupe on `(chainIndex, pulseIndex)`, so a chain restart no longer stalls a stream.
Within one round period `getBytes` returns the same public bytes again — compare the `rounds`.

Opt-in verification throws `EntropyError('verification')` when a check fails:

```ts
import { drand, nistBeacon, nqsn } from '@mindpeeker/entropy/providers'

const audited = nqsn({ verify: true })         // output hash + certificate + signature + linkage
const linked = nistBeacon({ verify: 'hash' })  // output hash + linkage (see the NIST row below)
const pinned = drand({ verify: 'structural' }) // chain info, signature length, round clock
```

### What is verified, per beacon

| Provider | `rounds` metadata | `getRound(n)` | Historical fetch must match | `verify` | What a passing check establishes |
|---|---|---|---|---|---|
| `drand` | round, timestamp (known chains), signature | round | round | `'structural'` | the mirror serves the pinned chain (hash, genesis, period, scheme); signature length fits the scheme; the round is not from the future (local clock); a served `randomness` equals SHA-256(signature). The BLS signature itself is **not** verified (needs a pairing library) |
| `nistBeacon` | chain, pulse, timestamp, signature | pulse (+ `chain`) | chain and pulse | `true` / `'hash'` | `'hash'`: outputValue = SHA-512(fields ‖ signature) and chain linkage of consecutive pulses (previous value, precommitment). `true` adds certificateId = SHA-512(certificate) and the RSA PKCS#1 v1.5/SHA-512 signature (WebCrypto). **Live 2026-09-17: every NIST pulse since 2/1925734 (2026-09-03T21:08Z) carries a 512-byte signature but names a 2048-bit certificate, so `verify: true` fails with `verification`; `'hash'` passes** |
| `nqsn` | same | same | same | `true` / `'hash'` | as above; all checks pass live (NQSN hashes the PEM text for its certificateId, NIST the DER — both accepted) |
| `inmetro` | same | same | same (`combination`: one chain) | `true` / `'hash'` | `'hash'` passes live (Inmetro length-prefixes the signature in the output hash, as the IR 8213 draft says); its certificate route answered HTTP 400, so `true` currently fails with `network` |
| `uchile` | same | same | same | — | nothing: UChile publishes cipherSuite 1, which is not verifiable here |
| `curby` | pulse index, timestamp, JWS signature | index | index and chain CID | — | digest length matches the multihash code; freshness guard. The JWS is **not** verified, and the CID digest (a sha3-512 hash of the signed block) is this library's choice of pulse value, not a confirmed CURBy definition |
| `tezosBeacon` | level, timestamp | level | level | — | base58check checksum of the block hash (TzKT indexer trusted) |
| `randao` | epoch | completed epoch | — (the API names no epoch) | — | nothing beyond shape |
| `solanaBeacon` | slot | — | — | — | nothing beyond shape |
| `bitcoinBeacon` | — (the tip route names no height) | — | block id | — | nothing beyond shape (no proof-of-work check) |
| `flowBeacon` | — | — | — | — | the UInt64 is a decimal in [0, 2⁶⁴ − 1] |

Limits of verification: a NIST-family signature is bound to the certificate the beacon itself
names — no X.509 chain, validity or revocation checking — so it proves integrity relative to the
operator, not unpredictability. The serialization is pinned by checked-in live pulses of NIST,
NQSN and Inmetro, because the deployed layout differs from the IR 8213 draft (uint32 length
prefixes and `external.statusCode`, where the draft prints uint64). NIST IR 8213 is still an
initial public draft (NIST planning note 2025-01-23) and NIST calls the 2.0 service a beta; its
current chain 2 started 2022-09-21, and the beacon published nothing between pulse 2/1525305
(2025-10-01T14:08Z) and 2/1525306 (2025-11-13T14:00Z, status "gap").

## Local physical entropy

The seven local providers — `cameraEntropy`, `micEntropy`, `serialEntropy`, `sensorEntropy`,
`sdrEntropy`, `jitterEntropy` and `hwRng` — share one pipeline: raw physical samples →
**NIST SP 800-90B health tests** (a start-up test, then continuous Repetition Count + Adaptive
Proportion tests, always on) → **SHA-256 extraction** with a conservative per-source entropy
credit — or, with `conditioning: 'raw'`, a health-tested passthrough of the unwhitened physical
bits (the provider then reports itself as `name(raw)` in attribution, so results are always
traceable). A source that keeps failing throws `EntropyError('health_test')` — it never silently
degrades to pseudo-randomness. A source that produces *no* samples (a frozen camera scene, a
silent radio) starves instead and ends in `timeout`.

```ts
import { xorMix } from '@mindpeeker/entropy'
import { cameraEntropy, cryptoProvider, serialEntropy } from '@mindpeeker/entropy/providers'

// Browser webcam, whitened:
const cam = cameraEntropy() // getUserMedia; cover the lens for pure thermal noise

// Raw hotbits for oracle/radionics workflows — unwhitened frame-diff sign bits:
const rawCam = cameraEntropy({ conditioning: 'raw' })

// Defense in depth stays available:
const belt = xorMix([cam, cryptoProvider()])
```

### Conditioning and health options

Every local provider accepts the same `ConditioningOptions`, validated at construction
(`EntropyError('invalid_request')` for anything out of range):

| Option | Default | Meaning |
|---|---|---|
| `conditioning` | `'conditioned'` | `'raw'` passes health-tested samples through unwhitened |
| `minEntropyPerSample` | per provider | credited min-entropy in bits per raw byte: finite, **0 < H ≤ 8** |
| `safetyFactor` | per provider | pool `safetyFactor × 256` credited bits per 32-byte block: finite, **≥ 1** (≥ 1.25 carries the SP 800-90C full-entropy margin) |
| `onHealthFailure` | `'retest'` | `'throw'` fails at the first alarm; `'retest'` applies restart semantics (below) |
| `maxHealthFailures` | `3` | alarms tolerated per session under `'retest'`; the alarm that reaches this count throws |

**How the health tests behave** (SP 800-90B §4.3–4.4):

- **Start-up test.** No sample of a session is released before 1024 consecutive raw samples
  have passed the RCT and APT. A session is one `getBytes` call or one `stream()` iterator, so a
  small raw read still reads at least 1024 raw samples (plus warm-up) first.
- **Continuous tests.** The RCT cutoff is $1 + \lceil 20/H \rceil$ and the APT cutoff the exact
  binomial critical value for a 512-sample window, both at the recommended false-positive
  probability **α = 2⁻²⁰ per sample** (per test) when the source really delivers the credited H.
  The APT cutoff is computed exactly in log space, so it stays active at low credits (509 of 512
  at jitter's 1/16 bit; it can only be W + 1 when H < 20/W).
- **Restart on alarm (`'retest'`).** The chunk that raised the alarm, any held start-up samples
  and the conditioning pool are discarded, the tests restart, and a fresh 1024-sample start-up test
  must pass before output resumes. In raw mode, chunks released before the alarm were already
  delivered.
- **Health H never looser than the credit.** Tests run at max(credited H, the provider's stricter
  health H) — raising `minEntropyPerSample` tightens the tests with it.

**Expected false alarms.** A perfectly uniform byte source credited at 7 or 8 b/B (serial,
`hwRng`) has an RCT cutoff of 4, i.e. one false alarm per 2²⁴ samples: **1/16 alarm per MiB of
raw samples** (6.1 % of 1 MiB reads see one; APT false alarms are negligible there). With the
default of 3 alarms per session, a 1 MiB read fails with probability ≈ 4·10⁻⁵ and a 4 MB read
≈ 0.19 % (it was 6 % and 21 % when the first alarm was fatal). A raw ESP32 stream at ~69 KiB/s
sees an alarm about every 4 minutes on average, so an unbroken session reaches its third after
~12 minutes: for unattended long-running streams raise `maxHealthFailures` (e.g. 1000) or reopen
the stream on `health_test`. At the worst case allowed by the spec (true min-entropy exactly
equal to the credit) each test may alarm up to once per 2²⁰ samples.

### Serial hardware in the BROWSER (Web Serial)

The `serialEntropy` provider works in Chromium (89+, Android 148) and Firefox (151+) today —
no adapter needed, just a user gesture on an HTTPS page:

```ts
const port = await navigator.serial.requestPort() // user picks the ESP32/TrueRNG
const hw = serialEntropy({ port, name: 'esp32' })
```

### More boards: the firmware collection

[`firmware/`](firmware/) ships ready-to-flash sketches speaking the same raw-serial contract:
**Raspberry Pi Pico 2** (⭐ $5, real TRNG), **STM32F405/407** (⭐ best quality — but beware:
F401/F411 "Black Pill" and F446 have NO RNG peripheral), nRF52840, Arduino+avalanche-diode
(DIY tier, parts list included) and ESP8266 (compat-only). See `firmware/README.md` for the
full comparison table.

### Motion sensors (phones/tablets)

```ts
import { sensorEntropy } from '@mindpeeker/entropy/providers'
const motion = sensorEntropy() // Generic Sensor API, DeviceMotion fallback (iOS asks permission)
```

Browsers quantize readings (0.1 m/s² / 0.1 °/s), so the credited entropy is deliberately tiny:
0.25 bit per axis byte — 0.75 bits per 3-axis Generic Sensor event (each event contributes only
the axes of the sensor that fired) and 1.5 bits per 6-axis DeviceMotion event; a 32-byte block
takes several seconds even in motion. The tests run at a stricter 1 b/B, so a frozen device trips
them instead of producing fake entropy. An iOS permission refusal throws
`EntropyError('permission')` at once. Breadth source — mix it, don't rely on it.

### RTL-SDR radio noise (community-verified tier)

```ts
import { sdrEntropy } from '@mindpeeker/entropy/providers'
import { rtlSdrSource } from '@mindpeeker/entropy/node'

const radio = sdrEntropy({ source: await rtlSdrSource() }) // 70 MHz, max manual gain
```

Follows the rtl-entropy pipeline (6 LSBs per IQ sample, von Neumann, health tests on raw).
Needs the `rtl_sdr` CLI + a ~$35–45 dongle; **RTL-SDR Blog V4 requires the rtlsdrblog driver
fork** — stock drivers silently corrupt V4 output, which the raw health tests are there to
catch. RF injection attacks on TRNGs are demonstrated in the literature: treat radio noise as
a mixing source, never a sole root of trust. This provider is community-verified (built from
documented behavior, no hardware on the author's desk).

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

TrueRNG v3 works the same way (plain CDC read). For devices whose documented modes are selected
over the port there are Web Serial presets (built from the vendor documentation, not yet run on
the hardware by the authors):

```ts
import { onerng, TRUERNG_MODES, truerng } from '@mindpeeker/entropy/providers'

// TrueRNGpro: modes are chosen by a baud-rate knock (110 → 300 → 110, then the mode's rate),
// and the device streams while DTR is set (ubld.it "How-To Change TrueRNGpro's Mode").
const pro = truerng({ port: await navigator.serial.requestPort(), mode: 'rng1' })
TRUERNG_MODES.rawBinary // { baudRate: 19200, output: 'packets', … } — framed, not a byte stream

// OneRNG: the feed is OFF at power-up. The preset writes the mode command (cmd0…cmd7), cmdw
// (flush) and cmdO (feed on) after opening, and cmdo (feed off) before closing
// (Moonbase Otago "OneRNG — Theory of operation"). Raw modes are credited 4 b/B by default.
const one = onerng({ port: await navigator.serial.requestPort(), mode: 'avalancheRaw' })
```

`truerng` accepts only the byte-stream modes (`normal`, `rng1`, `rng2`); the ASCII and packet
modes in `TRUERNG_MODES` need their own parser. On a host tty (not Web Serial) turn local echo off
before talking to a OneRNG, or it can read its own output back as commands. `nodeSerialSource` opens the tty with
`O_RDONLY | O_NOCTTY` (an unplug never SIGHUPs a daemon), configures raw 8N1 with `clocal` and
no hardware flow control via `stty`, and reports open/read failures as
`EntropyError('network')` with the original error as `cause`.

### Node camera & microphone

Node has no `getUserMedia`; inject frames/PCM — the built-in adapters spawn `ffmpeg`
(must be installed; FFmpeg 4.x–8.x — the adapters use `-vsync passthrough` and `-nostdin`)
with zero npm dependencies. The capture child is SIGKILLed the moment a call times out or is
aborted, even while ffmpeg produces no output (e.g. a pending macOS camera-permission prompt):

```ts
import { ffmpegFrameSource, ffmpegSampleSource, hwRng } from '@mindpeeker/entropy/node'
import { cameraEntropy, micEntropy } from '@mindpeeker/entropy/providers'

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
| 7 | `random.org` | trng | https | 64 B | 196 ms | ~330 B/s | ≤ 1,000 requests/day (Developer tier) |
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
  conservatively at 1/16 bit per timing delta, and every session first runs
  `jitterStartupTest` — a port of jitterentropy's power-up checks (clock monotonic, not
  coarse, not stuck, varying) — refusing with `health_test` on a VM-style coarse clock.
- Camera/mic quality varies wildly with device DSP (auto-exposure, noise suppression);
  the health tests are the guard, and cheap sensors are often *better* entropy sources.

## Deterministic control runs: `drbgProvider`

Psi and negentropy protocols compare physical sources against a matched *pseudo*-random control
that replays byte-exactly. `drbgProvider` is NIST SP 800-90A HMAC_DRBG (SHA-256) over WebCrypto,
tested against the NIST CAVP vectors:

```ts
import { drbgProvider } from '@mindpeeker/entropy/providers'

const seed = crypto.getRandomValues(new Uint8Array(48)) // record it with the experiment
const control = drbgProvider({ seed, personalization: 'session-42' })
control.name // 'hmac-drbg(seed:1a2b3c4d)' — first 4 bytes of SHA-256(seed)

// Replay: a NEW provider from the same seed, the same sequence of request sizes.
for await (const chunk of drbgProvider({ seed, personalization: 'session-42' }).stream({ chunkBytes: 32 })) {
  /* identical chunks */
}
```

One provider is one DRBG instance: `getBytes` calls and stream pulls advance the same state in
call order, and each request performs ⌈n / 65 536⌉ SP 800-90A generate calls — so the bytes
depend on the seed *and* on the sequence of request sizes. There is no reseeding. Anyone holding
the seed reproduces every output: a recorded seed must never protect a secret.

## Combining strategies

Strategies implement the same `EntropyProvider` interface, so they nest arbitrarily.

```ts
import { fallback, race, xorMix } from '@mindpeeker/entropy'
import { anu, cryptoProvider, drand, randomOrg } from '@mindpeeker/entropy/providers'

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
sources is your assumption to keep: don't feed the same upstream in twice. `xorMix` catches the
blatant case — two members returning byte-identical results (which would XOR to zeros) fail
with `bad_response` for requests of 8 bytes or more (below that, independent sources collide
too often to tell).

`fallback` and `race` report the *pessimistic* privacy (public if any member is public),
because you can't know statically which member will serve.

## Streaming

Every provider has a lazy, pull-based `stream()` (`AsyncIterable<Uint8Array>`):

```ts
for await (const chunk of drand().stream()) {
  // at most one 32-byte value per new drand round (polled every ~3 s); a round published
  // between two polls is skipped — use getRound() when you need every round
}

// SuperRand streams over its WebSocket API with one FIFO request in flight, reconnects after
// transport failures (3 attempts, exponential backoff), a connect timeout and clean teardown:
for await (const chunk of superRand({ apiKey }).stream({ chunkBytes: 64 })) { /* … */ }
```

Default streams poll `getBytes` per pull, so provider rate limits are honored automatically
(`anuLegacy().stream()` naturally emits at most one chunk per minute). Stop a stream with
`break` / `return()` or an `AbortSignal`: an abort rejects the pending pull at once with
`aborted` — also while a beacon stream waits between polls, while SuperRand is connecting or
backing off, and while `anuLegacy`/`randomOrg` wait for their rate-limit slot (a cancelled
request gives its slot back).

Beacon streams poll `fetchLatest` every `pollIntervalMs` (default: the beacon's period) and yield
only when the round id advances; `timeoutMs` bounds each poll (an expired poll rejects with
`timeout`), and `chunkBytes` always re-slices the payloads to exactly that size (CURBy's 64-byte
digests used to pass through unchanged for `chunkBytes: 32`).

Stream options are validated on the first pull: `chunkBytes` must be an integer ≥ 1 and
`timeoutMs` finite with 0 < ms ≤ 2³¹ − 1 (`invalid_request`). For streams `timeoutMs` bounds
*each pull*, not the stream's lifetime. Local-provider streams map every failure to the same
taxonomy as `getBytes`: a caller abort rejects the pending pull at once with `aborted` (also
when the source then ends cleanly), a pull over `timeoutMs` releases the hardware and rejects
with `timeout`, and a foreign source failure (a serial `EIO`, say) becomes `network` with the
original as `cause`.

## Errors

Everything throws `EntropyError` with a `code`:
`rate_limited` (with `retryAfterMs` when known: HTTP `Retry-After` as delta-seconds or HTTP-date,
never negative; for RANDOM.ORG's exhausted daily allowance an estimate — the time to the next
00:00 UTC, since the reset time is not documented) · `auth` · `permission` (camera, microphone or
motion-sensor access denied) · `network` · `bad_response` · `insufficient_entropy` · `timeout` ·
`aborted` · `invalid_request` (invalid length, option or configuration — including factory
options, which are validated at construction) · `health_test` (a local source kept failing its
NIST SP 800-90B health tests) · `verification` (a beacon round failed an opt-in `verify` check).

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

`defineProvider` gives you length and `timeoutMs` validation, abort handling, whole-call
timeouts, a check that your implementation returned exactly `n` bytes (`bad_response`
otherwise), wrapping of any non-`EntropyError` failure as `network` (original as `cause`),
stream-option validation and a default poll-based `stream()` for free.

## Browser caveats

- **API keys in browser code are public.** For keyed providers, proxy server-side and point
  the provider at your proxy via `baseUrl` — or use only keyless providers client-side.
- CORS support is unverified for several keyless services (lfdr, qrandom.io); if a provider
  is blocked by CORS in the browser, route it through a small proxy.
- Node < 22 has no global `WebSocket` (Node 21 only behind `--experimental-websocket`; enabled
  by default from Node 22): pass `superRand({ WebSocketCtor })`, e.g. from the `ws` package.
  Without one, the first stream pull fails at once with `invalid_request`.

## Sources we evaluated — and why they're NOT providers

Researched (mid-2026), rejected, and documented so nobody re-litigates them:

| Candidate | Why not |
|---|---|
| Network RTT jitter | attacker-observable and manipulable — RFC 4086 §3.5 says such input "must not be trusted as a source of entropy"; the Linux kernel removed exactly this source (`IRQF_SAMPLE_RANDOM`, gone since 3.6). Mix-don't-credit is the only defensible pattern, so we don't ship it |
| `/proc` interrupt/stat sampling | the kernel sees those events first and better; read-timing is our existing CPU-jitter source in disguise (no independent entropy) |
| Disk seek timing | the classic CRYPTO'94 air-turbulence source died with spinning platters; NVMe latency is engineered for *consistency* |
| macOS `powermetrics` / battery `ioreg` | needs root / high-inertia sensors with ≪1 bit per sample |
| Linux thermal zones | millidegree *units*, 0.5–1 °C actual quantization — near-zero entropy |
| RDRAND/RDSEED from JS | needs a native addon (zero-dep violation); the OS CSPRNG already mixes it |
| BLE heart-rate straps etc. | ~1 Hz and the literature is titled "Heartbeats Do Not Make Good PRNGs" |
| WebGPU races, DRAM (D-RaNGe), SGX | not reachable from JS/Node — speculative research |
| CURBy-Q quantum chain | stalled since 2025-08 (same round for months) — we use the fresh CURBy-RNG chain instead |
| USTC Jinan DIQRNG beacon | expired TLS + data stale since 2025-09 |
| LizaOnAir "QRNG" | an ANU-*seeded PRNG* (its own metadata admits hours-old seeds) |
| Tsotchke "Quantum RNG" | unverifiable marketing claims from a software vendor |
| csrng.net | a CSPRNG service — out of scope |
| beaconcha.in, Aptos/Sui/ICP randomness | now key-gated / not readable over plain HTTP |
| WebUSB RTL-SDR in the browser | possible in principle, stale pre-V4 libraries — documented as experimental only |

## Behaviour changes in 0.2.0

Local providers, health tests and the core contract:

- **Conditioner validation** *(breaking)*: `minEntropyPerSample` must be finite with 0 < H ≤ 8 and
  `safetyFactor` finite ≥ 1, checked at construction. `safetyFactor ≤ 0` or H = ∞ used to make
  every block the constant SHA-256('') (`e3b0c442…b855`); NaN pooled forever; H > 8 over-credited.
- **Exact APT cutoffs**: computed in log space — the linear recurrence underflowed and silently
  disabled the Adaptive Proportion Test for H < ~0.38 at W = 512 (jitter, sensor credits) and
  H < 1 at W = 1024.
- **Start-up test** *(breaking)*: no output before 1024 raw samples of a session have passed the
  health tests, so small reads consume more raw samples (and a persistent injected serial/SDR
  source advances further per `getBytes`).
- **Restart semantics** *(breaking)*: a health alarm no longer kills the call or stream at once;
  by default (`onHealthFailure: 'retest'`) the pending window is discarded and a fresh start-up
  test runs, and only the 3rd alarm of a session (`maxHealthFailures`) throws `health_test`.
  Pass `onHealthFailure: 'throw'` for the old behaviour.
- **Health H = max(credit, provider health H)**: raising `minEntropyPerSample` now tightens the
  health tests instead of leaving them at the provider's lower health H.
- **jitterEntropy**: start-up timer self-test (`health_test` on a coarse, stuck or non-monotonic
  clock); the coarse browser clock is health-tested at 1/16 bit so its APT is active.
- **cameraEntropy**: `stride` must be an integer ≥ 1 (0 hung the process synchronously) and
  `warmupFrames` an integer ≥ 0; `bits: 'lsb'` skips frames whose sampled pixels equal the
  previous frame's instead of crediting duplicates.
- **micEntropy**: Float32 samples are rescaled by 32768 (the exact inverse of int16/32768), so
  e.g. −1.0 maps to −32768 (LSB 0, was 1); browser capture keeps at most `queueLimit` (8)
  buffers, dropping the oldest.
- **sensorEntropy**: Generic Sensor events contribute only the firing sensor's three axes (all six
  were pushed, half of them stale); an iOS permission refusal throws `permission` instead of a
  60 s `timeout`; browser readings are queue-capped like the microphone.
- **Starvation guard**: camera/mic/sensor/SDR sample loops fed by timer-less in-memory sources
  yield a macrotask after 64 product-less iterations, so `timeoutMs` and aborts fire (they hung).
- **Node adapters**: ffmpeg children are SIGKILLed on abort/timeout (they outlived both), use
  `-vsync passthrough` instead of `-fps_mode` (FFmpeg 4.x works again) and `-nostdin`, and keep
  only a bounded stderr tail; `hwRng` honours the signal and reads 256-byte chunks;
  `nodeSerialSource` opens with `O_NOCTTY`, adds `clocal cs8 -parenb -cstopb -crtscts` to `stty`
  and maps open/read errors to `network`.
- **Streams** *(breaking)*: invalid `chunkBytes` (not an integer ≥ 1) or `timeoutMs` reject the
  first pull with `invalid_request` (`chunkBytes: 0` yielded empty chunks forever); local-provider
  streams honour `timeoutMs` per chunk and map aborts/source failures to `aborted`/`network`
  (raw `DOMException`s and Node errors escaped).
- **defineProvider** *(breaking)*: `timeoutMs` must be finite with 0 < ms ≤ 2³¹ − 1 (was a platform
  `TypeError`); a result of the wrong length throws `bad_response`; non-`EntropyError` failures
  become `network` with `cause`; when the caller's signal has aborted, any failure is reported as
  `aborted`.
- **xorMix** *(breaking)*: byte-identical member results (≥ 8 bytes) throw `bad_response`.
- **Factory errors** *(breaking)*: configuration errors of the local providers, strategies and Node
  adapters (`serialEntropy` without exactly one of `port`/`source`, `sdrEntropy` without `source`,
  `fallback([])`, a missing device path, a runtime without camera/mic/sensors/clock, …) throw
  `EntropyError('invalid_request')` instead of `TypeError`.
- **New**: `drbgProvider` (SP 800-90A HMAC_DRBG), the `permission` error code, the
  `onHealthFailure`/`maxHealthFailures` options, `jitterStartupTest`, and `queueLimit` on
  `micEntropy`/`sensorEntropy`.

Online providers and beacons:

- **Factory errors** *(breaking)*: a missing `apiKey`/`apiToken` (anu, outshift, qbck, qci,
  randomOrg, superRand) throws `EntropyError('invalid_request')` instead of `TypeError`; so do an
  empty `baseUrls`, `baseUrl` together with `baseUrls`, and a `pollIntervalMs`, `retryDelayMs`,
  `maxStalenessMs`, `connectTimeoutMs` or `minIntervalMs` outside its range (`pollIntervalMs: 0`
  busy-looped `solanaBeacon`; `baseUrls: []` threw `undefined`).
- **Base URLs**: every network provider accepts `baseUrl` or `baseUrls` (mirror failover);
  `solanaBeacon({ url })` still works as a deprecated alias.
- **Stream errors and aborts**: beacon poll timeouts throw `timeout` (a raw `DOMException`
  escaped); an abort after a yield ends a beacon stream at once (it waited a full poll interval —
  up to 10 minutes); SuperRand honours aborts and a connect timeout while connecting, surfaces
  aborts during backoff as `aborted`, fails a missing WebSocket at once with `invalid_request` (was
  a `TypeError` after 3.5 s of retries) and no longer reconnects after non-transport errors; an
  abort or timeout during a response-body read is reported as `aborted`/`timeout` (was
  `bad_response`, which made `fallback` carry on despite the abort).
- **Chunking** *(breaking)*: beacon streams always re-slice to `chunkBytes` when it is given
  (CURBy's 64-byte sha3-512 digests passed through unsliced for `chunkBytes: 32`).
- **Chain resets**: NIST-family streams dedupe on `(chainIndex, pulseIndex)` (they stalled after a
  chain restart) and `getBytes` walks back across chain boundaries (it threw
  `insufficient_entropy`).
- **Historical integrity** *(breaking)*: a walked-back pulse, round, level, pulse index or block
  that is not the one requested throws `bad_response` (drand, NIST family, CURBy, Tezos, Bitcoin);
  a CURBy block of another chain or with a digest length contradicting its multihash code too.
- **RANDAO** *(breaking)*: results are the final mixes of completed epochs (the in-progress head
  mix used to come first and could repeat the previous epoch's mix at an epoch boundary); the
  stream yields once per completed epoch; a malformed head slot (`null`, `''`) is `bad_response`
  (was `insufficient_entropy`).
- **Stricter parsing** *(breaking)*: Flow's UInt64 must be a decimal in [0, 2⁶⁴ − 1] (negative and
  oversized values wrapped silently), qbck array elements must be hex byte strings (numbers were
  reinterpreted as hex), Outshift decimals must be plain integers (`'12abc'` read as 12).
- **Error codes**: SuperRand error frames and REST error bodies map quota codes to `rate_limited`
  and key codes to `auth` (all were `bad_response`); RANDOM.ORG's 402/403 carry `retryAfterMs`;
  `Retry-After` HTTP-dates are parsed and negative values ignored.
- **Secrets**: error messages no longer quote API keys (SuperRand `?key=`, qbck key-in-path,
  keys echoed in error bodies).
- **QCi**: one caller's abort no longer fails other callers sharing the token exchange with a raw
  `AbortError`; the exchange is cancelled only when every caller has given up.
- **Rate-limit gate**: a request aborted while waiting for its slot gives the slot back.
- **Types**: beacon factories return `BeaconProvider` (an `EntropyProvider` with `getRound`);
  `EntropyResult.sources` is `EntropySourceAttribution[]` (optional `rounds`).
- **New**: round metadata on beacon results, `getRound` on drand, the NIST family, CURBy, Tezos
  and RANDAO, `drandRoundAt`/`drandRoundTime`/`DRAND_CHAINS`, drand `verify: 'structural'`,
  NIST-family `verify: true | 'hash'`, the `verification` error code, `truerng`/`onerng` serial
  presets with `TRUERNG_MODES`/`ONERNG_COMMANDS`.

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
