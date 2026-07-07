import { describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import { fetchJson } from '../../src/internal/http.js'
import { jsonResponse, mockFetch } from '../helpers/mock-fetch.js'

const URL_ = 'https://api.example.com/random'

describe('fetchJson', () => {
  test('returns parsed JSON on 200', async () => {
    const { fetch } = mockFetch(() => jsonResponse({ ok: true, data: [1, 2, 3] }))
    const result = await fetchJson<{ ok: boolean; data: number[] }>(URL_, {
      provider: 'test',
      fetchImpl: fetch,
    })
    expect(result).toEqual({ ok: true, data: [1, 2, 3] })
  })

  test('sends method, headers and JSON body', async () => {
    const { fetch, calls } = mockFetch(() => jsonResponse({}))
    await fetchJson(URL_, {
      provider: 'test',
      fetchImpl: fetch,
      method: 'POST',
      headers: { 'x-api-key': 'k123' },
      body: { length: 8 },
    })
    expect(calls).toHaveLength(1)
    const call = calls[0]
    expect(call?.method).toBe('POST')
    expect(call?.headers.get('x-api-key')).toBe('k123')
    expect(call?.headers.get('content-type')).toBe('application/json')
    expect(call?.body).toBe('{"length":8}')
  })

  test('maps 429 to rate_limited with Retry-After seconds', async () => {
    const { fetch } = mockFetch(
      () => new Response('slow down', { status: 429, headers: { 'retry-after': '2' } }),
    )
    const err = (await fetchJson(URL_, { provider: 'test', fetchImpl: fetch }).catch(
      (e) => e,
    )) as EntropyError
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.code).toBe('rate_limited')
    expect(err.retryAfterMs).toBe(2000)
    expect(err.provider).toBe('test')
  })

  test('maps 401 and 403 to auth', async () => {
    for (const status of [401, 403]) {
      const { fetch } = mockFetch(() => new Response('no', { status }))
      const err = (await fetchJson(URL_, { provider: 'test', fetchImpl: fetch }).catch(
        (e) => e,
      )) as EntropyError
      expect(err.code).toBe('auth')
    }
  })

  test('maps other non-2xx to network', async () => {
    const { fetch } = mockFetch(() => new Response('boom', { status: 500 }))
    const err = (await fetchJson(URL_, { provider: 'test', fetchImpl: fetch }).catch(
      (e) => e,
    )) as EntropyError
    expect(err.code).toBe('network')
    expect(err.message).toContain('500')
  })

  test('onErrorResponse hook can override the default mapping', async () => {
    const { fetch } = mockFetch(
      () => new Response('The QRNG API is limited to 1 requests per minute.', { status: 500 }),
    )
    const err = (await fetchJson(URL_, {
      provider: 'anu-legacy',
      fetchImpl: fetch,
      onErrorResponse: (status, body) =>
        status === 500 && body.includes('limited to 1 requests per minute')
          ? new EntropyError('rate_limited', 'ANU legacy rate limit', {
              provider: 'anu-legacy',
              retryAfterMs: 60_000,
            })
          : undefined,
    }).catch((e) => e)) as EntropyError
    expect(err.code).toBe('rate_limited')
    expect(err.retryAfterMs).toBe(60_000)
  })

  test('maps unparseable 2xx bodies to bad_response', async () => {
    const { fetch } = mockFetch(() => new Response('<html>not json</html>', { status: 200 }))
    const err = (await fetchJson(URL_, { provider: 'test', fetchImpl: fetch }).catch(
      (e) => e,
    )) as EntropyError
    expect(err.code).toBe('bad_response')
  })

  test('wraps transport failures as network with cause', async () => {
    const boom = new TypeError('fetch failed')
    const failingFetch = (() => Promise.reject(boom)) as unknown as typeof fetch
    const err = (await fetchJson(URL_, { provider: 'test', fetchImpl: failingFetch }).catch(
      (e) => e,
    )) as EntropyError
    expect(err.code).toBe('network')
    expect(err.cause).toBe(boom)
  })

  test('lets abort reasons pass through unwrapped', async () => {
    const { fetch } = mockFetch(() => jsonResponse({}))
    const err = await fetchJson(URL_, {
      provider: 'test',
      fetchImpl: fetch,
      signal: AbortSignal.abort(),
    }).catch((e) => e)
    expect(err).not.toBeInstanceOf(EntropyError)
    expect((err as Error).name).toBe('AbortError')
  })
})
