import { describe, expect, test } from 'bun:test'
// Test-only sibling import (resolved from negentropy's src): the runtime
// package stays dependency-free, the cross-check keeps both ports identical.
import {
  aptCutoff as negentropyAptCutoff,
  rctCutoff as negentropyRctCutoff,
} from '@mindpeeker/negentropy/numerics'
import { EntropyError } from '../../src/errors.js'
import { aptCutoff, HEALTH_ALPHA, HealthTests, rctCutoff } from '../../src/internal/health.js'

describe('rctCutoff', () => {
  test('matches SP 800-90B values (alpha 2^-20)', () => {
    expect(HEALTH_ALPHA).toBe(2 ** -20)
    expect(rctCutoff(8)).toBe(4) // 1 + ceil(20/8)
    expect(rctCutoff(1)).toBe(21)
    expect(rctCutoff(7.8)).toBe(4)
    expect(rctCutoff(0.25)).toBe(81)
    expect(rctCutoff(0.0625)).toBe(321)
  })

  test('rejects non-finite or non-positive H with invalid_request', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => rctCutoff(bad)).toThrow(EntropyError)
    }
  })
})

describe('aptCutoff', () => {
  // Reference values: exact binomial tails with integer C(W,k) and 80-digit
  // decimal powers of p = 2^-H (Python `decimal`, see the entropy brief), and
  // SP 800-90B Table 2 for the W = 1024 binary rows.
  test('SP 800-90B Table 2, W = 512 (H = 0.5 / 1 / 2 / 4 / 8)', () => {
    expect([0.5, 1, 2, 4, 8].map((h) => aptCutoff(h, 512))).toEqual([410, 311, 177, 62, 13])
  })

  test('SP 800-90B Table 2, W = 1024 (H = 0.2 … 1)', () => {
    expect([0.2, 0.4, 0.6, 0.8, 1].map((h) => aptCutoff(h, 1024))).toEqual([
      941, 840, 748, 664, 589,
    ])
  })

  test('low H no longer underflows: the jitter/sensor credits keep an active APT', () => {
    // the linear-space recurrence returned W + 1 (test disabled) for all of these
    expect(aptCutoff(0.0625, 512)).toBe(509)
    expect(aptCutoff(0.0625, 1024)).toBe(1009)
    expect(aptCutoff(0.25, 512)).toBe(468)
    expect(aptCutoff(0.35, 512)).toBe(445)
    expect(aptCutoff(0.5, 1024)).toBe(793)
    expect(aptCutoff(0.9, 1024)).toBe(625)
  })

  test('other published/computed anchors', () => {
    expect(aptCutoff(7.8, 512)).toBe(13) // reference vector from Lightship 800-90B impl
    expect(aptCutoff(7, 512)).toBe(18)
    expect(aptCutoff(3, 512)).toBe(103)
    expect(aptCutoff(6, 512)).toBe(25)
    expect(aptCutoff(0.75, 512)).toBe(357)
    expect(aptCutoff(0.1, 512)).toBe(502)
  })

  test('W + 1 exactly when p^W > alpha (H < 20/W)', () => {
    expect(aptCutoff(0.01, 512)).toBe(513)
    expect(aptCutoff(0.039, 512)).toBe(513)
    expect(aptCutoff(0.04, 512)).toBe(512)
    expect(aptCutoff(0.0195, 1024)).toBe(1025)
    expect(aptCutoff(0.02, 1024)).toBe(1024)
  })

  test('never exceeds W + 1 and is monotone non-increasing in H', () => {
    for (const w of [512, 1024]) {
      let previous = Number.POSITIVE_INFINITY
      for (let h = 0.01; h <= 8; h += 0.01) {
        const cutoff = aptCutoff(h, w)
        expect(cutoff).toBeLessThanOrEqual(w + 1)
        expect(cutoff).toBeLessThanOrEqual(previous)
        previous = cutoff
      }
    }
  })

  test('rejects invalid H or window with invalid_request', () => {
    expect(() => aptCutoff(Number.NaN, 512)).toThrow(EntropyError)
    expect(() => aptCutoff(1, 0)).toThrow(EntropyError)
    expect(() => aptCutoff(1, 1.5)).toThrow(EntropyError)
  })
})

describe('cutoffs agree with @mindpeeker/negentropy/numerics', () => {
  test('identical APT and RCT cutoffs over a dense H grid at both windows', () => {
    const hs: number[] = []
    for (let h = 0.005; h <= 8; h *= 1.07) hs.push(h)
    hs.push(0.0625, 0.25, 0.5, 1, 2, 4, 7, 7.8, 8)
    for (const h of hs) {
      expect(rctCutoff(h)).toBe(negentropyRctCutoff(h))
      for (const w of [512, 1024]) expect(aptCutoff(h, w)).toBe(negentropyAptCutoff(h, w))
    }
  })
})

describe('HealthTests', () => {
  const config = { minEntropyPerSample: 8 } // RCT cutoff 4, APT cutoff 13 @ W 512

  test('exposes the cutoffs it runs with', () => {
    const health = new HealthTests({ minEntropyPerSample: 0.0625 }, 'test-src')
    expect(health.rctCutoff).toBe(321)
    expect(health.aptCutoff).toBe(509)
    expect(health.windowSize).toBe(512)
  })

  test('rejects H outside (0, 8] and unknown windows with invalid_request', () => {
    for (const bad of [0, -1, 8.5, 64, Number.NaN, Number.POSITIVE_INFINITY]) {
      let err: unknown
      try {
        new HealthTests({ minEntropyPerSample: bad }, 'test-src')
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(EntropyError)
      expect((err as EntropyError).code).toBe('invalid_request')
    }
    expect(
      () => new HealthTests({ minEntropyPerSample: 1, windowSize: 256 as 512 }, 'test-src'),
    ).toThrow(EntropyError)
  })

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

  test('check() reports the alarm without throwing; reset() starts fresh', () => {
    const health = new HealthTests(config, 'test-src')
    const alarm = health.check(new Uint8Array([5, 5, 5, 5, 6]))
    expect(alarm).toMatchObject({ test: 'rct', count: 4, cutoff: 4 })
    health.reset()
    // the run does not continue across a reset
    expect(health.check(new Uint8Array([5, 5, 5]))).toBeNull()
  })

  test('trips APT when one value dominates a window', () => {
    // 13 zeros spread through the first 512-sample window (reference sample is 0)
    const samples = new Uint8Array(512)
    for (let i = 0; i < 512; i++) samples[i] = (i % 200) + 1
    for (let i = 0; i < 13; i++) samples[i * 39] = 0
    const health = new HealthTests({ minEntropyPerSample: 7.8 }, 'test-src')
    const alarm = health.check(samples)
    expect(alarm?.test).toBe('apt')
    expect(alarm?.message).toContain('proportion')
    expect(() => new HealthTests({ minEntropyPerSample: 7.8 }, 'x').test(samples)).toThrow(
      EntropyError,
    )
  })

  test('passes when the dominant value stays below the APT cutoff', () => {
    const samples = new Uint8Array(512)
    for (let i = 0; i < 512; i++) samples[i] = (i % 200) + 1
    for (let i = 0; i < 12; i++) samples[i * 39] = 0 // one below cutoff 13
    const health = new HealthTests({ minEntropyPerSample: 7.8 }, 'test-src')
    expect(() => health.test(samples)).not.toThrow()
  })

  test('at the jitter credit H = 1/16 the APT now fires on a 509/512 dominated window', () => {
    // 509 copies of the reference, runs broken below the RCT cutoff 321
    const dominated = new Uint8Array(512).fill(9)
    for (const i of [300, 400, 500]) dominated[i] = 4
    const alarm = new HealthTests({ minEntropyPerSample: 0.0625 }, 'jitter').check(dominated)
    expect(alarm).toMatchObject({ test: 'apt', count: 509, cutoff: 509 })

    const below = new Uint8Array(512).fill(9)
    for (const i of [100, 300, 400, 500]) below[i] = 4 // 508 copies
    expect(new HealthTests({ minEntropyPerSample: 0.0625 }, 'jitter').check(below)).toBeNull()
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
