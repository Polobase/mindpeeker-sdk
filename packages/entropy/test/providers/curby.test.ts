import { describe, expect, test } from 'bun:test'
import { curby } from '../../src/providers/curby.js'
import { rejectedEntropyError, thrownEntropyError } from '../helpers/errors.js'
import { jsonResponse, type MockFetch, mockFetch } from '../helpers/mock-fetch.js'
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

const CURBY_RNG_CHAIN =
  'bafyriqci6f3st2mg7gq733ho4zvvth32zpy2mtiylixwmhoz6d627eo3jfpmbxepe54u2zdvymonq5sp3armtm4rodxsynsirr5g3xsbd3q4s'

/**
 * Build a valid CIDv1 (dag-cbor) whose digest is deterministic per index:
 * sha2-256 (0x12, 32 bytes) or, like the real CURBy-RNG chain, sha3-512
 * (0x14, 64 bytes).
 */
function cidFor(index: number, hash: 'sha2-256' | 'sha3-512' = 'sha2-256') {
  const [code, size] = hash === 'sha2-256' ? [0x12, 32] : [0x14, 64]
  const digest = new Uint8Array(size)
  for (let i = 0; i < size; i++) digest[i] = (index + i * 3) & 0xff
  const bytes = new Uint8Array([0x01, 0x71, code, size, ...digest])
  return { cid: `b${base32Encode(bytes)}`, digest }
}

function blockFor(
  index: number,
  timestamp = new Date().toISOString(),
  hash: 'sha2-256' | 'sha3-512' = 'sha2-256',
) {
  return {
    cid: { '/': cidFor(index, hash).cid },
    data: {
      content: {
        chain: { '/': CURBY_RNG_CHAIN },
        index,
        payload: { timestamp, pre: { '/': { bytes: 'aaaa' } }, salt: { '/': { bytes: 'bbbb' } } },
      },
      signature: 'sig',
    },
  }
}

function curbyMock(latestIndex = 1000, hash: 'sha2-256' | 'sha3-512' = 'sha2-256') {
  let latest = latestIndex
  const mock = mockFetch((req) => {
    if (!req.url.includes('/chains/')) return new Response('not found', { status: 404 })
    const now = new Date().toISOString()
    if (req.url.endsWith('/pulses/latest')) return jsonResponse(blockFor(latest, now, hash))
    const match = req.url.match(/\/pulses\/(\d+)$/)
    if (match) return jsonResponse(blockFor(Number(match[1]), now, hash))
    return new Response('not found', { status: 404 })
  })
  return { ...mock, advance: () => latest++ }
}

let contractMock: MockFetch | undefined
providerContract(
  'curby',
  () => {
    contractMock = curbyMock()
    return curby({ fetch: contractMock.fetch, pollIntervalMs: 1 })
  },
  {
    kind: 'beacon',
    privacy: 'public',
    lengths: [1, 16, 70],
    streamChunkBytes: 8,
    ioCount: () => contractMock?.calls.length ?? 0,
  },
)

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

  test('the real chain uses 64-byte sha3-512 digests: stream({ chunkBytes: 32 }) yields 32-byte chunks', async () => {
    const mock = curbyMock(600, 'sha3-512')
    const chunks: Uint8Array[] = []
    for await (const chunk of curby({ fetch: mock.fetch, pollIntervalMs: 1 }).stream({
      chunkBytes: 32,
    })) {
      chunks.push(chunk)
      if (chunks.length === 2) setTimeout(() => mock.advance(), 5)
      if (chunks.length === 3) break
    }
    expect(chunks.map((c) => c.length)).toEqual([32, 32, 32])
    const digest = cidFor(600, 'sha3-512').digest
    expect(chunks[0]).toEqual(digest.slice(0, 32))
    expect(chunks[1]).toEqual(digest.slice(32))
  })

  test('getBytes over 64-byte digests walks back only as far as needed', async () => {
    const mock = curbyMock(1000, 'sha3-512')
    const { bytes, sources } = await curby({ fetch: mock.fetch }).getBytes(100)
    expect(bytes.slice(0, 64)).toEqual(cidFor(1000, 'sha3-512').digest)
    expect(bytes.slice(64)).toEqual(cidFor(999, 'sha3-512').digest.slice(0, 36))
    expect(mock.calls).toHaveLength(2)
    expect(sources[0]?.rounds?.map((r) => r.round)).toEqual([1000, 999])
    expect(sources[0]?.rounds?.[0]?.signature).toBe('sig')
    expect(typeof sources[0]?.rounds?.[0]?.timestamp).toBe('number')
  })

  test('getRound fetches a pulse by index; a different index or chain is bad_response', async () => {
    const mock = curbyMock(1000)
    const p = curby({ fetch: mock.fetch })
    const result = await p.getRound(77)
    expect(result.bytes).toEqual(cidFor(77).digest)
    expect(result.round.round).toBe(77)
    const wrongIndex = mockFetch(() => jsonResponse(blockFor(5)))
    await rejectedEntropyError(curby({ fetch: wrongIndex.fetch }).getRound(6), 'bad_response')
    const otherChain = mockFetch(() => {
      const block = blockFor(5)
      block.data.content.chain = { '/': 'bafyotherchain' }
      return jsonResponse(block)
    })
    await rejectedEntropyError(curby({ fetch: otherChain.fetch }).getBytes(8), 'bad_response')
  })

  test('rejects a CID whose digest length contradicts its hash function', async () => {
    const bytes = new Uint8Array([0x01, 0x71, 0x14, 0x20, ...new Uint8Array(32).fill(9)])
    const { fetch } = mockFetch(() => {
      const block = blockFor(5)
      block.cid = { '/': `b${base32Encode(bytes)}` }
      return jsonResponse(block)
    })
    await rejectedEntropyError(curby({ fetch }).getBytes(8), 'bad_response')
  })

  test('validates options at construction', () => {
    thrownEntropyError(() => curby({ baseUrls: [] }), 'invalid_request')
    thrownEntropyError(() => curby({ chainCid: 'QmNotBase32' }), 'invalid_request')
    thrownEntropyError(() => curby({ maxStalenessMs: 0 }), 'invalid_request')
  })
})
