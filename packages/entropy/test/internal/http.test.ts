import { describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import {
  fetchJson,
  fetchText,
  parseRetryAfter,
  redactText,
  redactUrl,
} from '../../src/internal/http.js'
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
    expect((err as Error).name).toMatch(/AbortError/)
  })
})

describe('fetchText', () => {
  test('returns the response body as text on 200', async () => {
    const { fetch } = mockFetch(() => new Response('00000000000000000001abc\n', { status: 200 }))
    const text = await fetchText(URL_, { provider: 'test', fetchImpl: fetch })
    expect(text).toBe('00000000000000000001abc\n')
  })

  test('maps non-2xx with the same taxonomy as fetchJson', async () => {
    const { fetch } = mockFetch(
      () => new Response('slow down', { status: 429, headers: { 'retry-after': '3' } }),
    )
    const err = (await fetchText(URL_, { provider: 'test', fetchImpl: fetch }).catch(
      (e) => e,
    )) as EntropyError
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.code).toBe('rate_limited')
    expect(err.retryAfterMs).toBe(3000)
  })

  test('abort passthrough holds for fetchText too', async () => {
    const { fetch } = mockFetch(() => jsonResponse({}))
    const err = await fetchText(URL_, {
      provider: 'test',
      fetchImpl: fetch,
      signal: AbortSignal.abort(),
    }).catch((e) => e)
    expect(err).not.toBeInstanceOf(EntropyError)
    expect((err as Error).name).toBe('AbortError')
  })
})

describe('body-read aborts', () => {
  /** A 200 response whose body stream errors with the signal's reason once it aborts. */
  function abortableBodyFetch(): typeof fetch {
    return ((input: RequestInfo | URL, init?: RequestInit) => {
      const signal = new Request(input, init).signal
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"partial":'))
          signal.addEventListener('abort', () => controller.error(signal.reason))
        },
      })
      return Promise.resolve(new Response(body, { status: 200 }))
    }) as typeof fetch
  }

  test('an abort during the JSON body read passes through instead of becoming bad_response', async () => {
    for (const read of [fetchJson, fetchText]) {
      const controller = new AbortController()
      const pending = read(URL_, {
        provider: 'test',
        fetchImpl: abortableBodyFetch(),
        signal: controller.signal,
      })
      setTimeout(() => controller.abort(), 10)
      const err = await pending.catch((e) => e)
      expect(err).not.toBeInstanceOf(EntropyError)
      expect((err as Error).name).toBe('AbortError')
    }
  })

  test('a timeout during the body read passes through as TimeoutError', async () => {
    const err = await fetchJson(URL_, {
      provider: 'test',
      fetchImpl: abortableBodyFetch(),
      signal: AbortSignal.timeout(10),
    }).catch((e) => e)
    expect(err).not.toBeInstanceOf(EntropyError)
    expect((err as Error).name).toBe('TimeoutError')
  })
})

describe('redaction', () => {
  test('redactUrl drops the query string and masks UUID path segments and secrets', () => {
    expect(redactUrl('https://api.super-rand.io/v1/?key=SECRET')).toBe(
      'https://api.super-rand.io/v1/?…',
    )
    expect(
      redactUrl('https://qrng.qbck.io/6b1e65b9-4186-45c2-8981-b77a9842c4f0/qbck/block/hex?size=4'),
    ).toBe('https://qrng.qbck.io/***/qbck/block/hex?…')
    expect(redactUrl('https://proxy.example/tok-abcdef/x', ['tok-abcdef'])).toBe(
      'https://proxy.example/***/x',
    )
    expect(redactUrl('not a url?key=1', ['nothing'])).toBe('not a url?…')
    expect(redactUrl('https://api.drand.sh/v2/beacons/quicknet/rounds/5')).toBe(
      'https://api.drand.sh/v2/beacons/quicknet/rounds/5',
    )
  })

  test('redactText masks raw and URI-encoded secrets of 4+ characters only', () => {
    expect(redactText('key a+b/c= and a%2Bb%2Fc%3D', ['a+b/c='])).toBe('key *** and ***')
    expect(redactText('k is short', ['k'])).toBe('k is short')
  })

  test('HTTP error bodies echoing a secret are masked in the message', async () => {
    const { fetch } = mockFetch(() => new Response('bad key hunter22', { status: 401 }))
    const err = (await fetchJson(URL_, {
      provider: 'test',
      fetchImpl: fetch,
      secrets: ['hunter22'],
    }).catch((e) => e)) as EntropyError
    expect(err.code).toBe('auth')
    expect(err.message).toBe('HTTP 401: bad key ***')
  })
})

describe('parseRetryAfter', () => {
  const now = Date.UTC(2026, 9, 21, 7, 0, 0)

  test('delta-seconds, including decimals', () => {
    expect(parseRetryAfter('120', now)).toBe(120_000)
    expect(parseRetryAfter(' 2.5 ', now)).toBe(2500)
    expect(parseRetryAfter('0', now)).toBe(0)
  })

  test('HTTP-date (IMF-fixdate), never negative', () => {
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT', now)).toBe(28 * 60_000)
    expect(parseRetryAfter('Wed, 21 Oct 2026 06:00:00 GMT', now)).toBe(0)
  })

  test('absent, negative or garbage values are undefined', () => {
    for (const value of [null, '-3', '', 'soon', '1e3']) {
      expect(parseRetryAfter(value, now)).toBeUndefined()
    }
  })

  test('a 429 with an HTTP-date sets retryAfterMs', async () => {
    const date = new Date(Date.now() + 60_000).toUTCString()
    const { fetch } = mockFetch(
      () => new Response('slow', { status: 429, headers: { 'retry-after': date } }),
    )
    const err = (await fetchJson(URL_, { provider: 'test', fetchImpl: fetch }).catch(
      (e) => e,
    )) as EntropyError
    expect(err.retryAfterMs).toBeGreaterThan(55_000)
    expect(err.retryAfterMs).toBeLessThanOrEqual(60_000)
  })
})
