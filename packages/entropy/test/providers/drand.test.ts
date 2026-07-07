import { describe, expect, test } from 'bun:test'
import type { EntropyError } from '../../src/errors.js'
import { cryptoProvider } from '../../src/providers/crypto.js'
import { drand } from '../../src/providers/drand.js'
import { fallback } from '../../src/strategies/fallback.js'
import { xorMix } from '../../src/strategies/xor.js'
import { jsonResponse, mockFetch } from '../helpers/mock-fetch.js'
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

providerContract('drand', () => drand({ fetch: drandMock().fetch, pollIntervalMs: 1 }), {
  kind: 'beacon',
  privacy: 'public',
  lengths: [1, 16, 33],
  streamChunkBytes: 8,
})

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

  test('public privacy propagates correctly through composites', () => {
    const { fetch } = drandMock()
    const beacon = drand({ fetch })
    const local = cryptoProvider()
    expect(xorMix([beacon, local]).privacy).toBe('private')
    expect(xorMix([beacon, beacon]).privacy).toBe('public')
    expect(fallback([beacon, local]).privacy).toBe('public')
  })
})
