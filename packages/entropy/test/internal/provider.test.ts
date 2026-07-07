import { describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import { defineProvider } from '../../src/internal/provider.js'
import type { EntropyRequestOptions, EntropyResult } from '../../src/types.js'

const INFO = { name: 'stub', kind: 'csprng', privacy: 'private' } as const

function stubProvider(
  impl?: (length: number, opts?: EntropyRequestOptions) => Promise<EntropyResult>,
) {
  return defineProvider({
    ...INFO,
    getBytes:
      impl ??
      (async (length) => ({
        bytes: new Uint8Array(length).fill(1),
        sources: [INFO],
      })),
  })
}

describe('defineProvider', () => {
  test('exposes frozen name/kind/privacy metadata', () => {
    const p = stubProvider()
    expect(p.name).toBe('stub')
    expect(p.kind).toBe('csprng')
    expect(p.privacy).toBe('private')
    expect(Object.isFrozen(p)).toBe(true)
  })

  test('rejects zero, negative and non-integer lengths with invalid_request', async () => {
    const p = stubProvider()
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      const err = (await p.getBytes(bad).catch((e) => e)) as EntropyError
      expect(err).toBeInstanceOf(EntropyError)
      expect(err.code).toBe('invalid_request')
      expect(err.provider).toBe('stub')
    }
  })

  test('throws aborted for a pre-aborted signal without calling the impl', async () => {
    let called = false
    const p = stubProvider(async (length) => {
      called = true
      return { bytes: new Uint8Array(length), sources: [INFO] }
    })
    const err = (await p
      .getBytes(4, { signal: AbortSignal.abort() })
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('aborted')
    expect(called).toBe(false)
  })

  test('maps caller abort during flight to aborted', async () => {
    const controller = new AbortController()
    const p = stubProvider(
      (_length, opts) =>
        new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => reject(opts.signal?.reason))
        }),
    )
    const pending = p.getBytes(4, { signal: controller.signal })
    controller.abort()
    const err = (await pending.catch((e) => e)) as EntropyError
    expect(err.code).toBe('aborted')
  })

  test('maps timeoutMs expiry to timeout', async () => {
    const p = stubProvider(
      (_length, opts) =>
        new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => reject(opts.signal?.reason))
        }),
    )
    const err = (await p.getBytes(4, { timeoutMs: 20 }).catch((e) => e)) as EntropyError
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.code).toBe('timeout')
  })

  test('passes a composite signal to the impl', async () => {
    let seenSignal: AbortSignal | undefined
    const p = stubProvider(async (length, opts) => {
      seenSignal = opts?.signal
      return { bytes: new Uint8Array(length), sources: [INFO] }
    })
    await p.getBytes(4)
    expect(seenSignal).toBeInstanceOf(AbortSignal)
  })

  test('rethrows impl EntropyErrors unchanged', async () => {
    const original = new EntropyError('rate_limited', 'slow down', { retryAfterMs: 1000 })
    const p = stubProvider(async () => {
      throw original
    })
    const err = await p.getBytes(4).catch((e) => e)
    expect(err).toBe(original)
  })

  test('provides a default poll-based stream', async () => {
    const p = stubProvider()
    const out: Uint8Array[] = []
    for await (const chunk of p.stream({ chunkBytes: 4 })) {
      out.push(chunk)
      if (out.length === 2) break
    }
    expect(out).toEqual([new Uint8Array(4).fill(1), new Uint8Array(4).fill(1)])
  })

  test('uses a custom stream implementation when provided', async () => {
    const p = defineProvider({
      ...INFO,
      getBytes: async (length) => ({ bytes: new Uint8Array(length), sources: [INFO] }),
      stream: async function* () {
        yield new Uint8Array([9, 9])
      },
    })
    const iter = p.stream()[Symbol.asyncIterator]()
    expect((await iter.next()).value).toEqual(new Uint8Array([9, 9]))
  })

  test('validates length before invoking stream getBytes', async () => {
    const p = stubProvider()
    const iter = p.stream({ chunkBytes: -3 })[Symbol.asyncIterator]()
    const err = (await iter.next().catch((e) => e)) as EntropyError
    expect(err.code).toBe('invalid_request')
  })
})
