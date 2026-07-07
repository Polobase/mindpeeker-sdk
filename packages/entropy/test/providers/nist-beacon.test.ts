import { describe, expect, test } from 'bun:test'
import type { EntropyError } from '../../src/errors.js'
import { nistBeacon } from '../../src/providers/nist-beacon.js'
import { jsonResponse, mockFetch } from '../helpers/mock-fetch.js'
import { providerContract } from '../helpers/provider-contract.js'

/** Deterministic fake 64-byte outputValue per pulse, as 128 uppercase hex chars. */
function outputFor(pulseIndex: number): string {
  return (pulseIndex % 256).toString(16).padStart(2, '0').toUpperCase().repeat(64)
}

function pulseFor(pulseIndex: number) {
  return {
    uri: `https://beacon.nist.gov/beacon/2.0/chain/2/pulse/${pulseIndex}`,
    version: '2.0',
    period: 60_000,
    chainIndex: 2,
    pulseIndex,
    timeStamp: '2026-07-06T00:00:00.000Z',
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

providerContract('nistBeacon', () => nistBeacon({ fetch: nistMock().fetch, pollIntervalMs: 1 }), {
  kind: 'beacon',
  privacy: 'public',
  lengths: [1, 16, 130],
  streamChunkBytes: 8,
})

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

  test('throws bad_response on a malformed outputValue', async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse({ pulse: { chainIndex: 2, pulseIndex: 5, outputValue: 'xyz' } }),
    )
    const err = (await nistBeacon({ fetch })
      .getBytes(8)
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('bad_response')
  })

  test('stream dedupes by pulseIndex', async () => {
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
})
