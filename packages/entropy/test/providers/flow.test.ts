import { describe, expect, test } from 'bun:test'
import { flowBeacon } from '../../src/providers/flow.js'
import { rejectedEntropyError, thrownEntropyError } from '../helpers/errors.js'
import { mockFetch } from '../helpers/mock-fetch.js'
import { providerContract } from '../helpers/provider-contract.js'

/** Flow script responses are double-encoded: JSON string of base64 of JSON-Cadence. */
function flowResponse(value: bigint): Response {
  const cadence = `${JSON.stringify({ value: value.toString(), type: 'UInt64' })}\n`
  return new Response(JSON.stringify(btoa(cadence)), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function flowMock() {
  let draw = 0xdeadbeef_0000n
  return mockFetch(() => flowResponse(draw++))
}

providerContract('flowBeacon', () => flowBeacon({ fetch: flowMock().fetch, retryDelayMs: 1 }), {
  kind: 'beacon',
  privacy: 'public',
  lengths: [1, 8, 20],
  streamChunkBytes: 8,
})

describe('flowBeacon', () => {
  test('is named flow, public beacon, 8-byte unit', () => {
    const p = flowBeacon()
    expect(p.name).toBe('flow')
    expect(p.privacy).toBe('public')
  })

  test('POSTs the revertibleRandom Cadence script', async () => {
    const mock = flowMock()
    await flowBeacon({ fetch: mock.fetch }).getBytes(8)
    expect(mock.calls[0]?.url).toBe(
      'https://rest-mainnet.onflow.org/v1/scripts?block_height=sealed',
    )
    const body = JSON.parse(mock.calls[0]?.body ?? '{}') as { script: string; arguments: unknown[] }
    expect(atob(body.script)).toContain('revertibleRandom')
    expect(body.arguments).toEqual([])
  })

  test('decodes the double-encoded UInt64 into 8 big-endian bytes', async () => {
    const { fetch } = mockFetch(() => flowResponse(0x0102030405060708n))
    const { bytes } = await flowBeacon({ fetch, retryDelayMs: 1 }).getBytes(8)
    expect(bytes).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
  })

  test('retries when consecutive draws are identical (per-block determinism guard)', async () => {
    let calls = 0
    const { fetch } = mockFetch(() => {
      calls++
      // first two draws identical, then a fresh one
      return flowResponse(calls <= 2 ? 111n : 222n)
    })
    const { bytes } = await flowBeacon({ fetch, retryDelayMs: 1 }).getBytes(16)
    expect(calls).toBe(3)
    expect(bytes.slice(0, 8)).toEqual(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 111]))
    expect(bytes.slice(8)).toEqual(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 222]))
  })

  test('maps malformed Cadence payloads to bad_response', async () => {
    const { fetch } = mockFetch(
      () =>
        new Response(JSON.stringify(btoa('{"value":"x","type":"String"}')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const err = await flowBeacon({ fetch })
      .getBytes(8)
      .catch((e) => e)
    expect((err as { code?: string }).code).toBe('bad_response')
  })

  test('rejects UInt64 values that are negative, too large or not plain decimals', async () => {
    for (const value of [
      '-1',
      '18446744073709551616',
      '340282366920938463463374607431768211457',
      '0x10',
      '1e3',
    ]) {
      const cadence = `${JSON.stringify({ value, type: 'UInt64' })}\n`
      const { fetch } = mockFetch(
        () =>
          new Response(JSON.stringify(btoa(cadence)), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      )
      await rejectedEntropyError(flowBeacon({ fetch, retryDelayMs: 1 }).getBytes(8), 'bad_response')
    }
  })

  test('accepts the UInt64 maximum', async () => {
    const { fetch } = mockFetch(() => flowResponse(2n ** 64n - 1n))
    const { bytes } = await flowBeacon({ fetch, retryDelayMs: 1 }).getBytes(8)
    expect(bytes).toEqual(new Uint8Array(8).fill(255))
  })

  test('retryDelayMs must be > 0 and baseUrls non-empty', () => {
    thrownEntropyError(() => flowBeacon({ retryDelayMs: 0 }), 'invalid_request')
    thrownEntropyError(() => flowBeacon({ baseUrls: [] }), 'invalid_request')
  })
})
