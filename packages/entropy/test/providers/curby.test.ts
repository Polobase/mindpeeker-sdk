import { describe, expect, test } from 'bun:test'
import { curby } from '../../src/providers/curby.js'
import { jsonResponse, mockFetch } from '../helpers/mock-fetch.js'
import { providerContract } from '../helpers/provider-contract.js'

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

function base32Encode(bytes: Uint8Array): string {
  let out = ''
  let buffer = 0
  let bits = 0
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out += BASE32_ALPHABET[(buffer >> bits) & 31]
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(buffer << (5 - bits)) & 31]
  return out
}

/** Build a valid CIDv1 (dag-cbor, sha2-256) whose digest is deterministic per index. */
function cidFor(index: number): { cid: string; digest: Uint8Array } {
  const digest = new Uint8Array(32)
  for (let i = 0; i < 32; i++) digest[i] = (index + i * 3) & 0xff
  const bytes = new Uint8Array([0x01, 0x71, 0x12, 0x20, ...digest])
  return { cid: `b${base32Encode(bytes)}`, digest }
}

function blockFor(index: number, timestamp = new Date().toISOString()) {
  return {
    cid: { '/': cidFor(index).cid },
    data: {
      content: {
        chain: { '/': 'bchainchainchain' },
        index,
        payload: { timestamp, pre: { '/': { bytes: 'aaaa' } }, salt: { '/': { bytes: 'bbbb' } } },
      },
      signature: 'sig',
    },
  }
}

function curbyMock(latestIndex = 1000) {
  let latest = latestIndex
  const mock = mockFetch((req) => {
    if (!req.url.includes('/chains/')) return new Response('not found', { status: 404 })
    if (req.url.endsWith('/pulses/latest')) return jsonResponse(blockFor(latest))
    const match = req.url.match(/\/pulses\/(\d+)$/)
    if (match) return jsonResponse(blockFor(Number(match[1])))
    return new Response('not found', { status: 404 })
  })
  return { ...mock, advance: () => latest++ }
}

providerContract('curby', () => curby({ fetch: curbyMock().fetch, pollIntervalMs: 1 }), {
  kind: 'beacon',
  privacy: 'public',
  lengths: [1, 16, 70],
  streamChunkBytes: 8,
})

describe('curby', () => {
  test('is named curby, public beacon', () => {
    const p = curby()
    expect(p.name).toBe('curby')
    expect(p.privacy).toBe('public')
  })

  test("randomness is the block CID's multihash digest", async () => {
    const mock = curbyMock(1234)
    const { bytes } = await curby({ fetch: mock.fetch }).getBytes(32)
    expect(bytes).toEqual(cidFor(1234).digest)
    expect(mock.calls[0]?.url.startsWith('https://api.entwine.me/chains/')).toBe(true)
    expect(mock.calls[0]?.url.endsWith('/pulses/latest')).toBe(true)
  })

  test('walks prior pulses by index for larger requests', async () => {
    const mock = curbyMock(1000)
    const { bytes } = await curby({ fetch: mock.fetch }).getBytes(70)
    expect(bytes.length).toBe(70)
    expect(mock.calls[1]?.url.endsWith('/pulses/999')).toBe(true)
    expect(mock.calls[2]?.url.endsWith('/pulses/998')).toBe(true)
  })

  test('rejects a stale chain (spool not advancing)', async () => {
    const old = new Date(Date.now() - 3600_000).toISOString()
    const { fetch } = mockFetch(() => jsonResponse(blockFor(5, old)))
    const err = await curby({ fetch })
      .getBytes(8)
      .catch((e) => e)
    expect((err as { code?: string }).code).toBe('bad_response')
    expect((err as Error).message).toContain('stale')
  })

  test('fails over to the colorado mirror', async () => {
    const { fetch, calls } = mockFetch((req) => {
      if (req.url.startsWith('https://api.entwine.me')) return new Response('down', { status: 500 })
      return jsonResponse(blockFor(7))
    })
    const { bytes } = await curby({ fetch }).getBytes(8)
    expect(bytes).toEqual(cidFor(7).digest.slice(0, 8))
    expect(calls[1]?.url.startsWith('https://random.colorado.edu/api')).toBe(true)
  })

  test('stream dedupes by pulse index', async () => {
    const mock = curbyMock(600)
    const chunks: Uint8Array[] = []
    for await (const chunk of curby({ fetch: mock.fetch, pollIntervalMs: 1 }).stream()) {
      chunks.push(chunk)
      if (chunks.length === 1) setTimeout(() => mock.advance(), 15)
      if (chunks.length === 2) break
    }
    expect(chunks[0]).toEqual(cidFor(600).digest)
    expect(chunks[1]).toEqual(cidFor(601).digest)
  })
})
