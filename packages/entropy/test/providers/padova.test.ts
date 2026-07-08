import { describe, expect, test } from 'bun:test'
import type { EntropyError } from '../../src/errors.js'
import { padova } from '../../src/providers/padova.js'
import { jsonResponse, mockFetch } from '../helpers/mock-fetch.js'
import { providerContract } from '../helpers/provider-contract.js'

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function padovaMock() {
  let state = 0x8badf00d
  return mockFetch((req) => {
    const url = new URL(req.url)
    const n = Number(url.searchParams.get('string_length'))
    const bytes = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      state >>>= 0
      bytes[i] = state & 0xff
    }
    return jsonResponse({ string: bytesToBase64(bytes) })
  })
}

providerContract('padova', () => padova({ fetch: padovaMock().fetch }), {
  kind: 'qrng',
  privacy: 'private',
  // 600 forces chunking across the conservative 256-per-request cap
  lengths: [1, 16, 600],
})

describe('padova', () => {
  test('is named padova, private qrng', () => {
    const p = padova()
    expect(p.name).toBe('padova')
    expect(p.kind).toBe('qrng')
    expect(p.privacy).toBe('private')
  })

  test('requests base64 strings with string_length and chunks at 256', async () => {
    const mock = padovaMock()
    const { bytes } = await padova({ fetch: mock.fetch }).getBytes(600)
    expect(bytes.length).toBe(600)
    expect(mock.calls.map((c) => Number(new URL(c.url).searchParams.get('string_length')))).toEqual(
      [256, 256, 88],
    )
    expect(mock.calls[0]?.url.startsWith('https://qrng-qtech.vs-ix.net/api/get_string_get?')).toBe(
      true,
    )
  })

  test('maps a wrong-length payload to bad_response', async () => {
    const { fetch } = mockFetch(() => jsonResponse({ string: btoa('ab') }))
    const err = (await padova({ fetch })
      .getBytes(8)
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('bad_response')
  })

  test('maps a missing string field to bad_response', async () => {
    const { fetch } = mockFetch(() => jsonResponse({ oops: true }))
    const err = (await padova({ fetch })
      .getBytes(8)
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('bad_response')
  })
})
