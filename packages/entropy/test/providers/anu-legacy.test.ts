import { describe, expect, test } from 'bun:test'
import type { EntropyError } from '../../src/errors.js'
import { anuLegacy } from '../../src/providers/anu-legacy.js'
import { jsonResponse, mockFetch } from '../helpers/mock-fetch.js'
import { providerContract } from '../helpers/provider-contract.js'

function anuLegacyMock() {
  return mockFetch((req) => {
    const url = new URL(req.url)
    const n = Number(url.searchParams.get('length'))
    return jsonResponse({
      type: 'uint8',
      length: n,
      data: Array.from({ length: n }, (_, i) => (i * 7) % 256),
      success: true,
    })
  })
}

providerContract('anuLegacy', () => anuLegacy({ fetch: anuLegacyMock().fetch, minIntervalMs: 0 }), {
  kind: 'qrng',
  privacy: 'private',
  lengths: [1, 16, 2500],
})

describe('anuLegacy', () => {
  test('is named anu-legacy and needs no key', () => {
    const p = anuLegacy({ minIntervalMs: 0 })
    expect(p.name).toBe('anu-legacy')
    expect(p.kind).toBe('qrng')
  })

  test('calls the legacy jsonI.php endpoint', async () => {
    const { fetch, calls } = anuLegacyMock()
    await anuLegacy({ fetch, minIntervalMs: 0 }).getBytes(3)
    const url = new URL(calls[0]?.url ?? '')
    expect(url.href.startsWith('https://qrng.anu.edu.au/API/jsonI.php?')).toBe(true)
    expect(url.searchParams.get('type')).toBe('uint8')
    expect(url.searchParams.get('length')).toBe('3')
  })

  test('enforces the minimum interval between requests', async () => {
    const { fetch } = anuLegacyMock()
    const p = anuLegacy({ fetch, minIntervalMs: 40 })
    const start = Date.now()
    await p.getBytes(2)
    await p.getBytes(2)
    expect(Date.now() - start).toBeGreaterThanOrEqual(35)
  })

  test('maps the 1-request-per-minute HTTP 500 to rate_limited', async () => {
    const { fetch } = mockFetch(
      () =>
        new Response(
          'The QRNG API is limited to 1 requests per minute. For more requests, please visit https://quantumnumbers.anu.edu.au',
          { status: 500 },
        ),
    )
    const err = (await anuLegacy({ fetch, minIntervalMs: 0 })
      .getBytes(4)
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('rate_limited')
    expect(err.retryAfterMs).toBe(60_000)
  })

  test('other 500s stay network errors', async () => {
    const { fetch } = mockFetch(() => new Response('internal error', { status: 500 }))
    const err = (await anuLegacy({ fetch, minIntervalMs: 0 })
      .getBytes(4)
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('network')
  })
})
