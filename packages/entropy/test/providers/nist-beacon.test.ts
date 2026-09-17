import { describe, expect, test } from 'bun:test'
import { nistBeacon } from '../../src/providers/nist-beacon.js'
import { rejectedEntropyError, thrownEntropyError } from '../helpers/errors.js'
import { hangingFetch, jsonResponse, type MockFetch, mockFetch } from '../helpers/mock-fetch.js'
import { providerContract } from '../helpers/provider-contract.js'

/** Deterministic fake 64-byte outputValue per pulse, as 128 uppercase hex chars. */
function outputFor(pulseIndex: number): string {
  return (pulseIndex % 256).toString(16).padStart(2, '0').toUpperCase().repeat(64)
}

function pulseFor(pulseIndex: number, chainIndex = 2) {
  return {
    uri: `https://beacon.nist.gov/beacon/2.0/chain/${chainIndex}/pulse/${pulseIndex}`,
    version: '2.0',
    period: 60_000,
    chainIndex,
    pulseIndex,
    timeStamp: '2026-07-06T00:00:00.000Z',
    signatureValue: 'AB'.repeat(512),
    outputValue: outputFor(pulseIndex),
  }
}

function nistMock(latestIndex = 500, wrapped = true) {
  let current = latestIndex
  const mock = mockFetch((req) => {
    let pulseIndex: number
    if (req.url.endsWith('/pulse/last')) {
      pulseIndex = current
    } else {
      const match = req.url.match(/\/chain\/2\/pulse\/(\d+)$/)
      if (!match) return new Response('not found', { status: 404 })
      pulseIndex = Number(match[1])
    }
    const pulse = pulseFor(pulseIndex)
    return jsonResponse(wrapped ? { pulse } : pulse)
  })
  return { ...mock, advance: () => current++ }
}

let contractMock: MockFetch | undefined
providerContract(
  'nistBeacon',
  () => {
    contractMock = nistMock()
    return nistBeacon({ fetch: contractMock.fetch, pollIntervalMs: 1 })
  },
  {
    kind: 'beacon',
    privacy: 'public',
    lengths: [1, 16, 130],
    streamChunkBytes: 8,
    ioCount: () => contractMock?.calls.length ?? 0,
  },
)

describe('nistBeacon', () => {
  test('is named nist-beacon and is public', () => {
    const p = nistBeacon()
    expect(p.name).toBe('nist-beacon')
    expect(p.kind).toBe('beacon')
    expect(p.privacy).toBe('public')
  })

  test('decodes the pulse outputValue', async () => {
    const { fetch } = nistMock(77)
    const { bytes } = await nistBeacon({ fetch }).getBytes(64)
    expect(bytes).toEqual(new Uint8Array(64).fill(77))
  })

  test('accepts both wrapped and flat pulse responses', async () => {
    for (const wrapped of [true, false]) {
      const { fetch } = nistMock(9, wrapped)
      const { bytes } = await nistBeacon({ fetch }).getBytes(4)
      expect(bytes).toEqual(new Uint8Array(4).fill(9))
    }
  })

  test('walks prior pulses via the chain for large requests', async () => {
    const { fetch, calls } = nistMock(500)
    const { bytes } = await nistBeacon({ fetch }).getBytes(130)
    expect(bytes.length).toBe(130)
    expect(calls.map((c) => c.url.split('/beacon/2.0')[1])).toEqual([
      '/pulse/last',
      '/chain/2/pulse/499',
      '/chain/2/pulse/498',
    ])
  })

  test('results carry chain, pulse, timestamp and signature per pulse, in byte order', async () => {
    const { fetch } = nistMock(500)
    const { sources } = await nistBeacon({ fetch }).getBytes(70)
    expect(sources).toEqual([
      {
        name: 'nist-beacon',
        kind: 'beacon',
        privacy: 'public',
        rounds: [
          {
            round: 500,
            chain: 2,
            timestamp: Date.parse('2026-07-06T00:00:00.000Z'),
            signature: 'AB'.repeat(512),
          },
          {
            round: 499,
            chain: 2,
            timestamp: Date.parse('2026-07-06T00:00:00.000Z'),
            signature: 'AB'.repeat(512),
          },
        ],
      },
    ])
  })

  test('walks back across a chain boundary via /chain/{c-1}/pulse/last', async () => {
    const { fetch, calls } = mockFetch((req) => {
      if (req.url.endsWith('/pulse/last') && !req.url.includes('/chain/')) {
        return jsonResponse({ pulse: pulseFor(1, 2) })
      }
      if (req.url.endsWith('/chain/1/pulse/last')) return jsonResponse({ pulse: pulseFor(9000, 1) })
      if (req.url.endsWith('/chain/1/pulse/8999')) return jsonResponse({ pulse: pulseFor(8999, 1) })
      return new Response('not found', { status: 404 })
    })
    const { bytes, sources } = await nistBeacon({ fetch }).getBytes(192)
    expect(calls.map((c) => c.url.split('/beacon/2.0')[1])).toEqual([
      '/pulse/last',
      '/chain/1/pulse/last',
      '/chain/1/pulse/8999',
    ])
    expect(bytes[0]).toBe(1)
    expect(bytes[64]).toBe(9000 % 256)
    expect(sources[0]?.rounds?.map((r) => [r.chain, r.round])).toEqual([
      [2, 1],
      [1, 9000],
      [1, 8999],
    ])
  })

  test('the first pulse of chain 1 has nothing before it (insufficient_entropy)', async () => {
    const { fetch } = mockFetch(() => jsonResponse({ pulse: pulseFor(1, 1) }))
    await rejectedEntropyError(nistBeacon({ fetch }).getBytes(100), 'insufficient_entropy')
  })

  test('a mirror answering a historical path with another pulse is bad_response', async () => {
    // a caching proxy that serves the latest pulse for every path
    const { fetch } = mockFetch(() => jsonResponse({ pulse: pulseFor(500) }))
    const err = await rejectedEntropyError(nistBeacon({ fetch }).getBytes(130), 'bad_response')
    expect(err.message).toContain('requested pulse 2/499, got 2/500')
  })

  test('throws bad_response on a malformed outputValue', async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse({ pulse: { chainIndex: 2, pulseIndex: 5, outputValue: 'xyz' } }),
    )
    await rejectedEntropyError(nistBeacon({ fetch }).getBytes(8), 'bad_response')
  })

  test('getRound fetches one pulse on the latest chain, or on an explicit chain', async () => {
    const mock = nistMock(500)
    const p = nistBeacon({ fetch: mock.fetch })
    const result = await p.getRound(123)
    expect(result.bytes).toEqual(new Uint8Array(64).fill(123))
    expect(result.round).toMatchObject({ round: 123, chain: 2 })
    expect(result.sources[0]?.rounds).toEqual([result.round])
    expect(mock.calls.map((c) => c.url.split('/beacon/2.0')[1])).toEqual([
      '/pulse/last',
      '/chain/2/pulse/123',
    ])
    await p.getRound(7, { chain: 2 })
    expect(mock.calls.at(-1)?.url.endsWith('/chain/2/pulse/7')).toBe(true)
    expect(mock.calls).toHaveLength(3)
  })

  test('getRound validates the pulse and chain numbers', async () => {
    const p = nistBeacon({ fetch: nistMock().fetch })
    await rejectedEntropyError(p.getRound(0), 'invalid_request')
    await rejectedEntropyError(p.getRound(1.5), 'invalid_request')
    await rejectedEntropyError(p.getRound(5, { chain: 0 }), 'invalid_request')
  })

  test('mirror failover across baseUrls; empty or conflicting base URLs are invalid_request', async () => {
    const { fetch, calls } = mockFetch((req) =>
      req.url.startsWith('https://down.example')
        ? new Response('boom', { status: 503 })
        : jsonResponse({ pulse: pulseFor(42) }),
    )
    const p = nistBeacon({ fetch, baseUrls: ['https://down.example', 'https://up.example'] })
    expect((await p.getBytes(8)).bytes).toEqual(new Uint8Array(8).fill(42))
    expect(calls.map((c) => new URL(c.url).host)).toEqual(['down.example', 'up.example'])
    thrownEntropyError(() => nistBeacon({ baseUrls: [] }), 'invalid_request')
    thrownEntropyError(
      () => nistBeacon({ baseUrl: 'https://a.example', baseUrls: ['https://b.example'] }),
      'invalid_request',
    )
    thrownEntropyError(() => nistBeacon({ pollIntervalMs: 0 }), 'invalid_request')
    thrownEntropyError(() => nistBeacon({ verify: 'yes' as never }), 'invalid_request')
  })

  test('stream dedupes by (chainIndex, pulseIndex)', async () => {
    const mock = nistMock(900)
    const p = nistBeacon({ fetch: mock.fetch, pollIntervalMs: 1 })
    const chunks: Uint8Array[] = []
    for await (const chunk of p.stream()) {
      chunks.push(chunk)
      if (chunks.length === 1) setTimeout(() => mock.advance(), 15)
      if (chunks.length === 2) break
    }
    expect(chunks[0]).toEqual(new Uint8Array(64).fill(900 % 256))
    expect(chunks[1]).toEqual(new Uint8Array(64).fill(901 % 256))
  })

  test('stream keeps yielding after a chain reset (pulseIndex restarts at 1)', async () => {
    let served = 0
    const { fetch } = mockFetch(() => {
      served++
      return jsonResponse({ pulse: served === 1 ? pulseFor(500, 1) : pulseFor(served - 1, 2) })
    })
    const chunks: Uint8Array[] = []
    for await (const chunk of nistBeacon({ fetch, pollIntervalMs: 1 }).stream()) {
      chunks.push(chunk)
      if (chunks.length === 3) break
    }
    expect(chunks.map((c) => c[0])).toEqual([500 % 256, 1, 2])
  })

  test('stream poll timeout rejects with EntropyError timeout', async () => {
    const iterator = nistBeacon({ fetch: hangingFetch(), pollIntervalMs: 1 })
      .stream({ timeoutMs: 30 })
      [Symbol.asyncIterator]()
    await rejectedEntropyError(iterator.next(), 'timeout')
  })

  test('an abort issued after a yield ends the stream at once, not after a poll interval', async () => {
    const { fetch } = nistMock(10)
    const controller = new AbortController()
    const iterator = nistBeacon({ fetch, pollIntervalMs: 60_000 })
      .stream({ signal: controller.signal })
      [Symbol.asyncIterator]()
    await iterator.next()
    controller.abort()
    const started = Date.now()
    await rejectedEntropyError(iterator.next(), 'aborted')
    expect(Date.now() - started).toBeLessThan(1000)
  })

  test('stream({ chunkBytes }) re-slices the 64-byte pulses exactly', async () => {
    const mock = nistMock(3)
    const chunks: Uint8Array[] = []
    const stream = nistBeacon({ fetch: mock.fetch, pollIntervalMs: 1 }).stream({ chunkBytes: 64 })
    for await (const chunk of stream) {
      chunks.push(chunk)
      mock.advance()
      if (chunks.length === 2) break
    }
    expect(chunks.map((c) => c.length)).toEqual([64, 64])
  })
})
