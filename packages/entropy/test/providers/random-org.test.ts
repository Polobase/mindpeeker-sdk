import { describe, expect, test } from 'bun:test'
import type { EntropyError } from '../../src/errors.js'
import { randomOrg } from '../../src/providers/random-org.js'
import { jsonResponse, mockFetch } from '../helpers/mock-fetch.js'
import { providerContract } from '../helpers/provider-contract.js'

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 4096) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 4096))
  }
  return btoa(binary)
}

interface RpcRequest {
  jsonrpc: string
  method: string
  params: { apiKey: string; n: number; size: number; format: string }
  id: number
}

function randomOrgMock(advisoryDelay = 0) {
  return mockFetch((req) => {
    const body = JSON.parse(req.body ?? '{}') as RpcRequest
    const byteCount = (body.params.n * body.params.size) / 8
    const bytes = new Uint8Array(byteCount)
    for (let i = 0; i < byteCount; i++) bytes[i] = (i * 5) % 256
    return jsonResponse({
      jsonrpc: '2.0',
      result: {
        random: { data: [bytesToBase64(bytes)], completionTime: '2026-07-06 00:00:00Z' },
        bitsUsed: body.params.size,
        bitsLeft: 1000,
        requestsLeft: 10,
        advisoryDelay,
      },
      id: body.id,
    })
  })
}

providerContract('randomOrg', () => randomOrg({ apiKey: 'k', fetch: randomOrgMock().fetch }), {
  kind: 'trng',
  privacy: 'private',
  // 140_000 forces chunking across the 131_072-byte (2^20-bit) blob cap
  lengths: [1, 16, 140_000],
})

describe('randomOrg', () => {
  test('requires an apiKey', () => {
    expect(() => randomOrg({ apiKey: '' })).toThrow(TypeError)
  })

  test('is named random.org with kind trng', () => {
    const p = randomOrg({ apiKey: 'k' })
    expect(p.name).toBe('random.org')
    expect(p.kind).toBe('trng')
  })

  test('sends a generateBlobs JSON-RPC request', async () => {
    const { fetch, calls } = randomOrgMock()
    const { bytes } = await randomOrg({ apiKey: 'key123', fetch }).getBytes(16)
    expect(bytes.length).toBe(16)
    expect(bytes).toEqual(new Uint8Array(Array.from({ length: 16 }, (_, i) => (i * 5) % 256)))
    const call = calls[0]
    expect(call?.url).toBe('https://api.random.org/json-rpc/4/invoke')
    const body = JSON.parse(call?.body ?? '{}') as RpcRequest
    expect(body.jsonrpc).toBe('2.0')
    expect(body.method).toBe('generateBlobs')
    expect(body.params).toEqual({ apiKey: 'key123', n: 1, size: 128, format: 'base64' })
    expect(typeof body.id).toBe('number')
  })

  test('honors advisoryDelay between requests', async () => {
    const { fetch } = randomOrgMock(50)
    const p = randomOrg({ apiKey: 'k', fetch })
    const start = Date.now()
    await p.getBytes(4)
    await p.getBytes(4)
    expect(Date.now() - start).toBeGreaterThanOrEqual(45)
  })

  test('maps quota errors (402/403) to rate_limited', async () => {
    for (const code of [402, 403]) {
      const { fetch } = mockFetch(() =>
        jsonResponse({ jsonrpc: '2.0', error: { code, message: 'allowance exceeded' }, id: 1 }),
      )
      const err = (await randomOrg({ apiKey: 'k', fetch })
        .getBytes(4)
        .catch((e) => e)) as EntropyError
      expect(err.code).toBe('rate_limited')
    }
  })

  test('maps key errors (400/401) to auth', async () => {
    for (const code of [400, 401]) {
      const { fetch } = mockFetch(() =>
        jsonResponse({ jsonrpc: '2.0', error: { code, message: 'bad key' }, id: 1 }),
      )
      const err = (await randomOrg({ apiKey: 'k', fetch })
        .getBytes(4)
        .catch((e) => e)) as EntropyError
      expect(err.code).toBe('auth')
    }
  })

  test('maps other RPC errors to bad_response', async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse({ jsonrpc: '2.0', error: { code: -32600, message: 'invalid' }, id: 1 }),
    )
    const err = (await randomOrg({ apiKey: 'k', fetch })
      .getBytes(4)
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('bad_response')
  })

  test('maps invalid base64 to bad_response', async () => {
    const { fetch } = mockFetch((req) => {
      const body = JSON.parse(req.body ?? '{}') as RpcRequest
      return jsonResponse({
        jsonrpc: '2.0',
        result: { random: { data: ['!!!'] }, advisoryDelay: 0 },
        id: body.id,
      })
    })
    const err = (await randomOrg({ apiKey: 'k', fetch })
      .getBytes(4)
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('bad_response')
  })
})
