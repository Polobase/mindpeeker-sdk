import { describe, expect, test } from 'bun:test'
import { bitcoinBeacon } from '../../src/providers/bitcoin.js'
import { jsonResponse, mockFetch } from '../helpers/mock-fetch.js'
import { providerContract } from '../helpers/provider-contract.js'

function hashFor(height: number): string {
  return (height % 256).toString(16).padStart(2, '0').repeat(32)
}

function bitcoinMock(tipHeight = 900_000) {
  let tip = tipHeight
  const mock = mockFetch((req) => {
    if (req.url.endsWith('/blocks/tip/hash')) {
      return new Response(hashFor(tip), { status: 200 })
    }
    const match = req.url.match(/\/block\/([0-9a-f]{64})$/)
    if (match) {
      const height = Number.parseInt((match[1] as string).slice(0, 2), 16)
      return jsonResponse({ id: match[1], previousblockhash: hashFor(height - 1) })
    }
    return new Response('not found', { status: 404 })
  })
  return { ...mock, advance: () => tip++ }
}

providerContract(
  'bitcoinBeacon',
  () => bitcoinBeacon({ fetch: bitcoinMock().fetch, pollIntervalMs: 1 }),
  { kind: 'beacon', privacy: 'public', lengths: [1, 16, 70], streamChunkBytes: 8 },
)

describe('bitcoinBeacon', () => {
  test('is named bitcoin, public beacon', () => {
    const p = bitcoinBeacon()
    expect(p.name).toBe('bitcoin')
    expect(p.privacy).toBe('public')
  })

  test('fetches the tip hash as plain text', async () => {
    const mock = bitcoinMock(0x42)
    const { bytes } = await bitcoinBeacon({ fetch: mock.fetch }).getBytes(32)
    expect(bytes).toEqual(new Uint8Array(32).fill(0x42))
    expect(mock.calls[0]?.url).toBe('https://blockstream.info/api/blocks/tip/hash')
  })

  test('walks previousblockhash for larger requests', async () => {
    const mock = bitcoinMock(0x50)
    const { bytes } = await bitcoinBeacon({ fetch: mock.fetch }).getBytes(70)
    expect(bytes.length).toBe(70)
    expect(mock.calls.map((c) => c.url.split('/api')[1])).toEqual([
      '/blocks/tip/hash',
      `/block/${hashFor(0x50)}`,
      `/block/${hashFor(0x4f)}`,
    ])
    expect(bytes[32]).toBe(0x4f)
    expect(bytes[64]).toBe(0x4e)
  })

  test('fails over to the mempool.space mirror', async () => {
    const { fetch, calls } = mockFetch((req) => {
      if (req.url.startsWith('https://blockstream.info')) {
        return new Response('down', { status: 500 })
      }
      return new Response(hashFor(7), { status: 200 })
    })
    const { bytes } = await bitcoinBeacon({ fetch }).getBytes(8)
    expect(bytes).toEqual(new Uint8Array(8).fill(7))
    expect(calls[0]?.url.startsWith('https://blockstream.info')).toBe(true)
    expect(calls[1]?.url.startsWith('https://mempool.space')).toBe(true)
  })

  test('rejects malformed tip hashes', async () => {
    const { fetch } = mockFetch(() => new Response('not-a-hash\n', { status: 200 }))
    const err = await bitcoinBeacon({ fetch })
      .getBytes(8)
      .catch((e) => e)
    expect((err as { code?: string }).code).toBe('bad_response')
  })
})
