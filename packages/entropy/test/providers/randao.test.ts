import { describe, expect, test } from 'bun:test'
import { randao } from '../../src/providers/randao.js'
import { rejectedEntropyError, thrownEntropyError } from '../helpers/errors.js'
import { jsonResponse, type MockFetch, mockFetch } from '../helpers/mock-fetch.js'
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

let contractMock: MockFetch | undefined
providerContract(
  'randao',
  () => {
    contractMock = randaoMock()
    return randao({ fetch: contractMock.fetch, pollIntervalMs: 1 })
  },
  {
    kind: 'beacon',
    privacy: 'public',
    lengths: [1, 16, 70],
    streamChunkBytes: 8,
    ioCount: () => contractMock?.calls.length ?? 0,
  },
)

describe('randao', () => {
  test('is named randao, public beacon', () => {
    const p = randao()
    expect(p.name).toBe('randao')
    expect(p.kind).toBe('beacon')
    expect(p.privacy).toBe('public')
  })

  test('serves the final mix of the newest completed epoch, naming it', async () => {
    const mock = randaoMock(3200) // head epoch 100 → newest completed epoch 99
    const { bytes, sources } = await randao({ fetch: mock.fetch }).getBytes(32)
    expect(bytes).toEqual(new Uint8Array(32).fill(99))
    expect(sources[0]?.rounds).toEqual([{ round: 99 }])
    expect(mock.calls.map((c) => c.url.split('/eth/v1')[1])).toEqual([
      '/beacon/headers/head',
      '/beacon/states/head/randao?epoch=99',
    ])
  })

  test('walks completed epochs backwards for larger requests', async () => {
    const mock = randaoMock(3200)
    const { bytes, sources } = await randao({ fetch: mock.fetch }).getBytes(70)
    expect(bytes.length).toBe(70)
    expect(bytes[0]).toBe(99)
    expect(bytes[32]).toBe(98)
    expect(bytes[64]).toBe(97)
    expect(sources[0]?.rounds?.map((r) => r.round)).toEqual([99, 98, 97])
  })

  test('rejects malformed head slots with bad_response (null, empty, non-decimal)', async () => {
    for (const slot of [null, '', '12abc', 12, '-5']) {
      const { fetch } = mockFetch(() => jsonResponse({ data: { header: { message: { slot } } } }))
      await rejectedEntropyError(randao({ fetch }).getBytes(8), 'bad_response')
    }
  })

  test('the genesis epoch has no completed predecessor (insufficient_entropy)', async () => {
    const mock = randaoMock(5) // head epoch 0
    await rejectedEntropyError(randao({ fetch: mock.fetch }).getBytes(8), 'insufficient_entropy')
  })

  test('getRound(epoch) returns a completed epoch; the running epoch is invalid_request', async () => {
    const mock = randaoMock(3200)
    const p = randao({ fetch: mock.fetch })
    const result = await p.getRound(42)
    expect(result.bytes).toEqual(new Uint8Array(32).fill(42))
    expect(result.round).toEqual({ round: 42 })
    await rejectedEntropyError(p.getRound(100), 'invalid_request')
    await rejectedEntropyError(p.getRound(-1), 'invalid_request')
  })

  test('stream yields once per completed epoch', async () => {
    const mock = randaoMock(3200)
    const chunks: Uint8Array[] = []
    for await (const chunk of randao({ fetch: mock.fetch, pollIntervalMs: 1 }).stream()) {
      chunks.push(chunk)
      if (chunks.length === 1) setTimeout(() => mock.advance(), 15)
      if (chunks.length === 2) break
    }
    expect(chunks[0]).toEqual(new Uint8Array(32).fill(99))
    expect(chunks[1]).toEqual(new Uint8Array(32).fill(100))
  })

  test('validates options at construction', () => {
    thrownEntropyError(() => randao({ baseUrls: [] }), 'invalid_request')
    thrownEntropyError(() => randao({ pollIntervalMs: Number.NaN }), 'invalid_request')
  })
})
