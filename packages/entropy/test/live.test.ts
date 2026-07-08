/**
 * Live integration tests — hit the real provider APIs. Skipped unless LIVE=1:
 *
 *   LIVE=1 bun test live
 *
 * Keyed providers additionally need their env var:
 *   ANU_API_KEY, OUTSHIFT_API_KEY, QCI_API_TOKEN, RANDOM_ORG_API_KEY, SUPERRAND_API_KEY
 *
 * Requests are kept minimal (16 bytes) to respect free quotas. anu-legacy is
 * limited to 1 request/minute server-side, so it gets a single small call.
 */
import { describe, expect, test } from 'bun:test'
import { anu } from '../src/providers/anu.js'
import { anuLegacy } from '../src/providers/anu-legacy.js'
import { bitcoinBeacon } from '../src/providers/bitcoin.js'
import { cryptoProvider } from '../src/providers/crypto.js'
import { curby } from '../src/providers/curby.js'
import { drand } from '../src/providers/drand.js'
import { flowBeacon } from '../src/providers/flow.js'
import { inmetro } from '../src/providers/inmetro.js'
import { lfdr } from '../src/providers/lfdr.js'
import { nistBeacon } from '../src/providers/nist-beacon.js'
import { nqsn } from '../src/providers/nqsn.js'
import { outshift } from '../src/providers/outshift.js'
import { padova } from '../src/providers/padova.js'
import { qbck } from '../src/providers/qbck.js'
import { qci } from '../src/providers/qci.js'
import { qrandomIo } from '../src/providers/qrandom.js'
import { randao } from '../src/providers/randao.js'
import { randomOrg } from '../src/providers/random-org.js'
import { solanaBeacon } from '../src/providers/solana.js'
import { superRand } from '../src/providers/superrand.js'
import { tezosBeacon } from '../src/providers/tezos.js'
import { uchile } from '../src/providers/uchile.js'
import { fallback } from '../src/strategies/fallback.js'
import { xorMix } from '../src/strategies/xor.js'
import type { EntropyProvider } from '../src/types.js'
import { loadNearestDotEnv } from './helpers/dotenv.js'

loadNearestDotEnv(import.meta.dir)

const LIVE = process.env.LIVE === '1'
const env = (name: string) => process.env[name] ?? ''

function liveTest(label: string, enabled: boolean, make: () => EntropyProvider, bytes = 16) {
  test.skipIf(!LIVE || !enabled)(
    `${label} serves ${bytes} live bytes`,
    async () => {
      const provider = make()
      const result = await provider.getBytes(bytes, { timeoutMs: 20_000 })
      expect(result.bytes.length).toBe(bytes)
      expect(result.sources.length).toBeGreaterThan(0)
      expect(new Set(result.bytes).size).toBeGreaterThan(1)
    },
    30_000,
  )
}

describe('live: keyless providers', () => {
  liveTest('qrandom.io', true, () => qrandomIo())
  liveTest('lfdr', true, () => lfdr())
  liveTest('drand', true, () => drand(), 40) // 40 bytes → exercises 2 rounds
  liveTest('nist-beacon', true, () => nistBeacon(), 70) // 70 bytes → 2 pulses
  liveTest('anu-legacy (1 req/min!)', true, () => anuLegacy())
  liveTest('nqsn', true, () => nqsn(), 70) // 2 pulses → verifies the 303 redirect + chain walk
  liveTest('uchile', true, () => uchile(), 70) // verifies the query-form latest route
  // Inmetro ships an incomplete TLS certificate chain that Node/Bun's fetch
  // rejects (curl and browsers tolerate it). Gate behind an env flag; the
  // provider works wherever the intermediate cert is available or a custom
  // fetch is supplied.
  liveTest('inmetro', env('ENTROPY_TEST_INMETRO') === '1', () => inmetro(), 70)
  liveTest(
    'inmetro (combination)',
    env('ENTROPY_TEST_INMETRO') === '1',
    () => inmetro({ variant: 'combination' }),
    16,
  )
  liveTest('padova', true, () => padova())
  liveTest('curby', true, () => curby(), 40) // 2 pulses → verifies CID digest + history walk
  liveTest('randao', true, () => randao(), 40) // 2 mixes → verifies the epoch walk
  liveTest('bitcoin', true, () => bitcoinBeacon(), 40) // 2 blocks → verifies prev-hash walk
  liveTest('solana', true, () => solanaBeacon(), 40) // 2 slots → verifies aggregation
  liveTest('tezos', true, () => tezosBeacon(), 40) // 2 levels → verifies base58check
  liveTest('flow', true, () => flowBeacon(), 16) // 2 draws → verifies double-decode
})

describe('live: keyed providers', () => {
  liveTest('anu', env('ANU_API_KEY') !== '', () => anu({ apiKey: env('ANU_API_KEY') }))
  liveTest('outshift', env('OUTSHIFT_API_KEY') !== '', () =>
    outshift({ apiKey: env('OUTSHIFT_API_KEY') }),
  )
  liveTest('qci', env('QCI_API_TOKEN') !== '', () => qci({ apiToken: env('QCI_API_TOKEN') }))
  liveTest('random.org', env('RANDOM_ORG_API_KEY') !== '', () =>
    randomOrg({ apiKey: env('RANDOM_ORG_API_KEY') }),
  )
  liveTest('superrand (REST)', env('SUPERRAND_API_KEY') !== '', () =>
    superRand({ apiKey: env('SUPERRAND_API_KEY') }),
  )
  liveTest('qbck', env('QBCK_API_KEY') !== '', () => qbck({ apiKey: env('QBCK_API_KEY') }))

  test.skipIf(!LIVE || env('SUPERRAND_API_KEY') === '')(
    'superrand WebSocket stream yields two chunks',
    async () => {
      const chunks: Uint8Array[] = []
      const stream = superRand({ apiKey: env('SUPERRAND_API_KEY') }).stream({ chunkBytes: 8 })
      for await (const chunk of stream) {
        chunks.push(chunk)
        if (chunks.length === 2) break
      }
      expect(chunks[0]).toHaveLength(8)
      expect(chunks[1]).toHaveLength(8)
    },
    30_000,
  )
})

describe('live: composites', () => {
  liveTest('fallback(qrandom.io → crypto)', true, () => fallback([qrandomIo(), cryptoProvider()]))
  liveTest(
    'xorMix(drand ⊕ crypto) stays private',
    true,
    () => {
      const mixed = xorMix([drand(), cryptoProvider()])
      expect(mixed.privacy).toBe('private')
      return mixed
    },
    32,
  )

  test.skipIf(!LIVE)(
    'drand stream yields two consecutive rounds',
    async () => {
      const chunks: Uint8Array[] = []
      for await (const chunk of drand().stream()) {
        chunks.push(chunk)
        if (chunks.length === 2) break
      }
      expect(chunks[0]).toHaveLength(32)
      expect(chunks[1]).toHaveLength(32)
      expect(chunks[0]).not.toEqual(chunks[1])
    },
    20_000,
  )
})
