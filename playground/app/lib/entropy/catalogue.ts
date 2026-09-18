// Every provider factory exported from '@mindpeeker/entropy/providers' and
// '@mindpeeker/entropy/node', transcribed from the package README's provider
// table and its per-beacon verification table.
//
// Data only — no SDK import, so this module is safe anywhere. The live "Try"
// buttons live in ./try.ts (which does import the SDK and is therefore
// client-only).

import type { EntropyKind, EntropyPrivacy } from '@mindpeeker/entropy'

/** Where a factory can actually run, honestly labelled. */
export type Reach =
  | 'in-process' // no I/O at all
  | 'browser' // keyless HTTP, exercised by a Try button on this page
  | 'cors' // keyless HTTP, CORS unverified — may be blocked
  | 'permission' // getUserMedia / motion-sensor permission
  | 'web-serial' // navigator.serial + a user gesture
  | 'proxy' // API key: browser code would publish it — proxy server-side
  | 'node' // Node-only adapter

export const REACH_LABEL: Record<Reach, string> = {
  'in-process': 'in-process — always',
  browser: 'keyless HTTP — try it below (may be CORS-blocked)',
  cors: 'keyless HTTP — may be CORS-blocked',
  permission: 'browser + user permission',
  'web-serial': 'Web Serial (Chromium 89+, Firefox 151+)',
  proxy: 'key → proxy server-side',
  node: 'Node only',
}

export const REACH_TONE: Record<Reach, 'success' | 'info' | 'warning' | 'neutral'> = {
  'in-process': 'success',
  browser: 'info',
  cors: 'warning',
  permission: 'warning',
  'web-serial': 'warning',
  proxy: 'neutral',
  node: 'neutral',
}

/** Coarse grouping used by the filter, finer than `kind`. */
export type CatalogueGroup = 'local' | 'cloud' | 'beacon' | 'chain' | 'synthetic'

export const GROUP_LABEL: Record<CatalogueGroup, string> = {
  synthetic: 'Algorithmic (no physics)',
  local: 'Local physical hardware',
  cloud: 'Cloud QRNG / TRNG services',
  beacon: 'Operator-run public beacons',
  chain: 'Blockchain beacons',
}

export interface CatalogueRow {
  /** The exact factory call, as you would write it. */
  readonly factory: string
  /** Import specifier the factory comes from. */
  readonly from: '@mindpeeker/entropy/providers' | '@mindpeeker/entropy/node'
  readonly source: string
  readonly kind: EntropyKind
  readonly privacy: EntropyPrivacy
  /** Credential needed, or '—'. */
  readonly auth: string
  readonly reach: Reach
  readonly group: CatalogueGroup
  /** What an opt-in `verify` establishes here, per the README's verification table. */
  readonly verify: string
  /** One line of honest small print. */
  readonly note: string
  /** Id understood by `tryProvider()` — only browser-safe, keyless factories. */
  readonly tryId?: TryId
  /** A serial preset rather than one of the 30 counted backends. */
  readonly preset?: boolean
}

export type TryId = 'crypto' | 'jitter' | 'drand' | 'curby' | 'nist' | 'nqsn' | 'uchile'

export const CATALOGUE: readonly CatalogueRow[] = [
  {
    factory: 'cryptoProvider()',
    from: '@mindpeeker/entropy/providers',
    source: 'runtime CSPRNG (crypto.getRandomValues)',
    kind: 'csprng',
    privacy: 'private',
    auth: '—',
    reach: 'in-process',
    group: 'synthetic',
    verify: '—',
    note: 'Always available; the last link of every good fallback chain. Flawless statistics, zero physical unpredictability.',
    tryId: 'crypto',
  },
  {
    factory: 'drbgProvider({ seed })',
    from: '@mindpeeker/entropy/providers',
    source: 'SP 800-90A HMAC_DRBG (SHA-256)',
    kind: 'csprng',
    privacy: 'private',
    auth: '—',
    reach: 'in-process',
    group: 'synthetic',
    verify: 'CAVP vectors (in the package test suite)',
    note: 'Deterministic: the same seed and the same sequence of request sizes replay byte-exactly. A control arm, never a secret.',
  },
  {
    factory: 'anu({ apiKey })',
    from: '@mindpeeker/entropy/providers',
    source: 'ANU quantum vacuum fluctuations',
    kind: 'qrng',
    privacy: 'private',
    auth: 'x-api-key (AWS Marketplace)',
    reach: 'proxy',
    group: 'cloud',
    verify: '—',
    note: '≤ 1024 numbers per request, chunked automatically.',
  },
  {
    factory: 'anuLegacy()',
    from: '@mindpeeker/entropy/providers',
    source: 'ANU quantum vacuum fluctuations',
    kind: 'qrng',
    privacy: 'private',
    auth: '—',
    reach: 'cors',
    group: 'cloud',
    verify: '—',
    note: 'Hard 1 request/minute (client-side gate built in); retirement announced.',
  },
  {
    factory: 'qrandomIo()',
    from: '@mindpeeker/entropy/providers',
    source: 'ID Quantique Quantis photonics',
    kind: 'qrng',
    privacy: 'private',
    auth: '—',
    reach: 'cors',
    group: 'cloud',
    verify: 'Falcon-512-signed responses — not verified in v1',
    note: 'Free and keyless; the README lists its CORS support as unverified.',
  },
  {
    factory: 'lfdr()',
    from: '@mindpeeker/entropy/providers',
    source: 'ID Quantique Quantis PCIe card',
    kind: 'qrng',
    privacy: 'private',
    auth: '—',
    reach: 'cors',
    group: 'cloud',
    verify: '—',
    note: 'Hobby-grade lab service, no SLA. CORS support unverified.',
  },
  {
    factory: 'outshift({ apiKey })',
    from: '@mindpeeker/entropy/providers',
    source: 'Cisco Outshift photonic QRNG',
    kind: 'qrng',
    privacy: 'private',
    auth: 'x-id-api-key (free signup)',
    reach: 'proxy',
    group: 'cloud',
    verify: '—',
    note: '100k bits/day free tier; decimals parsed strictly.',
  },
  {
    factory: 'qci({ apiToken })',
    from: '@mindpeeker/entropy/providers',
    source: 'QCi photonic uQRNG',
    kind: 'qrng',
    privacy: 'private',
    auth: 'OAuth2 token exchange',
    reach: 'proxy',
    group: 'cloud',
    verify: '—',
    note: 'Bearer token cached, auto re-auth on 401; one shared exchange a single caller cannot cancel.',
  },
  {
    factory: 'padova()',
    from: '@mindpeeker/entropy/providers',
    source: 'University of Padova QRNG (VSIX)',
    kind: 'qrng',
    privacy: 'private',
    auth: '—',
    reach: 'cors',
    group: 'cloud',
    verify: '—',
    note: 'Keyless PRIVATE quantum draws — the simplest QRNG API alive.',
  },
  {
    factory: 'qbck({ apiKey })',
    from: '@mindpeeker/entropy/providers',
    source: 'Quantum Blockchains aggregator (IDQ / qStream / SeQRNG / Tropos)',
    kind: 'qrng',
    privacy: 'private',
    auth: 'email-registration key',
    reach: 'proxy',
    group: 'cloud',
    verify: 'response parse marked VERIFY-WITH-KEY',
    note: 'Multi-vendor quantum hardware behind one endpoint.',
  },
  {
    factory: 'randomOrg({ apiKey })',
    from: '@mindpeeker/entropy/providers',
    source: 'atmospheric radio noise (RANDOM.ORG)',
    kind: 'trng',
    privacy: 'private',
    auth: 'JSON-RPC apiKey',
    reach: 'proxy',
    group: 'cloud',
    verify: '—',
    note: 'Honors advisoryDelay; Developer tier ≤ 1,000 requests/day, ≤ 10 requests/s.',
  },
  {
    factory: 'superRand({ apiKey })',
    from: '@mindpeeker/entropy/providers',
    source: 'electromagnetic background noise',
    kind: 'trng',
    privacy: 'private',
    auth: 'key in query (masked in errors)',
    reach: 'proxy',
    group: 'cloud',
    verify: '—',
    note: 'WebSocket streaming, ≤ 256 values per request; wire format live-verified.',
  },
  {
    factory: 'drand()',
    from: '@mindpeeker/entropy/providers',
    source: 'League of Entropy (threshold BLS)',
    kind: 'beacon',
    privacy: 'public',
    auth: '—',
    reach: 'browser',
    group: 'beacon',
    verify: "verify: 'structural' — pinned chain, signature length, round clock, randomness = SHA-256(signature). The BLS signature itself is NOT verified",
    note: '3 s rounds, 32 B each, mirror failover, getRound and round arithmetic. PUBLIC bytes.',
    tryId: 'drand',
  },
  {
    factory: 'nistBeacon()',
    from: '@mindpeeker/entropy/providers',
    source: 'NIST Randomness Beacon 2.0',
    kind: 'beacon',
    privacy: 'public',
    auth: '—',
    reach: 'browser',
    group: 'beacon',
    verify: "verify: 'hash' passes (output hash + chain linkage); verify: true fails live — 512-byte signatures naming a 2048-bit certificate since 2026-09-03",
    note: '512 bits/min, NIST IR 8213 draft format, beta service. NIST: never use as secret keys.',
    tryId: 'nist',
  },
  {
    factory: 'nqsn()',
    from: '@mindpeeker/entropy/providers',
    source: 'NQSN Singapore quantum beacon',
    kind: 'beacon',
    privacy: 'public',
    auth: '—',
    reach: 'browser',
    group: 'beacon',
    verify: 'verify: true works end to end (hash, certificate id, RSA signature, linkage)',
    note: 'IR 8213 format, 60 s pulses, National Quantum-Safe Network. PUBLIC bytes.',
    tryId: 'nqsn',
  },
  {
    factory: 'uchile()',
    from: '@mindpeeker/entropy/providers',
    source: 'Random UChile hybrid beacon',
    kind: 'beacon',
    privacy: 'public',
    auth: '—',
    reach: 'browser',
    group: 'beacon',
    verify: 'nothing — UChile publishes cipherSuite 1, unverifiable here (passing verify throws invalid_request)',
    note: 'Quantum device mixed with seismic and radio inputs, 60 s pulses.',
    tryId: 'uchile',
  },
  {
    factory: 'inmetro()',
    from: '@mindpeeker/entropy/providers',
    source: 'Inmetro Brazil beacon',
    kind: 'beacon',
    privacy: 'public',
    auth: '—',
    reach: 'cors',
    group: 'beacon',
    verify: "verify: 'hash' passes live; verify: true currently fails with network (the certificate route answered HTTP 400)",
    note: "variant: 'combination' is a 10-minute multi-beacon VDF mix.",
  },
  {
    factory: 'curby()',
    from: '@mindpeeker/entropy/providers',
    source: 'CURBy (CU Boulder + NIST), Twine chain',
    kind: 'beacon',
    privacy: 'public',
    auth: '—',
    reach: 'browser',
    group: 'beacon',
    verify: 'digest length vs multihash code and a freshness guard. The JWS is NOT verified',
    note: '64-byte sha3-512 CID digests; the digest as pulse value is this library’s choice, not a confirmed CURBy definition.',
    tryId: 'curby',
  },
  {
    factory: 'randao()',
    from: '@mindpeeker/entropy/providers',
    source: 'Ethereum RANDAO',
    kind: 'beacon',
    privacy: 'public',
    auth: '—',
    reach: 'cors',
    group: 'chain',
    verify: 'nothing beyond shape',
    note: 'Final mixes of completed epochs (one per 6.4 min); a proposer can bias ≈ 1 bit by withholding a block.',
  },
  {
    factory: 'bitcoinBeacon()',
    from: '@mindpeeker/entropy/providers',
    source: 'Bitcoin block hashes',
    kind: 'beacon',
    privacy: 'public',
    auth: '—',
    reach: 'cors',
    group: 'chain',
    verify: 'nothing beyond shape (no proof-of-work check); a historical block id must match',
    note: '~10 min cadence; miner-grindable at a cost estimated in six figures per bit.',
  },
  {
    factory: 'solanaBeacon()',
    from: '@mindpeeker/entropy/providers',
    source: 'Solana blockhashes',
    kind: 'beacon',
    privacy: 'public',
    auth: '—',
    reach: 'cors',
    group: 'chain',
    verify: 'nothing beyond shape',
    note: '~400 ms slots; values pass through the slot leader.',
  },
  {
    factory: 'tezosBeacon()',
    from: '@mindpeeker/entropy/providers',
    source: 'Tezos block hashes via the TzKT indexer',
    kind: 'beacon',
    privacy: 'public',
    auth: '—',
    reach: 'cors',
    group: 'chain',
    verify: 'base58check checksum of the block hash (the indexer is trusted)',
    note: 'getRound(level) fetches a historical block; extra third-party trust in TzKT.',
  },
  {
    factory: 'flowBeacon()',
    from: '@mindpeeker/entropy/providers',
    source: 'Flow protocol randomness',
    kind: 'beacon',
    privacy: 'public',
    auth: '—',
    reach: 'cors',
    group: 'chain',
    verify: 'the UInt64 is a decimal in [0, 2⁶⁴ − 1]',
    note: '8 bytes per script execution.',
  },
  {
    factory: 'cameraEntropy()',
    from: '@mindpeeker/entropy/providers',
    source: 'camera sensor noise (shot + thermal)',
    kind: 'trng',
    privacy: 'private',
    auth: 'camera permission',
    reach: 'permission',
    group: 'local',
    verify: 'SP 800-90B start-up + RCT/APT health tests on raw samples',
    note: 'Frame-diff sign bits (AetherOnePi-style), von Neumann debiased. Cover the lens for pure thermal noise.',
  },
  {
    factory: 'micEntropy()',
    from: '@mindpeeker/entropy/providers',
    source: 'microphone ADC / Johnson noise',
    kind: 'trng',
    privacy: 'private',
    auth: 'microphone permission',
    reach: 'permission',
    group: 'local',
    verify: 'SP 800-90B health tests on raw samples',
    note: 'Sample LSBs; measured 7.40 b/B raw against a credited 2 b/B.',
  },
  {
    factory: 'sensorEntropy()',
    from: '@mindpeeker/entropy/providers',
    source: 'phone/tablet motion sensors (MEMS)',
    kind: 'trng',
    privacy: 'private',
    auth: 'motion permission (iOS asks)',
    reach: 'permission',
    group: 'local',
    verify: 'health tests run at a stricter 1 b/B than the 0.25 b/B credit',
    note: 'Browsers quantize readings, so the credit is deliberately tiny. A breadth source — mix it, never rely on it.',
  },
  {
    factory: 'serialEntropy({ port })',
    from: '@mindpeeker/entropy/providers',
    source: 'ESP32 / TrueRNG / OneRNG over serial',
    kind: 'trng',
    privacy: 'private',
    auth: 'user picks the port',
    reach: 'web-serial',
    group: 'local',
    verify: 'SP 800-90B health tests at the credited 7 b/B',
    note: 'The fastest physical source measured: ~69 KiB/s raw from an ESP32 at 921 600 baud.',
  },
  {
    factory: 'truerng({ port, mode })',
    from: '@mindpeeker/entropy/providers',
    source: 'TrueRNGpro mode presets (baud-rate knock)',
    kind: 'trng',
    privacy: 'private',
    auth: 'user picks the port',
    reach: 'web-serial',
    group: 'local',
    verify: 'health tests as serialEntropy',
    note: 'Preset of serialEntropy. Byte-stream modes only (normal, rng1, rng2); TRUERNG_MODES also lists ASCII/packet modes that need their own parser.',
    preset: true,
  },
  {
    factory: 'onerng({ port, mode })',
    from: '@mindpeeker/entropy/providers',
    source: 'OneRNG avalanche/RF modes',
    kind: 'trng',
    privacy: 'private',
    auth: 'user picks the port',
    reach: 'web-serial',
    group: 'local',
    verify: 'health tests; raw modes credited 4 b/B by default',
    note: 'Preset of serialEntropy: writes cmd0…cmd7, cmdw and cmdO after opening and cmdo before closing (the feed is off at power-up).',
    preset: true,
  },
  {
    factory: 'sdrEntropy({ source })',
    from: '@mindpeeker/entropy/providers',
    source: 'RTL-SDR radio front-end thermal noise',
    kind: 'trng',
    privacy: 'private',
    auth: '—',
    reach: 'node',
    group: 'local',
    verify: 'health tests on raw IQ LSBs (rtl-entropy pipeline, von Neumann)',
    note: 'Community-verified tier; needs rtlSdrSource() from /node. RF injection is demonstrated in the literature — mix, never trust alone.',
  },
  {
    factory: 'jitterEntropy()',
    from: '@mindpeeker/entropy/providers',
    source: 'CPU micro-architectural timing jitter',
    kind: 'trng',
    privacy: 'private',
    auth: '—',
    reach: 'in-process',
    group: 'local',
    verify: 'jitterStartupTest (monotonic, not coarse, not stuck, varying) + RCT 321 / APT 509 of 512',
    note: 'Node hrtime is credited 1/16 bit per delta. In the browser it needs allowCoarseClock: true and is named jitter(coarse) — real but unquantified entropy.',
    tryId: 'jitter',
  },
  {
    factory: 'hwRng()',
    from: '@mindpeeker/entropy/node',
    source: 'kernel /dev/hwrng',
    kind: 'trng',
    privacy: 'private',
    auth: 'device permissions',
    reach: 'node',
    group: 'local',
    verify: 'whatever the kernel driver trusts, plus the library’s health tests',
    note: 'Linux / Raspberry Pi hardware RNG, ChaosKey. Usually root-only.',
  },
]

/** Non-factory exports of the same entry points, listed so nothing looks hidden. */
export const HELPER_EXPORTS: readonly { readonly name: string; readonly note: string }[] = [
  { name: 'defineProvider', note: 'core: build your own provider with the full contract' },
  { name: 'fallback / xorMix / race', note: 'core: combining strategies (they are providers too)' },
  { name: 'EntropyError', note: 'core: the single error class, discriminated by code' },
  { name: 'DRAND_CHAINS / DRAND_SIGNATURE_BYTES', note: 'pinned chain parameters' },
  { name: 'drandRoundAt / drandRoundTime', note: 'the drand round clock, as arithmetic' },
  { name: 'jitterStartupTest', note: 'the power-up timer self-test, callable on its own' },
  { name: 'signBits / lsbBits / sameSampledPixels', note: 'camera bit extraction internals' },
  { name: 'sampleLsbBits / sensorReadingBytes / iqLsbBits', note: 'mic, sensor and SDR extraction' },
  { name: 'TRUERNG_MODES / TRUERNG_KNOCK_BAUD_RATES / ONERNG_COMMANDS', note: 'serial preset tables' },
  {
    name: 'nodeSerialSource / ffmpegFrameSource / ffmpegSampleSource / rtlSdrSource',
    note: '/node adapters that feed the local providers',
  },
]

export const KIND_TONE: Record<EntropyKind, 'primary' | 'success' | 'info' | 'warning' | 'neutral'> =
  {
    qrng: 'primary',
    trng: 'success',
    beacon: 'info',
    csprng: 'neutral',
    mixed: 'warning',
  }
