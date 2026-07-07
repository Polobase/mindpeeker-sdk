import { describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import { aptCutoff, HealthTests, rctCutoff } from '../../src/internal/health.js'

describe('rctCutoff', () => {
  test('matches SP 800-90B values (alpha 2^-20)', () => {
    expect(rctCutoff(8)).toBe(4) // 1 + ceil(20/8)
    expect(rctCutoff(1)).toBe(21)
    expect(rctCutoff(7.8)).toBe(4)
    expect(rctCutoff(0.0625)).toBe(321)
  })
})

describe('aptCutoff', () => {
  test('matches published/computed inverse-binomial values', () => {
    expect(aptCutoff(7.8, 512)).toBe(13) // reference vector from Lightship 800-90B impl
    expect(aptCutoff(8, 512)).toBe(13)
    expect(aptCutoff(7, 512)).toBe(18)
    expect(aptCutoff(1, 1024)).toBe(589)
  })
})

describe('HealthTests', () => {
  const config = { minEntropyPerSample: 8 } // RCT cutoff 4, APT cutoff 13 @ W 512

  test('passes short runs below the RCT cutoff', () => {
    const health = new HealthTests(config, 'test-src')
    expect(() => health.test(new Uint8Array([7, 7, 7, 8, 7, 7, 7]))).not.toThrow()
  })

  test('trips RCT at exactly the cutoff run length', () => {
    const health = new HealthTests(config, 'test-src')
    health.test(new Uint8Array([7, 7, 7]))
    let err: EntropyError | undefined
    try {
      health.test(new Uint8Array([7]))
    } catch (e) {
      err = e as EntropyError
    }
    expect(err).toBeInstanceOf(EntropyError)
    expect(err?.code).toBe('health_test')
    expect(err?.provider).toBe('test-src')
    expect(err?.message).toContain('repetition')
  })

  test('trips APT when one value dominates a window', () => {
    // 13 zeros spread through the first 512-sample window (reference sample is 0)
    const samples = new Uint8Array(512)
    for (let i = 0; i < 512; i++) samples[i] = (i % 200) + 1
    for (let i = 0; i < 13; i++) samples[i * 39] = 0
    const health = new HealthTests({ minEntropyPerSample: 7.8 }, 'test-src')
    let err: EntropyError | undefined
    try {
      health.test(samples)
    } catch (e) {
      err = e as EntropyError
    }
    expect(err?.code).toBe('health_test')
    expect(err?.message).toContain('proportion')
  })

  test('passes when the dominant value stays below the APT cutoff', () => {
    const samples = new Uint8Array(512)
    for (let i = 0; i < 512; i++) samples[i] = (i % 200) + 1
    for (let i = 0; i < 12; i++) samples[i * 39] = 0 // one below cutoff 13
    const health = new HealthTests({ minEntropyPerSample: 7.8 }, 'test-src')
    expect(() => health.test(samples)).not.toThrow()
  })

  test('100k healthy PRNG samples pass both tests', () => {
    let state = 0x9e3779b9
    const samples = new Uint8Array(100_000)
    for (let i = 0; i < samples.length; i++) {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      state >>>= 0
      samples[i] = state & 0xff
    }
    const health = new HealthTests({ minEntropyPerSample: 7 }, 'test-src')
    expect(() => health.test(samples)).not.toThrow()
  })

  test('state carries across test() calls (runs split over chunks)', () => {
    const health = new HealthTests(config, 'test-src')
    health.test(new Uint8Array([9, 9]))
    expect(() => health.test(new Uint8Array([9, 9]))).toThrow(EntropyError)
  })
})
