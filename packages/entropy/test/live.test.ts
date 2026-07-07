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
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { anu } from '../src/providers/anu.js'
import { anuLegacy } from '../src/providers/anu-legacy.js'
import { cryptoProvider } from '../src/providers/crypto.js'
import { drand } from '../src/providers/drand.js'
import { lfdr } from '../src/providers/lfdr.js'
import { nistBeacon } from '../src/providers/nist-beacon.js'
import { outshift } from '../src/providers/outshift.js'
import { qci } from '../src/providers/qci.js'
import { qrandomIo } from '../src/providers/qrandom.js'
import { randomOrg } from '../src/providers/random-org.js'
import { superRand } from '../src/providers/superrand.js'
import { fallback } from '../src/strategies/fallback.js'
import { xorMix } from '../src/strategies/xor.js'
import type { EntropyProvider } from '../src/types.js'

/**
 * Bun only auto-loads .env from the directory the command is launched in, so
 * running `bun test` inside packages/entropy would miss the workspace-root
 * .env. Walk up from this file and load the nearest one; explicitly exported
 * variables always win over file values.
 */
function loadNearestDotEnv(startDir: string): void {
  let dir = startDir
  for (let depth = 0; depth < 6; depth++) {
    const file = join(dir, '.env')
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
        if (!match) continue
        const key = match[1] as string
        const value = (match[2] as string).replace(/^(['"])(.*)\1$/, '$2')
        if (value !== '' && process.env[key] === undefined) process.env[key] = value
      }
      return
    }
    const parent = dirname(dir)
    if (parent === dir) return
    dir = parent
  }
}
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
