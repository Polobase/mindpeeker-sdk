import { describe, expect, test } from 'bun:test'
import { micEntropy, type SampleSource, sampleLsbBits } from '../../src/providers/microphone.js'
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

describe('sampleLsbBits', () => {
  test('takes LSBs from int16 samples, MSB-of-kept-bits first', () => {
    expect(sampleLsbBits(new Int16Array([3, 2, 1, 0]), 1)).toEqual([1, 0, 1, 0])
    expect(sampleLsbBits(new Int16Array([3]), 2)).toEqual([1, 1])
    expect(sampleLsbBits(new Int16Array([5]), 4)).toEqual([0, 1, 0, 1])
  })

  test('scales float32 samples to int16 before extracting', () => {
    // 1/32767 → int16 1 → LSB 1; 0 → 0; -1 → -32767 → odd → LSB 1
    expect(sampleLsbBits(new Float32Array([1 / 32767, 0, -1]), 1)).toEqual([1, 0, 1])
  })

  test('clamps out-of-range floats', () => {
    expect(sampleLsbBits(new Float32Array([2.5]), 1)).toEqual([1]) // clamp to 32767 (odd)
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

  test('skips warmupMs worth of samples', async () => {
    // sampleRate 1000 & warmupMs 100 → first 100 samples dropped.
    // samples alternate LSB 0/1 by index, so post-warmup bits start at index 100 (even → 0)
    const source: SampleSource = {
      async *samples() {
        let i = 0
        while (true) {
          const out = new Int16Array(64)
          for (let j = 0; j < 64; j++) out[j] = i++ & 1
          yield out
        }
      },
    }
    const { bytes } = await micEntropy({
      source,
      warmupMs: 100,
      sampleRate: 1000,
      conditioning: 'raw',
    }).getBytes(1)
    expect(bytes).toEqual(new Uint8Array([0b01010101]))
  })

  test('bitsPerSample widens extraction', async () => {
    const source: SampleSource = {
      async *samples() {
        while (true) yield new Int16Array([0b11, 0b01, 0b10, 0b00])
      },
    }
    const { bytes } = await micEntropy({
      source,
      warmupMs: 0,
      bitsPerSample: 2,
      conditioning: 'raw',
    }).getBytes(1)
    expect(bytes).toEqual(new Uint8Array([0b11011000]))
  })

  test('without a source and without browser audio, fails with a remedy', async () => {
    const err = await micEntropy()
      .getBytes(4)
      .catch((e) => e)
    expect(err).toBeInstanceOf(TypeError)
    expect((err as Error).message).toContain('source')
  })
})
