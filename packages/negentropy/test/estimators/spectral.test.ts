import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NegentropyError } from '../../src/errors.js'
import { spectralEntropy, spectralTest } from '../../src/estimators/spectral.js'
import { gaussians, prngBytes } from '../helpers/byte-sources.js'

interface EstimatorFixtures {
  spectralEntropy: Array<{ label: string; samples: number[]; entropy: number }>
  spectralTest: Array<{ label: string; bits: number[]; d: number; pValue: number }>
}
const fixtures = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'fixtures', 'estimators.json'), 'utf8'),
) as EstimatorFixtures

describe('spectralTest (NIST SP 800-22 §2.6)', () => {
  test('reproduces the worked 10-bit example (p ≈ 0.468160)', () => {
    // NIST SP 800-22 §2.6.8 example: ε = 1 0 0 1 0 1 0 0 1 1
    const bits = Uint8Array.from([1, 0, 0, 1, 0, 1, 0, 0, 1, 1])
    expect(spectralTest(bits).pValue).toBeCloseTo(0.46816, 5)
  })

  test('matches the numpy fixture on a random block', () => {
    for (const c of fixtures.spectralTest) {
      const result = spectralTest(Uint8Array.from(c.bits))
      expect(result.statistic).toBeCloseTo(c.d, 8)
      expect(result.pValue).toBeCloseTo(c.pValue, 9)
    }
  })

  test('flags a periodic bit pattern', () => {
    const bits = new Uint8Array(4096)
    for (let i = 0; i < bits.length; i++) bits[i] = i % 2 // 0101… → strong spectral spike
    expect(spectralTest(bits).pValue).toBeLessThan(0.01)
  })

  test('a healthy PRNG bit block is unremarkable', () => {
    const bytes = prngBytes(1024, 0xabc)
    const bits = new Uint8Array(bytes.length * 8)
    for (let i = 0; i < bytes.length; i++) {
      for (let b = 0; b < 8; b++) bits[i * 8 + b] = ((bytes[i] as number) >> (7 - b)) & 1
    }
    expect(spectralTest(bits).pValue).toBeGreaterThan(0.01)
  })

  test('validation', () => {
    expect(() => spectralTest(new Uint8Array([1]))).toThrow(NegentropyError) // n < 2
    expect(() => spectralTest(Uint8Array.from([0, 1, 2]))).toThrow(NegentropyError) // non-bit
  })
})

describe('spectralEntropy', () => {
  test('matches the numpy fixture (white, sine, noisy sine)', () => {
    for (const c of fixtures.spectralEntropy) {
      expect(spectralEntropy(c.samples)).toBeCloseTo(c.entropy, 9)
    }
  })

  test('a pure tone → ~0, white noise → near max, normalized in [0,1]', () => {
    const sine = Array.from({ length: 1024 }, (_, t) => Math.sin((2 * Math.PI * 5 * t) / 1024))
    const white = Array.from(gaussians(1024, 0xfab))
    expect(spectralEntropy(sine)).toBeLessThan(0.01)
    expect(spectralEntropy(sine, { normalize: true })).toBeLessThan(0.01)
    const wn = spectralEntropy(white, { normalize: true })
    expect(wn).toBeGreaterThan(0.85)
    expect(wn).toBeLessThanOrEqual(1)
  })

  test('validation', () => {
    expect(() => spectralEntropy([1])).toThrow(NegentropyError)
    expect(() => spectralEntropy(new Array(16).fill(0))).toThrow(NegentropyError) // zero power
  })
})
