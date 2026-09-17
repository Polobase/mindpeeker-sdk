import { describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import { packBits } from '../../src/internal/bits.js'
import { iqLsbBits, sdrEntropy } from '../../src/providers/sdr.js'
import { providerContract } from '../helpers/provider-contract.js'

/** Endless PRNG IQ chunks (like a real dongle's noise floor). */
async function* prngIq(): AsyncGenerator<Uint8Array> {
  let state = 0x5d12f00d
  while (true) {
    const chunk = new Uint8Array(512)
    for (let i = 0; i < chunk.length; i++) {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      state >>>= 0
      chunk[i] = state & 0xff
    }
    yield chunk
  }
}

describe('iqLsbBits', () => {
  test('keeps the 6 least significant bits of each IQ byte, MSB-of-kept first', () => {
    expect(iqLsbBits(new Uint8Array([0b10101010]))).toEqual([1, 0, 1, 0, 1, 0])
    expect(iqLsbBits(new Uint8Array([0b11000011]))).toEqual([0, 0, 0, 0, 1, 1])
    expect(iqLsbBits(new Uint8Array([0xff, 0x00]))).toEqual([1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0])
  })
})

providerContract(
  'sdrEntropy (scripted IQ)',
  () => sdrEntropy({ source: prngIq(), warmupBytes: 0 }),
  {
    kind: 'trng',
    privacy: 'private',
    lengths: [1, 16, 64],
  },
)

describe('sdrEntropy', () => {
  test('requires a source (no browser default)', () => {
    // @ts-expect-error missing source
    expect(() => sdrEntropy({})).toThrow(EntropyError)
    expect(() => sdrEntropy({ source: prngIq(), warmupBytes: -1 })).toThrow(EntropyError)
    try {
      // @ts-expect-error missing source
      sdrEntropy({})
    } catch (error) {
      expect((error as Error).message).toContain('rtlSdrSource')
    }
  })

  test('is named sdr; raw mode sdr(raw)', () => {
    expect(sdrEntropy({ source: prngIq() }).name).toBe('sdr')
    expect(sdrEntropy({ source: prngIq(), conditioning: 'raw' }).name).toBe('sdr(raw)')
  })

  test('raw mode without debias packs the 6-LSB stream deterministically', async () => {
    const iq = new Uint8Array(512 * 4)
    let state = 0x31415926
    for (let i = 0; i < iq.length; i++) {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      state >>>= 0
      iq[i] = state & 0xff
    }
    async function* recorded(): AsyncGenerator<Uint8Array> {
      for (let i = 0; i < iq.length; i += 512) yield iq.slice(i, i + 512)
    }
    const { bytes } = await sdrEntropy({
      source: recorded(),
      warmupBytes: 0,
      debias: false,
      conditioning: 'raw',
    }).getBytes(3)
    const [expected] = packBits(iqLsbBits(iq))
    expect(bytes).toEqual(expected.slice(0, 3))
  })

  test('a patterned (non-constant) IQ stream fails the health tests', async () => {
    async function* patterned(): AsyncGenerator<Uint8Array> {
      while (true) yield new Uint8Array(16).fill(0b10101010) // 6 LSBs 101010 → 0xAA bytes
    }
    const err = (await sdrEntropy({ source: patterned(), warmupBytes: 0, debias: false })
      .getBytes(3)
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('health_test')
  })

  test('a silent in-memory source (no timers) times out instead of hanging', async () => {
    async function* silentReplay(): AsyncGenerator<Uint8Array> {
      while (true) yield new Uint8Array(64)
    }
    const err = (await sdrEntropy({ source: silentReplay(), warmupBytes: 0 })
      .getBytes(4, { timeoutMs: 80 })
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('timeout')
  })

  test('debias (default) drops correlated runs entirely', async () => {
    // constant 0x00 IQ bytes → all-zero bits → von Neumann yields nothing → starvation
    async function* silent(): AsyncGenerator<Uint8Array> {
      while (true) {
        yield new Uint8Array(64)
        await new Promise((r) => setTimeout(r, 1))
      }
    }
    const err = await sdrEntropy({ source: silent(), warmupBytes: 0 })
      .getBytes(4, { timeoutMs: 60 })
      .catch((e) => e)
    expect((err as { code?: string }).code).toBe('timeout')
  })

  test('skips warmup bytes before extracting', async () => {
    let counter = 0
    async function* counting(): AsyncGenerator<Uint8Array> {
      while (true) {
        const chunk = new Uint8Array(8)
        for (let i = 0; i < 8; i++) chunk[i] = counter++ & 0xff
        yield chunk
      }
    }
    const withWarmup = await sdrEntropy({
      source: counting(),
      warmupBytes: 16,
      debias: false,
      conditioning: 'raw',
    }).getBytes(3)
    // first extracted bits come from IQ byte value 16 (0b010000 → …)
    const direct = iqLsbBits(new Uint8Array([16, 17, 18, 19]))
    expect(withWarmup.bytes[0]).toBe(direct.slice(0, 8).reduce((acc, bit) => (acc << 1) | bit, 0))
  })
})
