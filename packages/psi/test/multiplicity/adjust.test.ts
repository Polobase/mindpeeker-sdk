import { describe, expect, test } from 'bun:test'
import { binomialCdf } from '@mindpeeker/negentropy/numerics'
import { Xoshiro128 } from '../../src/internal/prng.js'
import { benjaminiHochberg, holm, maxTAdjust } from '../../src/multiplicity/adjust.js'

// Reference values: hand computation for the 4-value family, and an independent
// brute-force Python implementation from the definitions (scratch adjust_ref.py).

describe('holm', () => {
  test('matches hand computation and the definition', () => {
    // sorted 0.005, 0.01, 0.03, 0.04 → 4·0.005, 3·0.01, 2·0.03, 1·0.04 → cummax
    const result = holm([0.01, 0.04, 0.03, 0.005])
    expect(result.method).toBe('holm')
    const expected = [0.03, 0.06, 0.06, 0.02]
    result.adjusted.forEach((p, i) => {
      expect(p).toBeCloseTo(expected[i] as number, 15)
    })
    expect(result.rejected).toEqual([true, false, false, true])
    const second = holm([0.2, 0.001, 0.049, 0.5, 0.0125, 0.03, 0.8, 0.011], { alpha: 0.1 })
    const ref = [0.6, 0.008, 0.196, 1, 0.077, 0.15, 1, 0.077]
    second.adjusted.forEach((p, i) => {
      expect(p).toBeCloseTo(ref[i] as number, 14)
    })
    expect(second.level).toBe(0.1)
    expect(second.rejected.filter(Boolean).length).toBe(3)
  })
})

describe('benjaminiHochberg', () => {
  test('matches hand computation and the definition', () => {
    const result = benjaminiHochberg([0.01, 0.04, 0.03, 0.005])
    const expected = [0.02, 0.04, 0.04, 0.02]
    result.adjusted.forEach((p, i) => {
      expect(p).toBeCloseTo(expected[i] as number, 15)
    })
    expect(result.rejected).toEqual([true, true, true, true])
    const second = benjaminiHochberg([0.2, 0.001, 0.049, 0.5, 0.0125, 0.03, 0.8, 0.011], {
      q: 0.05,
    })
    const ref = [4 / 15, 0.008, 0.0784, 4 / 7, 1 / 30, 0.06, 0.8, 1 / 30]
    second.adjusted.forEach((p, i) => {
      expect(p).toBeCloseTo(ref[i] as number, 14)
    })
    expect(second.method).toBe('benjamini-hochberg')
  })

  test('BH never exceeds Holm; both are ≥ the raw p and ≤ 1', () => {
    const rng = new Xoshiro128(3)
    for (let trial = 0; trial < 50; trial++) {
      const p = Array.from({ length: 12 }, () => rng.nextUint32() / 4294967296)
      const h = holm(p).adjusted
      const b = benjaminiHochberg(p).adjusted
      p.forEach((raw, i) => {
        expect(b[i] as number).toBeLessThanOrEqual((h[i] as number) + 1e-15)
        expect(b[i] as number).toBeGreaterThanOrEqual(raw - 1e-15)
        expect(h[i] as number).toBeLessThanOrEqual(1)
      })
    }
  })
})

describe('maxTAdjust', () => {
  const t = [2.5, 0.3, 1.9, 3.1]
  const surrogates = [
    [0.1, 2.0, 0.4, 1.0],
    [2.6, 0.2, 0.1, 0.3],
    [0.5, 0.5, 2.2, 0.9],
    [1.2, 3.2, 0.8, 0.1],
    [0.0, 0.1, 0.2, 0.3],
    [1.95, 0.4, 1.0, 0.6],
    [0.9, 0.9, 0.9, 0.9],
    [2.4, 1.8, 0.3, 2.0],
    [0.2, 0.3, 1.95, 0.1],
  ]

  test('single-step matches the brute-force definition', () => {
    const result = maxTAdjust(t, surrogates, { stepDown: false })
    expect(result.method).toBe('maxT-single-step')
    const expected = [3 / 10, 1, 4 / 5, 1 / 5]
    result.adjusted.forEach((p, i) => {
      expect(p).toBeCloseTo(expected[i] as number, 15)
    })
  })

  test('step-down matches the brute-force definition and is never above single-step', () => {
    const result = maxTAdjust(t, surrogates, { alpha: 0.25 })
    expect(result.method).toBe('maxT-step-down')
    const expected = [3 / 10, 4 / 5, 1 / 2, 1 / 5]
    result.adjusted.forEach((p, i) => {
      expect(p).toBeCloseTo(expected[i] as number, 15)
    })
    expect(result.rejected).toEqual([false, false, false, true])
    const single = maxTAdjust(t, surrogates, { stepDown: false }).adjusted
    result.adjusted.forEach((p, i) => {
      expect(p).toBeLessThanOrEqual(single[i] as number)
    })
  })

  test('H0 with correlated statistics: family-wise error stays ≤ α (binomial band)', () => {
    const rng = new Xoshiro128(77)
    const gauss = () => {
      const u1 = (rng.nextUint32() + 0.5) / 4294967296
      const u2 = rng.nextUint32() / 4294967296
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    }
    // K = 6 statistics sharing a common factor (ρ = 0.5); observed exchangeable with 99 nulls
    const draw = () => {
      const common = gauss()
      return Array.from({ length: 6 }, () => Math.SQRT1_2 * common + Math.SQRT1_2 * gauss())
    }
    const datasets = 300
    let familyErrors = 0
    for (let d = 0; d < datasets; d++) {
      const observed = draw()
      const nulls = Array.from({ length: 99 }, draw)
      if (maxTAdjust(observed, nulls).rejected.some(Boolean)) familyErrors++
    }
    expect(binomialCdf(familyErrors, datasets, 0.05)).toBeLessThan(0.9995)
    expect(familyErrors).toBeGreaterThan(0) // not trivially conservative
  })

  test('errors', () => {
    const code = (c: string) =>
      expect.objectContaining({ name: 'PsiError', code: c }) as unknown as Error
    expect(() => holm([])).toThrow(code('insufficient_data'))
    expect(() => holm([1.2])).toThrow(code('invalid_plan'))
    expect(() => holm([Number.NaN])).toThrow(code('invalid_plan'))
    expect(() => holm([0.1], { alpha: 0 })).toThrow(code('invalid_plan'))
    expect(() => benjaminiHochberg([0.1], { q: 1 })).toThrow(code('invalid_plan'))
    expect(() => maxTAdjust([], [[1]])).toThrow(code('insufficient_data'))
    expect(() => maxTAdjust([1], [])).toThrow(code('insufficient_data'))
    expect(() => maxTAdjust([1, 2], [[1]])).toThrow(code('invalid_plan'))
    expect(() => maxTAdjust([Number.POSITIVE_INFINITY], [[1]])).toThrow(code('invalid_plan'))
    expect(() => maxTAdjust([1], [[Number.NaN]])).toThrow(code('invalid_plan'))
  })
})
