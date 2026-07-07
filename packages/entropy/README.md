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

All network providers accept `fetch` (dependency injection / proxying) and a base-URL override.

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
`insufficient_entropy` · `timeout` · `aborted` · `invalid_request`.

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
