import { describe, expect, test } from 'bun:test'
import { binomialCdf, binomialSf } from '@mindpeeker/negentropy/numerics'
import { Xoshiro128 } from '../../src/internal/prng.js'
import { globalRankEnvelope } from '../../src/resample/envelope.js'

// 20 integer curves with heavy ties (LCG, scratch env_ref.py); expected values from an
// independent brute-force Python implementation of Myllymäki et al. (2017).
const CURVES = [
  [6, 0, 3, 3],
  [1, 1, 1, 5],
  [3, 4, 4, 3],
  [0, 3, 3, 0],
  [4, 1, 0, 0],
  [1, 0, 0, 1],
  [1, 1, 0, 3],
  [5, 3, 2, 6],
  [4, 1, 6, 5],
  [3, 5, 5, 1],
  [3, 4, 3, 0],
  [4, 3, 0, 2],
  [1, 4, 5, 1],
  [0, 4, 2, 6],
  [4, 6, 3, 1],
  [5, 2, 6, 2],
  [5, 4, 1, 5],
  [3, 0, 1, 1],
  [3, 1, 6, 5],
  [5, 1, 0, 5],
]

describe('globalRankEnvelope', () => {
  const [observed, ...simulated] = CURVES as [number[], ...number[][]]

  test('two-sided: ranks, p-interval, ERL p, k_α, envelope match the reference', () => {
    const env = globalRankEnvelope(observed, simulated, { alpha: 0.1 })
    expect([...env.ranks]).toEqual([1, 6, 6, 2, 3, 3, 5, 2, 3, 2, 3, 5, 5, 2, 1, 3, 5, 3, 3, 5])
    expect(env.rank).toBe(1)
    expect(env.pInterval[0]).toBeCloseTo(0.05, 15)
    expect(env.pInterval[1]).toBeCloseTo(0.1, 15)
    expect(env.pErl).toBeCloseTo(0.05, 15)
    expect(env.kAlpha).toBe(2)
    expect([...env.lower]).toEqual([0, 0, 0, 0])
    expect([...env.upper]).toEqual([5, 5, 6, 6])
    expect(env.outside).toBe(true)
    expect(env.simulations).toBe(19)
    expect(env.points).toBe(4)
  })

  test('one-sided alternatives match the reference', () => {
    const greater = globalRankEnvelope(observed, simulated, { alpha: 0.1, alternative: 'greater' })
    expect([...greater.ranks]).toEqual([
      1, 7, 6, 10, 9, 17, 10, 2, 3, 2, 7, 9, 5, 2, 1, 3, 5, 14, 3, 5,
    ])
    expect(greater.pInterval).toEqual([0.05, 0.1])
    expect(greater.pErl).toBeCloseTo(0.1, 15)
    expect([...greater.upper]).toEqual([5, 5, 6, 6])
    expect([...greater.lower].every((x) => x === Number.NEGATIVE_INFINITY)).toBe(true)
    const less = globalRankEnvelope(observed, simulated, { alpha: 0.1, alternative: 'less' })
    expect([...less.ranks]).toEqual([3, 6, 11, 2, 3, 3, 5, 10, 9, 8, 3, 5, 6, 2, 8, 10, 8, 3, 9, 5])
    expect(less.pInterval[0]).toBeCloseTo(0.15, 15)
    expect(less.pInterval[1]).toBeCloseTo(0.35, 15)
    expect(less.pErl).toBeCloseTo(0.35, 15)
    expect(less.kAlpha).toBe(3)
    expect([...less.lower]).toEqual([1, 0, 0, 0])
    expect(less.outside).toBe(false)
  })

  test('H0: exchangeable random walks — outside ⟺ p₊ ≤ α, and rejection rates are calibrated', () => {
    const datasets = 200
    const s = 99
    const d = 25
    let plusHits = 0
    let erlHits = 0
    const rng = new Xoshiro128(0x1234)
    for (let k = 0; k < datasets; k++) {
      const curves: Float64Array[] = []
      for (let c = 0; c <= s; c++) {
        const walk = new Float64Array(d)
        let x = 0
        for (let r = 0; r < d; r++) {
          x += rng.nextUint32() / 4294967296 - 0.5
          walk[r] = x
        }
        curves.push(walk)
      }
      const env = globalRankEnvelope(curves[0] as Float64Array, curves.slice(1), { alpha: 0.05 })
      expect(env.outside).toBe(env.pInterval[1] <= 0.05)
      if (env.pInterval[1] <= 0.05) plusHits++
      if (env.pErl <= 0.05) erlHits++
    }
    // p₊ is conservative: never significantly above α
    expect(binomialCdf(plusHits, datasets, 0.05)).toBeLessThan(0.9995)
    // ERL p is (near-)exact for continuous curves: inside the 99.9% Binomial(200, 0.05) band
    expect(binomialCdf(erlHits, datasets, 0.05)).toBeGreaterThan(0.0005)
    expect(binomialSf(erlHits - 1, datasets, 0.05)).toBeGreaterThan(0.0005)
  })

  test('errors', () => {
    const code = (c: string) =>
      expect.objectContaining({ name: 'PsiError', code: c }) as unknown as Error
    expect(() => globalRankEnvelope([], [[1]])).toThrow(code('invalid_plan'))
    expect(() => globalRankEnvelope([1], [])).toThrow(code('insufficient_data'))
    expect(() => globalRankEnvelope([1, 2], [[1]])).toThrow(code('invalid_plan'))
    expect(() => globalRankEnvelope([1], [[Number.NaN]])).toThrow(code('invalid_plan'))
    expect(() => globalRankEnvelope([1], [[2]], { alpha: 1 })).toThrow(code('invalid_plan'))
    // α(s+1) = 0.05·10 < 1: no level-α test exists
    expect(() =>
      globalRankEnvelope(
        [1],
        Array.from({ length: 9 }, () => [2]),
      ),
    ).toThrow(code('insufficient_data'))
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: deliberately unknown alternative
      globalRankEnvelope([1], [[2]], { alpha: 0.5, alternative: 'up' as any }),
    ).toThrow(code('invalid_plan'))
  })
})
