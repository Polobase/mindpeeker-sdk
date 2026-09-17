import { describe, expect, test } from 'bun:test'
import { NegentropyError } from '../../src/errors.js'
import { POPCOUNT } from '../../src/internal/bytes.js'
import { covar } from '../../src/stats/covar.js'
import { gaussians, prngBytes } from '../helpers/byte-sources.js'

/** Theoretical z of 8-bit trials drawn from seeded bytes: (popcount − 4)/√2. */
function latticeMatrix(sources: number, steps: number, seed: number): Float64Array[] {
  const bytes = prngBytes(sources * steps, seed)
  return Array.from({ length: sources }, (_, i) =>
    Float64Array.from(
      { length: steps },
      (_, t) => ((POPCOUNT[bytes[i * steps + t] as number] as number) - 4) / Math.SQRT2,
    ),
  )
}

describe('covar', () => {
  test('per-step S₂ equals the explicit pair sum of (zᵢ² − 1)(zⱼ² − 1)', () => {
    const g = gaussians(4 * 50, 0x61)
    const zBySource = [0, 1, 2, 3].map((i) => g.slice(i * 50, (i + 1) * 50))
    const names = ['a', 'b', 'c', 'd']
    const result = covar(zBySource, names)
    let total = 0
    for (let t = 0; t < 50; t++) {
      let s2 = 0
      for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) {
          const ui = ((zBySource[i] as Float64Array)[t] as number) ** 2 - 1
          const uj = ((zBySource[j] as Float64Array)[t] as number) ** 2 - 1
          s2 += ui * uj
        }
      }
      expect(result.perStep[t] as number).toBeCloseTo(s2 / 6, 12)
      total += s2
    }
    expect(result.statistic).toBeCloseTo(total / Math.sqrt(50 * 6 * 4), 10)
    expect(result.df).toBe(300)
    expect(result.n).toBe(50)
    expect(result.zSquaredVariance).toBe(2)
    expect(result.sources).toEqual(names)
  })

  test('Var(z²) = 2 − 2/k exactly for Binomial(k, ½) trials (BigInt enumeration)', () => {
    for (const k of [8, 16, 200]) {
      // E[(X − k/2)⁴] with X ~ Binomial(k, ½), exact rational arithmetic over 2^k
      let binom = 1n
      let fourth = 0n
      for (let j = 0; j <= k; j++) {
        const d = BigInt(2 * j - k) // 2(X − k/2)
        fourth += binom * d ** 4n
        binom = (binom * BigInt(k - j)) / BigInt(j + 1)
      }
      // z = (X − k/2)/√(k/4) → z⁴ = (2(X − k/2))⁴/k²; E z⁴ = fourth / (2^k · k²)
      const ez4 = Number((fourth * 10n ** 15n) / (2n ** BigInt(k) * BigInt(k * k))) / 1e15
      expect(ez4 - 1).toBeCloseTo(2 - 2 / k, 12)
      const result = covar([new Float64Array([0, 1]), new Float64Array([1, 0])], ['a', 'b'], {
        bitsPerTrial: k,
      })
      expect(result.zSquaredVariance).toBe(2 - 2 / k)
    }
  })

  test('null calibration: mean 0, variance 1 with the exact lattice v (and not with v = 2)', () => {
    const reps = 1500
    const sources = 5
    const steps = 120
    let sum = 0
    let squares = 0
    let rejections = 0
    let gaussianV = 0
    const names = ['a', 'b', 'c', 'd', 'e']
    for (let r = 0; r < reps; r++) {
      const matrix = latticeMatrix(sources, steps, 0x1000 + r)
      const exact = covar(matrix, names, { bitsPerTrial: 8 })
      sum += exact.statistic
      squares += exact.statistic ** 2
      if (exact.pValue < 0.05) rejections++
      gaussianV += covar(matrix, names).statistic ** 2
    }
    const mean = sum / reps
    const variance = squares / reps - mean * mean
    expect(Math.abs(mean)).toBeLessThan(4 / Math.sqrt(reps))
    // sd of a sample variance of ~normal data ≈ √(2/reps)
    expect(Math.abs(variance - 1)).toBeLessThan(4 * Math.sqrt(2 / reps))
    expect(Math.abs(rejections / reps - 0.05)).toBeLessThan(4 * Math.sqrt((0.05 * 0.95) / reps))
    // Gaussian v = 2 under-scales lattice data: variance (1.75/2)² ≈ 0.766
    expect(gaussianV / reps).toBeLessThan(0.87)
  }, 30_000)

  test('a shared variance modulation is detected; independent sources are not flagged', () => {
    const steps = 2000
    const sources = 6
    const g = gaussians(steps * sources, 0x62)
    const scale = gaussians(steps, 0x63).map((v) => Math.exp(0.35 * v)) // common volatility
    const modulated = Array.from({ length: sources }, (_, i) =>
      Float64Array.from(
        { length: steps },
        (_, t) => (g[i * steps + t] as number) * (scale[t] as number),
      ),
    )
    const names = modulated.map((_, i) => `s${i}`)
    expect(covar(modulated, names).pValue).toBeLessThan(1e-6)
    // the same Gaussian sources without the common scale
    const plain = Array.from({ length: sources }, (_, i) => g.slice(i * steps, (i + 1) * steps))
    expect(covar(plain, names).pValue).toBeGreaterThan(1e-3)
  })

  test('validation', () => {
    expect(() => covar([new Float64Array([1])], ['a'])).toThrow(NegentropyError)
    expect(() =>
      covar([new Float64Array([1]), new Float64Array([Number.NaN])], ['a', 'b']),
    ).toThrow(NegentropyError)
    expect(() =>
      covar([new Float64Array([1]), new Float64Array([1])], ['a', 'b'], { bitsPerTrial: 4 }),
    ).toThrow(NegentropyError)
  })
})
