import { describe, expect, test } from 'bun:test'
import type { EntropyError } from '../../src/errors.js'
import { qbck } from '../../src/providers/qbck.js'
import { jsonResponse, mockFetch } from '../helpers/mock-fetch.js'
import { providerContract } from '../helpers/provider-contract.js'

/** Serves size-N requests as an array of N single-byte hex strings. */
function qbckMock() {
  let counter = 0
  return mockFetch((req) => {
    const url = new URL(req.url)
    const n = Number(url.searchParams.get('size'))
    const result = Array.from({ length: n }, () =>
      ((counter++ * 37) % 256).toString(16).padStart(2, '0'),
    )
    return jsonResponse({ data: { result } })
  })
}

providerContract('qbck', () => qbck({ apiKey: 'test-uuid', fetch: qbckMock().fetch }), {
  kind: 'qrng',
  privacy: 'private',
  lengths: [1, 16, 600],
})

describe('qbck', () => {
  test('requires an apiKey', () => {
    expect(() => qbck({ apiKey: '' })).toThrow(TypeError)
  })

  test('builds the documented key-in-path URL pattern', async () => {
    const mock = qbckMock()
    await qbck({ apiKey: 'my-uuid', fetch: mock.fetch }).getBytes(4)
    expect(mock.calls[0]?.url).toBe('https://qrng.qbck.io/my-uuid/qbck/block/hex?size=4')
  })

  test('accepts a single hex string result too', async () => {
    const { fetch } = mockFetch(() => jsonResponse({ data: { result: 'deadbeef' } }))
    const { bytes } = await qbck({ apiKey: 'k', fetch }).getBytes(4)
    expect(bytes).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
  })

  test('maps wrong byte counts to bad_response', async () => {
    const { fetch } = mockFetch(() => jsonResponse({ data: { result: ['aa'] } }))
    const err = (await qbck({ apiKey: 'k', fetch })
      .getBytes(4)
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('bad_response')
  })

  test('maps an error field in a 200 response to bad_response', async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse({ error: 'Not Found', message: 'Wrong key', status: 404 }),
    )
    const err = (await qbck({ apiKey: 'k', fetch })
      .getBytes(4)
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('bad_response')
    expect(err.message).toContain('Wrong key')
  })
})
