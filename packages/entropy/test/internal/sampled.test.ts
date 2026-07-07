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
})
