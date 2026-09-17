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
  test('NIST §2.6.8 sequence: magnitudes 0, 2, √20, 2, √20 → N₁ = 5, p = 0.468160', () => {
    // ε = 1001010011. The spec prints N₁ = 4, d = −2.176713, P = 0.029523 for this
    // sequence, but every magnitude is below T = 5.4733, so its own formula gives
    // N₁ = 5 — a known inconsistency in the document. The numpy fixture below is
    // the external cross-check; this pins the arithmetically correct value.
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

  test('odd n is unbiased under H0: N₀ and the variance both use ⌊n/2⌋', () => {
    // with the spec's fractional n/2 the null mean of d at n = 101 is ≈ −0.37
    const n = 101
    const reps = 2000
    const bytes = prngBytes(Math.ceil((n * reps) / 8), 0x5eed)
    const bits = new Uint8Array(bytes.length * 8)
    for (let i = 0; i < bytes.length; i++) {
      for (let b = 0; b < 8; b++) bits[i * 8 + b] = ((bytes[i] as number) >> (7 - b)) & 1
    }
    let sum = 0
    for (let r = 0; r < reps; r++) sum += spectralTest(bits.subarray(r * n, (r + 1) * n)).statistic
    expect(Math.abs(sum / reps)).toBeLessThan(0.15)
  })

  test("variance: 'kim2004' rescales d by √(1.9/2), making tail p-values larger (less anti-conservative)", () => {
    const bits = new Uint8Array(4096)
    for (let i = 0; i < bits.length; i++) bits[i] = i % 3 === 0 ? 1 : 0
    const nist = spectralTest(bits)
    const kim = spectralTest(bits, { variance: 'kim2004' })
    expect(spectralTest(bits, { variance: 'nist' })).toEqual(nist)
    expect(kim.statistic).toBeCloseTo(nist.statistic * Math.sqrt(1.9 / 2), 12)
    expect(kim.pValue).toBeGreaterThanOrEqual(nist.pValue)
  })

  test('validation', () => {
    const invalid = expect.objectContaining({ code: 'invalid_config' })
    expect(() => spectralTest(new Uint8Array([1]))).toThrow(NegentropyError) // n < 2
    expect(() => spectralTest(Uint8Array.from([0, 1, 2]))).toThrow(invalid) // non-bit
    expect(() => spectralTest(Uint8Array.from([0, 1]), { variance: 'x' as 'nist' })).toThrow(
      invalid,
    )
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
