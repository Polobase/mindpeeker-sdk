import { describe, expect, test } from 'bun:test'
import { solanaBeacon } from '../../src/providers/solana.js'
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

function hashBytesFor(slot: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) out[i] = (slot * 7 + i) & 0xff
  return out
}

function solanaMock(startSlot = 1000, advanceEveryCall = true) {
  let slot = startSlot
  const mock = mockFetch((req) => {
    const body = JSON.parse(req.body ?? '{}') as { method?: string }
    if (body.method !== 'getLatestBlockhash') return new Response('bad', { status: 400 })
    const response = jsonResponse({
      jsonrpc: '2.0',
      id: 1,
      result: {
        context: { slot },
        value: { blockhash: base58Encode(hashBytesFor(slot)), lastValidBlockHeight: 1 },
      },
    })
    if (advanceEveryCall) slot++
    return response
  })
  return { ...mock, advance: () => slot++ }
}

providerContract(
  'solanaBeacon',
  () => solanaBeacon({ fetch: solanaMock().fetch, pollIntervalMs: 1 }),
  { kind: 'beacon', privacy: 'public', lengths: [1, 16, 70], streamChunkBytes: 8 },
)

describe('solanaBeacon', () => {
  test('sends a getLatestBlockhash JSON-RPC request and decodes base58', async () => {
    const mock = solanaMock(1234)
    const { bytes } = await solanaBeacon({ fetch: mock.fetch }).getBytes(32)
    expect(bytes).toEqual(hashBytesFor(1234))
    expect(mock.calls[0]?.url).toBe('https://api.mainnet-beta.solana.com/')
    expect(JSON.parse(mock.calls[0]?.body ?? '{}').method).toBe('getLatestBlockhash')
  })

  test('aggregates across slots, waiting out repeats', async () => {
    // mock repeats each slot once before advancing
    let calls = 0
    let slot = 50
    const { fetch } = mockFetch(() => {
      calls++
      if (calls % 2 === 0) slot++
      return jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: { context: { slot }, value: { blockhash: base58Encode(hashBytesFor(slot)) } },
      })
    })
    const { bytes } = await solanaBeacon({ fetch, pollIntervalMs: 1 }).getBytes(64)
    expect(bytes.slice(0, 32)).toEqual(hashBytesFor(50))
    expect(bytes.slice(32)).toEqual(hashBytesFor(51))
  })

  test('rejects blockhashes that do not decode to 32 bytes', async () => {
    const { fetch } = mockFetch(() =>
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: { context: { slot: 1 }, value: { blockhash: '2g' } },
      }),
    )
    const err = await solanaBeacon({ fetch })
      .getBytes(8)
      .catch((e) => e)
    expect((err as { code?: string }).code).toBe('bad_response')
  })
})
