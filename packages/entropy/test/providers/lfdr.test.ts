import { describe, expect, test } from 'bun:test'
import type { EntropyError } from '../../src/errors.js'
import { lfdr } from '../../src/providers/lfdr.js'
import { jsonResponse, mockFetch } from '../helpers/mock-fetch.js'
import { providerContract } from '../helpers/provider-contract.js'

function lfdrMock() {
  return mockFetch((req) => {
    const url = new URL(req.url)
    const n = Number(url.searchParams.get('length'))
    const qrn = Array.from({ length: n }, (_, i) =>
      ((i * 13) % 256).toString(16).padStart(2, '0'),
    ).join('')
    return jsonResponse({ length: n, qrn })
  })
}

providerContract('lfdr', () => lfdr({ fetch: lfdrMock().fetch }), {
  kind: 'qrng',
  privacy: 'private',
  lengths: [1, 16, 2500],
})

describe('lfdr', () => {
  test('is named lfdr', () => {
    expect(lfdr().name).toBe('lfdr')
  })

  test('requests HEX format with byte length', async () => {
    const { fetch, calls } = lfdrMock()
    const { bytes } = await lfdr({ fetch }).getBytes(4)
    const url = new URL(calls[0]?.url ?? '')
    expect(url.href.startsWith('https://lfdr.de/qrng_api/qrng?')).toBe(true)
    expect(url.searchParams.get('length')).toBe('4')
    expect(url.searchParams.get('format')).toBe('HEX')
    expect(bytes).toEqual(new Uint8Array([0, 13, 26, 39]))
  })

  test('maps malformed hex to bad_response', async () => {
    const { fetch } = mockFetch(() => jsonResponse({ length: 4, qrn: 'zzzz' }))
    const err = (await lfdr({ fetch })
      .getBytes(2)
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('bad_response')
  })

  test('maps short responses to bad_response', async () => {
    const { fetch } = mockFetch(() => jsonResponse({ length: 4, qrn: 'ab' }))
    const err = (await lfdr({ fetch })
      .getBytes(4)
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('bad_response')
  })
})
