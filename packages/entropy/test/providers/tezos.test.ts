import { describe, expect, test } from 'bun:test'
import { tezosBeacon } from '../../src/providers/tezos.js'
import { jsonResponse, mockFetch } from '../helpers/mock-fetch.js'
import { providerContract } from '../helpers/provider-contract.js'

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function base58Encode(bytes: Uint8Array): string {
  const digits: number[] = []
  for (const byte of bytes) {
    let carry = byte
    for (let i = 0; i < digits.length; i++) {
      const acc = (digits[i] as number) * 256 + carry
      digits[i] = acc % 58
      carry = Math.floor(acc / 58)
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = Math.floor(carry / 58)
    }
  }
  let zeros = 0
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++
  return (
    '1'.repeat(zeros) +
    digits
      .reverse()
      .map((d) => BASE58_ALPHABET[d])
      .join('')
  )
}

/** Build a valid Tezos block hash: base58check(prefix [1,52] + 32 payload bytes). */
async function blockHashFor(level: number): Promise<string> {
  const payload = new Uint8Array(34)
  payload[0] = 1
  payload[1] = 52
  for (let i = 0; i < 32; i++) payload[2 + i] = (level + i) & 0xff
  const first = new Uint8Array(await crypto.subtle.digest('SHA-256', payload))
  const second = new Uint8Array(await crypto.subtle.digest('SHA-256', first))
  const full = new Uint8Array(38)
  full.set(payload, 0)
  full.set(second.slice(0, 4), 34)
  return base58Encode(full)
}

async function tezosMock(headLevel = 700) {
  const hashes = new Map<number, string>()
  for (let level = headLevel - 10; level <= headLevel + 10; level++) {
    hashes.set(level, await blockHashFor(level))
  }
  let head = headLevel
  const mock = mockFetch((req) => {
    if (req.url.endsWith('/v1/head')) {
      return jsonResponse({ hash: hashes.get(head), level: head })
    }
    const match = req.url.match(/\/v1\/blocks\/(\d+)$/)
    if (match) {
      const level = Number(match[1])
      return jsonResponse({ hash: hashes.get(level), level })
    }
    return new Response('not found', { status: 404 })
  })
  return { ...mock, advance: () => head++ }
}

providerContract(
  'tezosBeacon',
  () => {
    // contract factory must be sync; pre-build the mock via a lazy fetch
    let inner: Awaited<ReturnType<typeof tezosMock>> | null = null
    const lazyFetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!inner) inner = await tezosMock()
      return inner.fetch(input, init)
    }) as typeof fetch
    return tezosBeacon({ fetch: lazyFetch, pollIntervalMs: 1 })
  },
  { kind: 'beacon', privacy: 'public', lengths: [1, 16, 70], streamChunkBytes: 8 },
)

describe('tezosBeacon', () => {
  test('decodes and checksum-verifies the head hash payload', async () => {
    const mock = await tezosMock(700)
    const { bytes } = await tezosBeacon({ fetch: mock.fetch }).getBytes(32)
    const expected = new Uint8Array(32)
    for (let i = 0; i < 32; i++) expected[i] = (700 + i) & 0xff
    expect(bytes).toEqual(expected)
    expect(mock.calls[0]?.url).toBe('https://api.tzkt.io/v1/head')
  })

  test('walks levels backwards for larger requests', async () => {
    const mock = await tezosMock(700)
    const { bytes } = await tezosBeacon({ fetch: mock.fetch }).getBytes(70)
    expect(bytes.length).toBe(70)
    expect(mock.calls.map((c) => c.url.split('tzkt.io')[1])).toEqual([
      '/v1/head',
      '/v1/blocks/699',
      '/v1/blocks/698',
    ])
  })

  test('rejects hashes with a corrupted checksum', async () => {
    const good = await blockHashFor(1)
    const lastChar = good.at(-1)
    const swapped = good.slice(0, -1) + (lastChar === '2' ? '3' : '2')
    const { fetch } = mockFetch(() => jsonResponse({ hash: swapped, level: 1 }))
    const err = await tezosBeacon({ fetch })
      .getBytes(8)
      .catch((e) => e)
    expect((err as { code?: string }).code).toBe('bad_response')
  })
})
