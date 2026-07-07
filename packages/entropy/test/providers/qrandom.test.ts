import { describe, expect, test } from 'bun:test'
import type { EntropyError } from '../../src/errors.js'
import { qrandomIo } from '../../src/providers/qrandom.js'
import { jsonResponse, mockFetch } from '../helpers/mock-fetch.js'
import { providerContract } from '../helpers/provider-contract.js'

function qrandomMock() {
  return mockFetch((req) => {
    const url = new URL(req.url)
    const n = Number(url.searchParams.get('n'))
    return jsonResponse({
      id: 'abc',
      message: 'Request',
      timestamp: '2026-07-06T00:00:00Z',
      numbers: Array.from({ length: n }, (_, i) => (i * 3) % 256),
      signature: 'sig',
      resultType: 'randomIntArray',
    })
  })
}

providerContract('qrandomIo', () => qrandomIo({ fetch: qrandomMock().fetch }), {
  kind: 'qrng',
  privacy: 'private',
  // 2500 forces chunking across the 1000-per-request cap
  lengths: [1, 16, 2500],
})

describe('qrandomIo', () => {
  test('is named qrandom.io', () => {
    expect(qrandomIo().name).toBe('qrandom.io')
  })

  test('requests ints in the byte range', async () => {
    const { fetch, calls } = qrandomMock()
    await qrandomIo({ fetch }).getBytes(6)
    const url = new URL(calls[0]?.url ?? '')
    expect(url.href.startsWith('https://qrandom.io/api/random/ints?')).toBe(true)
    expect(url.searchParams.get('n')).toBe('6')
    expect(url.searchParams.get('min')).toBe('0')
    expect(url.searchParams.get('max')).toBe('255')
  })

  test('chunks across the 1000-per-request cap', async () => {
    const { fetch, calls } = qrandomMock()
    const { bytes } = await qrandomIo({ fetch }).getBytes(2500)
    expect(bytes.length).toBe(2500)
    expect(calls.map((c) => Number(new URL(c.url).searchParams.get('n')))).toEqual([
      1000, 1000, 500,
    ])
  })

  test('maps out-of-range numbers to bad_response', async () => {
    const { fetch } = mockFetch(() => jsonResponse({ numbers: [1, 999] }))
    const err = (await qrandomIo({ fetch })
      .getBytes(2)
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('bad_response')
  })

  test('maps missing numbers array to bad_response', async () => {
    const { fetch } = mockFetch(() => jsonResponse({ resultType: 'oops' }))
    const err = (await qrandomIo({ fetch })
      .getBytes(2)
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('bad_response')
  })
})
