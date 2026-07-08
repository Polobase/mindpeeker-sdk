import { describe, expect, test } from 'bun:test'
import { randao } from '../../src/providers/randao.js'
import { jsonResponse, mockFetch } from '../helpers/mock-fetch.js'
import { providerContract } from '../helpers/provider-contract.js'

function mixFor(epoch: number): string {
  return `0x${(epoch % 256).toString(16).padStart(2, '0').repeat(32)}`
}

function randaoMock(headSlot = 3200) {
  let slot = headSlot
  const mock = mockFetch((req) => {
    const url = new URL(req.url)
    if (url.pathname.endsWith('/beacon/headers/head')) {
      return jsonResponse({ data: { header: { message: { slot: String(slot) } } } })
    }
    if (url.pathname.endsWith('/randao')) {
      const epochParam = url.searchParams.get('epoch')
      const epoch = epochParam === null ? Math.floor(slot / 32) : Number(epochParam)
      return jsonResponse({ data: { randao: mixFor(epoch) } })
    }
    return new Response('not found', { status: 404 })
  })
  return { ...mock, advance: () => (slot += 32) }
}

providerContract('randao', () => randao({ fetch: randaoMock().fetch, pollIntervalMs: 1 }), {
  kind: 'beacon',
  privacy: 'public',
  lengths: [1, 16, 70],
  streamChunkBytes: 8,
})

describe('randao', () => {
  test('is named randao, public beacon', () => {
    const p = randao()
    expect(p.name).toBe('randao')
    expect(p.kind).toBe('beacon')
    expect(p.privacy).toBe('public')
  })

  test('decodes the head randao mix', async () => {
    const mock = randaoMock(3200) // epoch 100
    const { bytes } = await randao({ fetch: mock.fetch }).getBytes(32)
    expect(bytes).toEqual(new Uint8Array(32).fill(100))
    expect(mock.calls[0]?.url).toBe(
      'https://ethereum-beacon-api.publicnode.com/eth/v1/beacon/states/head/randao',
    )
  })

  test('walks prior epochs for larger requests', async () => {
    const mock = randaoMock(3200) // epoch 100
    const { bytes } = await randao({ fetch: mock.fetch }).getBytes(70)
    expect(bytes.length).toBe(70)
    const paths = mock.calls.map((c) => c.url.split('/eth/v1')[1])
    expect(paths[0]).toBe('/beacon/states/head/randao')
    expect(paths[1]).toBe('/beacon/headers/head')
    expect(paths[2]).toBe('/beacon/states/head/randao?epoch=99')
    expect(paths[3]).toBe('/beacon/states/head/randao?epoch=98')
    // distinct epochs → distinct bytes
    expect(bytes[0]).toBe(100)
    expect(bytes[32]).toBe(99)
    expect(bytes[64]).toBe(98)
  })

  test('stream dedupes repeated mixes by value', async () => {
    const mock = randaoMock(3200)
    const chunks: Uint8Array[] = []
    for await (const chunk of randao({ fetch: mock.fetch, pollIntervalMs: 1 }).stream()) {
      chunks.push(chunk)
      if (chunks.length === 1) setTimeout(() => mock.advance(), 15)
      if (chunks.length === 2) break
    }
    expect(chunks[0]).toEqual(new Uint8Array(32).fill(100))
    expect(chunks[1]).toEqual(new Uint8Array(32).fill(101))
  })
})
