import { describe, expect, test } from 'bun:test'
import type { EntropyError } from '../../src/errors.js'
import { qci } from '../../src/providers/qci.js'
import { jsonResponse, mockFetch } from '../helpers/mock-fetch.js'
import { providerContract } from '../helpers/provider-contract.js'

interface QciDataRequest {
  distribution: string
  output_type: string
  n_samples: number
  n_bits: number
}

/**
 * Simulates QCi's two-step flow: token exchange at /auth/v1/access-tokens,
 * then bearer-authenticated /qrng/random_numbers returning a raw array.
 */
function qciMock(opts: { failFirstDataCalls?: number } = {}) {
  let issuedTokens = 0
  let failuresLeft = opts.failFirstDataCalls ?? 0
  const mock = mockFetch((req) => {
    if (req.url.endsWith('/auth/v1/access-tokens')) {
      issuedTokens++
      return jsonResponse({
        access_token: `token-${issuedTokens}`,
        expires_in: 3600,
        scope: 'access_token',
        token_type: 'bearer',
      })
    }
    if (failuresLeft > 0) {
      failuresLeft--
      return new Response('{"detail":"Not authenticated"}', { status: 401 })
    }
    const body = JSON.parse(req.body ?? '{}') as QciDataRequest
    return jsonResponse(Array.from({ length: body.n_samples }, (_, i) => (i * 9) % 256))
  })
  return { ...mock, issuedTokens: () => issuedTokens }
}

providerContract('qci', () => qci({ apiToken: 't', fetch: qciMock().fetch }), {
  kind: 'qrng',
  privacy: 'private',
})

describe('qci', () => {
  test('requires an apiToken', () => {
    expect(() => qci({ apiToken: '' })).toThrow(TypeError)
  })

  test('is named qci', () => {
    expect(qci({ apiToken: 't' }).name).toBe('qci')
  })

  test('exchanges the refresh token once and reuses the bearer token', async () => {
    const mock = qciMock()
    const p = qci({ apiToken: 'refresh-me', fetch: mock.fetch })
    await p.getBytes(4)
    await p.getBytes(4)
    // 1 auth call + 2 data calls
    expect(mock.calls).toHaveLength(3)
    expect(mock.issuedTokens()).toBe(1)
    const authCall = mock.calls[0]
    expect(authCall?.url).toBe('https://api.qci-prod.com/auth/v1/access-tokens')
    expect(JSON.parse(authCall?.body ?? '{}')).toEqual({ refresh_token: 'refresh-me' })
    expect(mock.calls[1]?.headers.get('authorization')).toBe('Bearer token-1')
  })

  test('requests uniform 8-bit samples and parses the raw array', async () => {
    const mock = qciMock()
    const { bytes } = await qci({ apiToken: 't', fetch: mock.fetch }).getBytes(3)
    expect(bytes).toEqual(new Uint8Array([0, 9, 18]))
    const dataCall = mock.calls[1]
    expect(dataCall?.url).toBe('https://api.qci-prod.com/qrng/random_numbers')
    expect(JSON.parse(dataCall?.body ?? '{}')).toEqual({
      distribution: 'uniform_discrete',
      output_type: 'decimal',
      n_samples: 3,
      n_bits: 8,
    })
  })

  test('re-authenticates once on a 401 and retries', async () => {
    const mock = qciMock({ failFirstDataCalls: 1 })
    const { bytes } = await qci({ apiToken: 't', fetch: mock.fetch }).getBytes(2)
    expect(bytes.length).toBe(2)
    // auth, data(401), auth, data(200)
    expect(mock.issuedTokens()).toBe(2)
    expect(mock.calls[3]?.headers.get('authorization')).toBe('Bearer token-2')
  })

  test('gives up with auth after the second consecutive 401', async () => {
    const mock = qciMock({ failFirstDataCalls: 2 })
    const err = (await qci({ apiToken: 't', fetch: mock.fetch })
      .getBytes(2)
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('auth')
  })

  test('maps a non-array response to bad_response', async () => {
    const { fetch } = mockFetch((req) =>
      req.url.endsWith('/auth/v1/access-tokens')
        ? jsonResponse({ access_token: 't', expires_in: 3600 })
        : jsonResponse({ oops: true }),
    )
    const err = (await qci({ apiToken: 't', fetch })
      .getBytes(2)
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('bad_response')
  })
})
