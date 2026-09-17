import { afterEach, describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import { packBits } from '../../src/internal/bits.js'
import {
  browserSampleSource,
  micEntropy,
  type SampleSource,
  sampleLsbBits,
} from '../../src/providers/microphone.js'
import { providerContract } from '../helpers/provider-contract.js'

/** Fresh PRNG int16 sample batches per session. */
function prngSamples(batch = 2048): SampleSource {
  let state = 0x5eed5eed
  return {
    async *samples() {
      while (true) {
        const out = new Int16Array(batch)
        for (let i = 0; i < batch; i++) {
          state ^= state << 13
          state ^= state >>> 17
          state ^= state << 5
          state >>>= 0
          out[i] = (state & 0xffff) - 0x8000
        }
        yield out
      }
    },
  }
}

/** Deterministic xorshift32 int16 words. */
function prngWords(n: number, seed: number): Int16Array {
  let state = seed
  const out = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    out[i] = (state & 0xffff) - 0x8000
  }
  return out
}

describe('sampleLsbBits', () => {
  test('takes LSBs from int16 samples, MSB-of-kept-bits first', () => {
    expect(sampleLsbBits(new Int16Array([3, 2, 1, 0]), 1)).toEqual([1, 0, 1, 0])
    expect(sampleLsbBits(new Int16Array([3]), 2)).toEqual([1, 1])
    expect(sampleLsbBits(new Int16Array([5]), 4)).toEqual([0, 1, 0, 1])
  })

  test('scales float32 samples by 32768 — the exact inverse of int16/32768', () => {
    // 1/32768 → 1 → LSB 1; 0 → 0; -1 → -32768 → even → LSB 0
    expect(sampleLsbBits(new Float32Array([1 / 32768, 0, -1]), 1)).toEqual([1, 0, 0])
    // every int16 word survives the round trip bit-exactly
    const words = new Int16Array([-32768, -32767, -16385, -2, -1, 0, 1, 2, 16383, 16385, 32767])
    const floats = Float32Array.from(words, (w) => w / 32768)
    expect(sampleLsbBits(floats, 4)).toEqual(sampleLsbBits(words, 4))
  })

  test('clamps out-of-range floats to the int16 range', () => {
    expect(sampleLsbBits(new Float32Array([2.5]), 1)).toEqual([1]) // clamp to 32767 (odd)
    expect(sampleLsbBits(new Float32Array([-2.5]), 1)).toEqual([0]) // clamp to -32768 (even)
  })
})

providerContract(
  'micEntropy (scripted samples)',
  () => micEntropy({ source: prngSamples(), warmupMs: 0 }),
  { kind: 'trng', privacy: 'private', lengths: [1, 16, 64] },
)

describe('micEntropy', () => {
  test('is named microphone; raw mode microphone(raw)', () => {
    expect(micEntropy({ source: prngSamples() }).name).toBe('microphone')
    expect(micEntropy({ source: prngSamples(), conditioning: 'raw' }).name).toBe('microphone(raw)')
  })

  test('validates bitsPerSample, warmupMs, sampleRate and queueLimit at construction', () => {
    const source = prngSamples()
    const bad: Record<string, unknown>[] = [
      { bitsPerSample: 3 },
      { warmupMs: -1 },
      { warmupMs: Number.NaN },
      { sampleRate: 0 },
      { queueLimit: 0 },
      { minEntropyPerSample: 9 },
    ]
    for (const opts of bad) {
      expect(() => micEntropy({ source, ...opts })).toThrow(EntropyError)
    }
  })

  test('skips warmupMs worth of samples', async () => {
    // sampleRate 1000 & warmupMs 100 → the first 100 samples are dropped
    const all = prngWords(16_384, 0x77) // ≥ 1024 bytes of LSBs for the start-up test
    const source: SampleSource = {
      async *samples() {
        for (let i = 0; i < all.length; i += 64) yield all.slice(i, i + 64)
      },
    }
    const { bytes } = await micEntropy({
      source,
      warmupMs: 100,
      sampleRate: 1000,
      conditioning: 'raw',
    }).getBytes(4)
    const [expected] = packBits(sampleLsbBits(all.slice(100), 1))
    expect(bytes).toEqual(expected.slice(0, 4))
  })

  test('bitsPerSample widens extraction', async () => {
    const all = prngWords(8192, 0x99)
    const source: SampleSource = {
      async *samples() {
        yield all
      },
    }
    const { bytes } = await micEntropy({
      source,
      warmupMs: 0,
      bitsPerSample: 2,
      conditioning: 'raw',
    }).getBytes(8)
    const [expected] = packBits(sampleLsbBits(all, 2))
    expect(bytes).toEqual(expected.slice(0, 8))
  })

  test('without a source and without browser audio, fails with a remedy', async () => {
    const err = await micEntropy()
      .getBytes(4)
      .catch((e) => e)
    expect(err).toBeInstanceOf(EntropyError)
    expect((err as EntropyError).code).toBe('invalid_request')
    expect((err as Error).message).toContain('source')
  })
})

describe('browserSampleSource (fake Web Audio)', () => {
  const g = globalThis as Record<string, unknown>
  afterEach(() => {
    delete (navigator as { mediaDevices?: unknown }).mediaDevices
    delete g.AudioContext
  })

  /** Installs a fake getUserMedia + AudioContext; returns a trigger for audio callbacks. */
  function installFakeAudio(getUserMedia: () => Promise<unknown>) {
    const state: { onaudioprocess?: (event: unknown) => void; closed: boolean; stopped: number } = {
      closed: false,
      stopped: 0,
    }
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })
    g.AudioContext = class {
      destination = {}
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} }
      }
      createScriptProcessor() {
        const node = {
          connect() {},
          disconnect() {},
          set onaudioprocess(fn: (event: unknown) => void) {
            state.onaudioprocess = fn
          },
        }
        return node
      }
      async close() {
        state.closed = true
      }
    }
    const fire = (value: number) =>
      state.onaudioprocess?.({
        inputBuffer: { getChannelData: () => new Float32Array(4).fill(value) },
      })
    return { state, fire }
  }

  const fakeStream = (state: { stopped: number }) => ({
    getTracks: () => [
      {
        stop() {
          state.stopped++
        },
      },
    ],
  })

  test('caps the producer queue, dropping the oldest buffers', async () => {
    const holder: { state?: { stopped: number } } = {}
    const { state, fire } = installFakeAudio(async () => fakeStream(holder.state as never))
    holder.state = state
    const iterator = browserSampleSource(2).samples()[Symbol.asyncIterator]()
    const first = iterator.next() // opens capture, waits for audio
    await new Promise((r) => setTimeout(r, 5))
    fire(0.1)
    expect(((await first).value as Float32Array)[0]).toBeCloseTo(0.1)
    for (let i = 2; i <= 5; i++) fire(i / 10) // consumer busy: 4 buffers into a queue of 2
    // 0.2 and 0.3 were dropped: only the 2 newest buffered buffers remain
    expect(((await iterator.next()).value as Float32Array)[0]).toBeCloseTo(0.4)
    expect(((await iterator.next()).value as Float32Array)[0]).toBeCloseTo(0.5)
    await iterator.return?.(undefined)
    expect(state.closed).toBe(true)
    expect(state.stopped).toBe(1)
  })

  test('a denied microphone permission surfaces as permission', async () => {
    installFakeAudio(async () => {
      throw new DOMException('denied', 'NotAllowedError')
    })
    const err = (await micEntropy()
      .getBytes(4)
      .catch((e) => e)) as EntropyError
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.code).toBe('permission')
  })
})
