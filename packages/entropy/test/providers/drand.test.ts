import { describe, expect, test } from 'bun:test'
import type { EntropyError } from '../../src/errors.js'
import { cryptoProvider } from '../../src/providers/crypto.js'
import { drand } from '../../src/providers/drand.js'
import { DRAND_CHAINS, drandRoundAt, drandRoundTime } from '../../src/providers/drand-chain.js'
import { fallback } from '../../src/strategies/fallback.js'
import { xorMix } from '../../src/strategies/xor.js'
import { rejectedEntropyError, thrownEntropyError } from '../helpers/errors.js'
import { hangingFetch, jsonResponse, type MockFetch, mockFetch } from '../helpers/mock-fetch.js'
import { providerContract } from '../helpers/provider-contract.js'

/** Deterministic fake 48-byte BLS signature per round, as 96 hex chars. */
function sigFor(round: number): string {
  return (round % 256).toString(16).padStart(2, '0').repeat(48)
}

async function sha256(hex: string): Promise<Uint8Array> {
  const bytes = new Uint8Array(48)
  for (let i = 0; i < 48; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
}

function drandMock(latestRound = 100) {
  let current = latestRound
  const mock = mockFetch((req) => {
    const match = req.url.match(/\/v2\/beacons\/quicknet\/rounds\/(latest|\d+)$/)
    if (!match) return new Response('not found', { status: 404 })
    const round = match[1] === 'latest' ? current : Number(match[1])
    return jsonResponse({ round, signature: sigFor(round) })
  })
  return { ...mock, advance: () => current++ }
}

let contractMock: MockFetch | undefined
providerContract(
  'drand',
  () => {
    contractMock = drandMock()
    return drand({ fetch: contractMock.fetch, pollIntervalMs: 1 })
  },
  {
    kind: 'beacon',
    privacy: 'public',
    lengths: [1, 16, 33],
    streamChunkBytes: 8,
    ioCount: () => contractMock?.calls.length ?? 0,
  },
)

describe('drand', () => {
  test('is named drand and is public', () => {
    const p = drand()
    expect(p.name).toBe('drand')
    expect(p.kind).toBe('beacon')
    expect(p.privacy).toBe('public')
  })

  test('derives randomness as SHA-256 of the round signature', async () => {
    const { fetch } = drandMock(42)
    const { bytes, sources } = await drand({ fetch }).getBytes(32)
    expect(bytes).toEqual(await sha256(sigFor(42)))
    expect(sources[0]?.privacy).toBe('public')
  })

  test('walks prior rounds for requests larger than 32 bytes', async () => {
    const { fetch, calls } = drandMock(100)
    const { bytes } = await drand({ fetch }).getBytes(70)
    expect(bytes.length).toBe(70)
    expect(calls.map((c) => c.url.split('/rounds/')[1])).toEqual(['latest', '99', '98'])
    const expected = new Uint8Array(70)
    expected.set((await sha256(sigFor(100))).subarray(0, 32), 0)
    expected.set((await sha256(sigFor(99))).subarray(0, 32), 32)
    expected.set((await sha256(sigFor(98))).subarray(0, 6), 64)
    expect(bytes).toEqual(expected)
  })

  test('fails over across mirror base URLs', async () => {
    const { calls, fetch } = (() => {
      const inner = mockFetch((req) => {
        if (req.url.startsWith('https://down.example.com')) {
          return new Response('boom', { status: 500 })
        }
        return jsonResponse({ round: 7, signature: sigFor(7) })
      })
      return inner
    })()
    const p = drand({ fetch, baseUrls: ['https://down.example.com', 'https://up.example.com'] })
    const { bytes } = await p.getBytes(8)
    expect(bytes.length).toBe(8)
    expect(calls[0]?.url.startsWith('https://down.example.com')).toBe(true)
    expect(calls[1]?.url.startsWith('https://up.example.com')).toBe(true)
  })

  test('throws bad_response on a malformed round', async () => {
    const { fetch } = mockFetch(() => jsonResponse({ round: 5 }))
    const err = (await drand({ fetch })
      .getBytes(8)
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('bad_response')
  })

  test('stream yields one value per NEW round (dedupes repeats)', async () => {
    const mock = drandMock(200)
    const p = drand({ fetch: mock.fetch, pollIntervalMs: 1 })
    const chunks: Uint8Array[] = []
    let polls = 0
    for await (const chunk of p.stream()) {
      chunks.push(chunk)
      if (chunks.length === 1) {
        // keep the round unchanged for a few polls, then advance
        polls = mock.calls.length
        setTimeout(() => mock.advance(), 15)
      }
      if (chunks.length === 2) break
    }
    expect(chunks[0]).toEqual(await sha256(sigFor(200)))
    expect(chunks[1]).toEqual(await sha256(sigFor(201)))
    expect(mock.calls.length).toBeGreaterThan(polls) // it kept polling while deduping
  })

  test('round metadata survives composites', async () => {
    const { fetch } = drandMock(300)
    const mixed = await xorMix([drand({ fetch }), cryptoProvider()]).getBytes(32)
    expect(mixed.sources[0]?.rounds?.[0]?.round).toBe(300)
    expect(mixed.sources[1]?.rounds).toBeUndefined()
    const served = await fallback([drand({ fetch }), cryptoProvider()]).getBytes(8)
    expect(served.sources[0]?.rounds?.[0]?.round).toBe(300)
  })

  test('public privacy propagates correctly through composites', () => {
    const { fetch } = drandMock()
    const beacon = drand({ fetch })
    const local = cryptoProvider()
    expect(xorMix([beacon, local]).privacy).toBe('private')
    expect(xorMix([beacon, beacon]).privacy).toBe('public')
    expect(fallback([beacon, local]).privacy).toBe('public')
  })

  test('results carry round, timestamp (from the pinned quicknet chain) and signature', async () => {
    const { fetch } = drandMock(100)
    const { sources } = await drand({ fetch }).getBytes(40)
    const time = (round: number) => (1692803367 + (round - 1) * 3) * 1000
    expect(sources[0]?.rounds).toEqual([
      { round: 100, timestamp: time(100), signature: sigFor(100) },
      { round: 99, timestamp: time(99), signature: sigFor(99) },
    ])
  })

  test('getRound fetches one round and checks the server answered that round', async () => {
    const mock = drandMock(500)
    const p = drand({ fetch: mock.fetch })
    const result = await p.getRound(42)
    expect(result.bytes).toEqual(await sha256(sigFor(42)))
    expect(result.round).toMatchObject({ round: 42, signature: sigFor(42) })
    await rejectedEntropyError(p.getRound(0), 'invalid_request')
    await rejectedEntropyError(p.getRound(5, { chain: 1 }), 'invalid_request')
    const { fetch } = mockFetch(() => jsonResponse({ round: 7, signature: sigFor(7) }))
    const err = await rejectedEntropyError(drand({ fetch }).getRound(8), 'bad_response')
    expect(err.message).toContain('requested round 8, got 7')
  })

  test('a walk-back answered with the wrong round is bad_response', async () => {
    const { fetch } = mockFetch(() => jsonResponse({ round: 100, signature: sigFor(100) }))
    await rejectedEntropyError(drand({ fetch }).getBytes(64), 'bad_response')
  })

  test('validates options at construction', () => {
    thrownEntropyError(() => drand({ baseUrls: [] }), 'invalid_request')
    thrownEntropyError(() => drand({ pollIntervalMs: -1 }), 'invalid_request')
    thrownEntropyError(() => drand({ beacon: '../quicknet' }), 'invalid_request')
    thrownEntropyError(() => drand({ verify: 'bls' as never }), 'invalid_request')
    thrownEntropyError(() => drand({ beacon: 'unknown', verify: 'structural' }), 'invalid_request')
  })

  test('accepts a single baseUrl', async () => {
    const mock = drandMock(3)
    await drand({ fetch: mock.fetch, baseUrl: 'https://proxy.example' }).getBytes(8)
    expect(mock.calls[0]?.url).toBe('https://proxy.example/v2/beacons/quicknet/rounds/latest')
  })

  test('stream poll timeout rejects with EntropyError timeout', async () => {
    const iterator = drand({ fetch: hangingFetch(), pollIntervalMs: 1 })
      .stream({ timeoutMs: 30 })
      [Symbol.asyncIterator]()
    await rejectedEntropyError(iterator.next(), 'timeout')
  })
})

describe('drand round arithmetic', () => {
  // reference values: closed form evaluated in Python (genesis 1692803367, period 3)
  test('drandRoundAt and drandRoundTime follow the drand client formulas', () => {
    const quicknet = DRAND_CHAINS.quicknet
    expect(drandRoundTime(1, quicknet)).toBe(1692803367000)
    expect(drandRoundTime(2, quicknet)).toBe(1692803370000)
    expect(drandRoundTime(32281510, quicknet)).toBe(1789647894000)
    expect(drandRoundAt(1789647894000, quicknet)).toBe(32281510)
    expect(drandRoundAt(1692803367000, quicknet)).toBe(1)
    expect(drandRoundAt(1692803369999, quicknet)).toBe(1)
    expect(drandRoundAt(1692803370000, quicknet)).toBe(2)
    expect(drandRoundTime(6473895, DRAND_CHAINS.default)).toBe(1789647870000)
    for (const round of [1, 2, 3, 1000, 32281667]) {
      expect(drandRoundAt(drandRoundTime(round, quicknet), quicknet)).toBe(round)
    }
  })

  test('rejects times before genesis, non-finite times and invalid rounds', () => {
    const quicknet = DRAND_CHAINS.quicknet
    thrownEntropyError(() => drandRoundAt(0, quicknet), 'invalid_request')
    thrownEntropyError(() => drandRoundAt(Number.NaN, quicknet), 'invalid_request')
    thrownEntropyError(() => drandRoundTime(0, quicknet), 'invalid_request')
    thrownEntropyError(() => drandRoundTime(2.5, quicknet), 'invalid_request')
    thrownEntropyError(
      () => drandRoundAt(Date.now(), { genesisTime: 0, period: 0 }),
      'invalid_request',
    )
  })
})

describe("drand verify: 'structural'", () => {
  const quicknetInfo = {
    public_key: '83cf',
    period: 3,
    genesis_time: 1692803367,
    chain_hash: DRAND_CHAINS.quicknet.hash,
    scheme: 'bls-unchained-g1-rfc9380',
    beacon_id: 'quicknet',
  }
  // live v1 response for quicknet round 32281667 (randomness = SHA-256(signature))
  const LIVE_SIGNATURE =
    'b0f5ae301358ff87a9d3dd539ed4a07c0148b1ab4f7b61a8ca43c7e9ca7ca9553e4faae9188deb30b2cd1a7f447e3e5b'
  const LIVE_RANDOMNESS = '4fd2fc55983dbfa3f446d8a0bd56f16cc8c5e76afd1ec154b60d477cbabed13b'

  function structuralMock(
    round: Record<string, unknown>,
    info: Record<string, unknown> = quicknetInfo,
  ) {
    return mockFetch((req) =>
      req.url.endsWith('/info') ? jsonResponse(info) : jsonResponse(round),
    )
  }

  test('accepts a live round whose randomness is SHA-256 of its 48-byte signature', async () => {
    const mock = structuralMock({
      round: 32281667,
      signature: LIVE_SIGNATURE,
      randomness: LIVE_RANDOMNESS,
    })
    const p = drand({ fetch: mock.fetch, verify: 'structural' })
    const { bytes } = await p.getBytes(32)
    expect(Buffer.from(bytes).toString('hex')).toBe(LIVE_RANDOMNESS)
    await p.getBytes(8)
    expect(mock.calls.filter((c) => c.url.endsWith('/info'))).toHaveLength(1) // cached per mirror
  })

  test('rejects a mirror serving another chain', async () => {
    const mock = structuralMock(
      { round: 32281667, signature: LIVE_SIGNATURE },
      { ...quicknetInfo, chain_hash: DRAND_CHAINS.default.hash },
    )
    const err = await rejectedEntropyError(
      drand({ fetch: mock.fetch, verify: 'structural' }).getBytes(8),
      'verification',
    )
    expect(err.message).toContain('pinned')
  })

  test('rejects a wrong signature length, a mismatching randomness and a future round', async () => {
    const cases = [
      { round: 32281667, signature: 'ab'.repeat(96) },
      { round: 32281667, signature: LIVE_SIGNATURE, randomness: '00'.repeat(32) },
      { round: drandRoundAt(Date.now(), DRAND_CHAINS.quicknet) + 100, signature: LIVE_SIGNATURE },
    ]
    for (const round of cases) {
      const mock = structuralMock(round)
      await rejectedEntropyError(
        drand({ fetch: mock.fetch, verify: 'structural' }).getBytes(8),
        'verification',
      )
    }
  })
})
