import { describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import { sampledProvider } from '../../src/internal/sampled.js'
import { providerContract } from '../helpers/provider-contract.js'

interface ScriptedSpy {
  opens: number
  closes: number
}

/** Infinite PRNG raw-sample source with open/close accounting. */
function scriptedSpec(spy: ScriptedSpy, opts: { chunkSize?: number; hang?: boolean } = {}) {
  const { chunkSize = 64, hang = false } = opts
  return {
    name: 'scripted',
    kind: 'trng',
    privacy: 'private',
    defaultMinEntropyPerSample: 8,
    defaultSafetyFactor: 2,
    async *open(signal?: AbortSignal) {
      spy.opens++
      let state = 0xdeadbeef + spy.opens
      try {
        if (hang) {
          await new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
        }
        while (true) {
          const chunk = new Uint8Array(chunkSize)
          for (let i = 0; i < chunkSize; i++) {
            state ^= state << 13
            state ^= state >>> 17
            state ^= state << 5
            state >>>= 0
            chunk[i] = state & 0xff
          }
          yield chunk
        }
      } finally {
        spy.closes++
      }
    },
  } as const
}

providerContract(
  'sampledProvider (conditioned, scripted source)',
  () => sampledProvider(scriptedSpec({ opens: 0, closes: 0 })),
  { kind: 'trng', privacy: 'private', lengths: [1, 16, 100] },
)

providerContract(
  'sampledProvider (raw, scripted source)',
  () => sampledProvider(scriptedSpec({ opens: 0, closes: 0 }), { conditioning: 'raw' }),
  { kind: 'trng', privacy: 'private', lengths: [1, 16, 100] },
)

describe('sampledProvider', () => {
  test('raw mode renames the provider name(raw) and attributes accordingly', async () => {
    const spy = { opens: 0, closes: 0 }
    const p = sampledProvider(scriptedSpec(spy), { conditioning: 'raw' })
    expect(p.name).toBe('scripted(raw)')
    const { sources } = await p.getBytes(8)
    expect(sources[0]?.name).toBe('scripted(raw)')
  })

  test('conditioned mode keeps the plain name', () => {
    const spy = { opens: 0, closes: 0 }
    expect(sampledProvider(scriptedSpec(spy)).name).toBe('scripted')
  })

  test('opens one session per getBytes call and closes it afterwards', async () => {
    const spy = { opens: 0, closes: 0 }
    const p = sampledProvider(scriptedSpec(spy))
    expect(spy.opens).toBe(0)
    await p.getBytes(32)
    expect(spy.opens).toBe(1)
    expect(spy.closes).toBe(1)
    await p.getBytes(32)
    expect(spy.opens).toBe(2)
    expect(spy.closes).toBe(2)
  })

  test('stream uses one lazy session for the iterator lifetime', async () => {
    const spy = { opens: 0, closes: 0 }
    const p = sampledProvider(scriptedSpec(spy))
    const stream = p.stream({ chunkBytes: 16 })
    expect(spy.opens).toBe(0)
    const chunks: Uint8Array[] = []
    for await (const chunk of stream) {
      chunks.push(chunk)
      if (chunks.length === 3) break
    }
    expect(chunks.every((c) => c.length === 16)).toBe(true)
    expect(spy.opens).toBe(1)
    expect(spy.closes).toBe(1)
  })

  test('a source that never yields produces timeout via the call budget', async () => {
    const spy = { opens: 0, closes: 0 }
    const p = sampledProvider(scriptedSpec(spy, { hang: true }))
    const err = (await p.getBytes(8, { timeoutMs: 40 }).catch((e) => e)) as EntropyError
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.code).toBe('timeout')
  })

  test('health failures surface as health_test', async () => {
    const spec = {
      name: 'stuck',
      kind: 'trng',
      privacy: 'private',
      defaultMinEntropyPerSample: 8,
      defaultSafetyFactor: 2,

      async *open() {
        while (true) yield new Uint8Array(64).fill(9)
      },
    } as const
    const err = (await sampledProvider(spec)
      .getBytes(8)
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('health_test')
  })

  test('conditioning overrides apply', async () => {
    const spy = { opens: 0, closes: 0 }
    // H=1 → 512 raw bytes per 32-byte block; chunkSize 64 → needs 8 chunks
    const p = sampledProvider(scriptedSpec(spy), { minEntropyPerSample: 1 })
    const { bytes } = await p.getBytes(32)
    expect(bytes.length).toBe(32)
  })

  test('a source that recovers after one stuck chunk is retested, not fatal (default)', async () => {
    let state = 0x13579bdf
    const spec = {
      name: 'glitchy',
      kind: 'trng',
      privacy: 'private',
      defaultMinEntropyPerSample: 8,
      defaultSafetyFactor: 2,
      async *open() {
        let n = 0
        while (true) {
          if (n++ === 20) yield new Uint8Array(16).fill(1) // one RCT alarm
          const chunk = new Uint8Array(64)
          for (let i = 0; i < 64; i++) {
            state ^= state << 13
            state ^= state >>> 17
            state ^= state << 5
            state >>>= 0
            chunk[i] = state & 0xff
          }
          yield chunk
        }
      },
    } as const
    expect((await sampledProvider(spec).getBytes(2048)).bytes).toHaveLength(2048)
    const err = (await sampledProvider(spec, { onHealthFailure: 'throw' })
      .getBytes(2048)
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('health_test')
  })
})

describe('sampledProvider: option validation at construction', () => {
  const spec = () => scriptedSpec({ opens: 0, closes: 0 })

  function rejects(opts: Record<string, unknown>): void {
    let err: unknown
    try {
      sampledProvider(spec(), opts)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(EntropyError)
    expect((err as EntropyError).code).toBe('invalid_request')
  }

  test('safetyFactor must be finite and >= 1 (0 used to emit constant SHA-256(""))', () => {
    for (const safetyFactor of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      rejects({ safetyFactor })
    }
    expect(() => sampledProvider(spec(), { safetyFactor: 1 })).not.toThrow()
  })

  test('minEntropyPerSample must be finite with 0 < H <= 8', () => {
    for (const minEntropyPerSample of [0, -1, 8.01, 16, Number.NaN, Number.POSITIVE_INFINITY]) {
      rejects({ minEntropyPerSample })
    }
    expect(() => sampledProvider(spec(), { minEntropyPerSample: 8 })).not.toThrow()
  })

  test('conditioning, onHealthFailure and maxHealthFailures are validated', () => {
    rejects({ conditioning: 'whitened' })
    rejects({ onHealthFailure: 'ignore' })
    rejects({ maxHealthFailures: 0 })
    rejects({ maxHealthFailures: 2.5 })
  })

  test('the former constant-output configuration now fails loudly', async () => {
    // before: getBytes(32) resolved with e3b0c442…b855 (SHA-256 of nothing) twice in a row
    let err: unknown
    try {
      await sampledProvider(spec(), { safetyFactor: 0 }).getBytes(32)
    } catch (e) {
      err = e
    }
    expect((err as EntropyError).code).toBe('invalid_request')
  })
})

describe('sampledProvider: health-test H never looser than the credit', () => {
  /** One bit of entropy per byte: every byte is 0 or 1. */
  function oneBitSpec() {
    let state = 0x2468ace1
    return {
      name: 'one-bit',
      kind: 'trng',
      privacy: 'private',
      defaultMinEntropyPerSample: 0.25,
      defaultHealthMinEntropyPerSample: 1,
      defaultSafetyFactor: 1,
      async *open() {
        while (true) {
          const chunk = new Uint8Array(256)
          for (let i = 0; i < 256; i++) {
            state ^= state << 13
            state ^= state >>> 17
            state ^= state << 5
            state >>>= 0
            chunk[i] = state & 1
          }
          yield chunk
        }
      },
    } as const
  }

  test('defaults: credited 0.25, tested at the stricter 1 b/B — a 1-bit source passes', async () => {
    expect((await sampledProvider(oneBitSpec()).getBytes(32)).bytes).toHaveLength(32)
  })

  test('crediting 4 b/B raises the health H to 4, so the 1-bit source now fails', async () => {
    const err = (await sampledProvider(oneBitSpec(), { minEntropyPerSample: 4 })
      .getBytes(32)
      .catch((e) => e)) as EntropyError
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.code).toBe('health_test')
  })
})

describe('sampledProvider.stream error taxonomy', () => {
  test('timeoutMs bounds each chunk and surfaces as timeout', async () => {
    const spy = { opens: 0, closes: 0 }
    const p = sampledProvider(scriptedSpec(spy, { hang: true }))
    const err = (await p
      .stream({ timeoutMs: 40 })
      [Symbol.asyncIterator]()
      .next()
      .catch((e) => e)) as EntropyError
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.code).toBe('timeout')
    expect(spy.closes).toBe(1) // the session was aborted and released
  })

  test('a caller abort surfaces as EntropyError aborted, not a DOMException', async () => {
    const spy = { opens: 0, closes: 0 }
    const controller = new AbortController()
    const p = sampledProvider(scriptedSpec(spy, { hang: true }))
    const pending = p
      .stream({ signal: controller.signal, chunkBytes: 16 })
      [Symbol.asyncIterator]()
      .next()
    setTimeout(() => controller.abort(), 10)
    const err = (await pending.catch((e) => e)) as EntropyError
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.code).toBe('aborted')
  })

  test('a foreign source failure mid-stream becomes network with cause', async () => {
    const eio = Object.assign(new Error('EIO'), { code: 'EIO' })
    const spec = {
      ...scriptedSpec({ opens: 0, closes: 0 }),
      name: 'flaky',
      async *open() {
        yield new Uint8Array(2048).map((_, i) => (i * 131 + 7) & 0xff)
        throw eio
      },
    }
    const err = (await (async () => {
      try {
        for await (const _chunk of sampledProvider(spec, { conditioning: 'raw' }).stream()) {
          /* drain */
        }
      } catch (e) {
        return e
      }
    })()) as EntropyError
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.code).toBe('network')
    expect(err.cause).toBe(eio)
  })

  test('health failures propagate through stream() as health_test', async () => {
    const spec = {
      name: 'stuck',
      kind: 'trng',
      privacy: 'private',
      defaultMinEntropyPerSample: 8,
      defaultSafetyFactor: 2,
      async *open() {
        while (true) yield new Uint8Array(64).fill(9)
      },
    } as const
    const err = (await sampledProvider(spec)
      .stream()
      [Symbol.asyncIterator]()
      .next()
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('health_test')
  })

  test('chunkBytes 0 is rejected instead of yielding empty chunks forever', async () => {
    const p = sampledProvider(scriptedSpec({ opens: 0, closes: 0 }))
    const err = (await p
      .stream({ chunkBytes: 0 })
      [Symbol.asyncIterator]()
      .next()
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('invalid_request')
  })
})
