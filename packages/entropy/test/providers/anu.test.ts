import { describe, expect, test } from 'bun:test'
import type { EntropyError } from '../../src/errors.js'
import { anu } from '../../src/providers/anu.js'
import { jsonResponse, mockFetch } from '../helpers/mock-fetch.js'
import { providerContract } from '../helpers/provider-contract.js'

function anuMock() {
  return mockFetch((req) => {
    const url = new URL(req.url)
    const n = Number(url.searchParams.get('length'))
    return jsonResponse({
      success: true,
      type: 'uint8',
      length: n,
      data: Array.from({ length: n }, (_, i) => i % 256),
    })
  })
}

providerContract('anu', () => anu({ apiKey: 'k', fetch: anuMock().fetch }), {
  kind: 'qrng',
  privacy: 'private',
  // 2500 forces chunking across the 1024-per-request cap
  lengths: [1, 16, 2500],
})

describe('anu', () => {
  test('requires an apiKey', () => {
    expect(() => anu({ apiKey: '' })).toThrow(TypeError)
    // @ts-expect-error missing options entirely
    expect(() => anu()).toThrow(TypeError)
  })

  test('is named anu', () => {
    expect(anu({ apiKey: 'k' }).name).toBe('anu')
  })

  test('sends the x-api-key header and uint8 query', async () => {
    const { fetch, calls } = anuMock()
    await anu({ apiKey: 'secret', fetch }).getBytes(5)
    const url = new URL(calls[0]?.url ?? '')
    expect(url.origin).toBe('https://api.quantumnumbers.anu.edu.au')
    expect(url.searchParams.get('length')).toBe('5')
    expect(url.searchParams.get('type')).toBe('uint8')
    expect(calls[0]?.headers.get('x-api-key')).toBe('secret')
  })

  test('chunks large requests across the 1024 cap', async () => {
    const { fetch, calls } = anuMock()
    const { bytes } = await anu({ apiKey: 'k', fetch }).getBytes(2500)
    expect(bytes.length).toBe(2500)
    expect(calls.map((c) => Number(new URL(c.url).searchParams.get('length')))).toEqual([
      1024, 1024, 452,
    ])
  })

  test('maps success:false to bad_response', async () => {
    const { fetch } = mockFetch(() => jsonResponse({ success: false }))
    const err = (await anu({ apiKey: 'k', fetch })
      .getBytes(4)
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('bad_response')
  })

  test('maps short data arrays to bad_response', async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse({ success: true, type: 'uint8', length: 4, data: [1, 2] }),
    )
    const err = (await anu({ apiKey: 'k', fetch })
      .getBytes(4)
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('bad_response')
  })

  test('supports a baseUrl override', async () => {
    const { fetch, calls } = anuMock()
    await anu({ apiKey: 'k', fetch, baseUrl: 'https://proxy.example.com/anu' }).getBytes(2)
    expect(calls[0]?.url.startsWith('https://proxy.example.com/anu?')).toBe(true)
  })
})
