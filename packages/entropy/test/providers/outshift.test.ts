import { describe, expect, test } from 'bun:test'
import type { EntropyError } from '../../src/errors.js'
import { outshift } from '../../src/providers/outshift.js'
import { jsonResponse, mockFetch } from '../helpers/mock-fetch.js'
import { providerContract } from '../helpers/provider-contract.js'

function outshiftMock() {
  return mockFetch((req) => {
    const body = JSON.parse(req.body ?? '{}') as { number_of_blocks: number }
    const n = body.number_of_blocks
    return jsonResponse({
      encoding: 'raw',
      random_numbers: Array.from({ length: n }, (_, i) => {
        const value = (i * 11) % 256
        return {
          binary: value.toString(2).padStart(8, '0'),
          octal: value.toString(8),
          decimal: String(value),
          hexadecimal: value.toString(16),
        }
      }),
    })
  })
}

providerContract('outshift', () => outshift({ apiKey: 'k', fetch: outshiftMock().fetch }), {
  kind: 'qrng',
  privacy: 'private',
  // 2500 forces chunking across the 1000-numbers-per-call cap
  lengths: [1, 16, 2500],
})

describe('outshift', () => {
  test('requires an apiKey', () => {
    expect(() => outshift({ apiKey: '' })).toThrow(TypeError)
  })

  test('is named outshift', () => {
    expect(outshift({ apiKey: 'k' }).name).toBe('outshift')
  })

  test('POSTs 8-bit blocks with the x-id-api-key header', async () => {
    const { fetch, calls } = outshiftMock()
    const { bytes } = await outshift({ apiKey: 'secret', fetch }).getBytes(3)
    expect(bytes).toEqual(new Uint8Array([0, 11, 22]))
    const call = calls[0]
    expect(call?.url).toBe('https://api.qrng.outshift.com/api/v1/random_numbers')
    expect(call?.method).toBe('POST')
    expect(call?.headers.get('x-id-api-key')).toBe('secret')
    expect(JSON.parse(call?.body ?? '{}')).toEqual({
      encoding: 'raw',
      format: 'all',
      bits_per_block: 8,
      number_of_blocks: 3,
    })
  })

  test('chunks across the 1000-blocks cap', async () => {
    const { fetch, calls } = outshiftMock()
    await outshift({ apiKey: 'k', fetch }).getBytes(2500)
    expect(
      calls.map(
        (c) => (JSON.parse(c.body ?? '{}') as { number_of_blocks: number }).number_of_blocks,
      ),
    ).toEqual([1000, 1000, 500])
  })

  test('maps out-of-range decimals to bad_response', async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse({ random_numbers: [{ decimal: '999' }, { decimal: '1' }] }),
    )
    const err = (await outshift({ apiKey: 'k', fetch })
      .getBytes(2)
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('bad_response')
  })

  test('maps a missing random_numbers array to bad_response', async () => {
    const { fetch } = mockFetch(() => jsonResponse({ encoding: 'raw' }))
    const err = (await outshift({ apiKey: 'k', fetch })
      .getBytes(2)
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('bad_response')
  })
})
