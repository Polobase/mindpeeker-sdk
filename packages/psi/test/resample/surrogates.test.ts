import { describe, expect, test } from 'bun:test'
import { permutationP, timeOffsetSurrogates } from '../../src/resample/surrogates.js'
import type { TrialSeries } from '../../src/types.js'
import { prngUniforms } from '../helpers/trial-sources.js'

function series(source: string, sums: number[], k = 16): TrialSeries {
  return {
    source,
    bitsPerTrial: k,
    sums: Float64Array.from(sums),
    timestamps: Float64Array.from(sums.map((_, i) => i * 1000)),
  }
}

describe('timeOffsetSurrogates', () => {
  const a = series('a', [10, 8, 6, 8, 9, 7, 10, 6, 8, 9])
  const b = series('b', [8, 8, 10, 6, 7, 9, 6, 10, 9, 8])

  test('rotation is circular and exact', () => {
    const [first] = [...timeOffsetSurrogates([a, b], { offsets: [3] })]
    expect(first?.offset).toBe(3)
    const rotated = first?.series[0] as TrialSeries
    for (let t = 0; t < 10; t++) {
      expect(rotated.sums[t]).toBe(a.sums[(t + 3) % 10] as number)
    }
  })

  test('preserves marginals: rotated sums are a permutation, timestamps untouched', () => {
    for (const surrogate of timeOffsetSurrogates([a, b], { count: 9 })) {
      const rotated = surrogate.series[0] as TrialSeries
      expect([...rotated.sums].sort((x, y) => x - y)).toEqual([...a.sums].sort((x, y) => x - y))
      expect(rotated.timestamps).toEqual(a.timestamps as Float64Array)
      expect(surrogate.series[1]).toBe(b) // untouched sources are shared by reference
    }
  })

  test('default offsets are evenly spaced, deduplicated, nonzero', () => {
    const offsets = [...timeOffsetSurrogates([a, b], { count: 3 })].map((s) => s.offset)
    expect(offsets).toEqual([3, 5, 8]) // round((i+1)·10/4)
    const all = [...timeOffsetSurrogates([a, b])].map((s) => s.offset)
    expect(all).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]) // count defaults to steps − 1
    expect(new Set(all).size).toBe(all.length)
  })

  test('negative offsets are normalized modulo steps', () => {
    const [surrogate] = [...timeOffsetSurrogates([a, b], { offsets: [-1] })]
    expect(surrogate?.offset).toBe(9)
  })

  test('rotating a chosen source via sourceIndex', () => {
    const [surrogate] = [...timeOffsetSurrogates([a, b], { offsets: [2], sourceIndex: 1 })]
    expect(surrogate?.series[0]).toBe(a)
    expect((surrogate?.series[1] as TrialSeries).sums[0]).toBe(b.sums[2] as number)
  })

  test('destroys cross-source correlation: identical series score below zero offset', () => {
    // Σ x_t x_{t+τ} < Σ x_t² for τ ≠ 0 (rearrangement inequality, generic values)
    const values = [...prngUniforms(50, 777)].map((u) => 8 + Math.round(4 * u))
    const s1 = series('a', values)
    const s2 = series('b', values)
    const product = (x: TrialSeries, y: TrialSeries) => {
      let sum = 0
      for (let t = 0; t < x.sums.length; t++) {
        sum += ((x.sums[t] as number) - 10) * ((y.sums[t] as number) - 10)
      }
      return sum
    }
    const observed = product(s1, s2)
    const nulls = [...timeOffsetSurrogates([s1, s2], { count: 49 })].map((s) =>
      product(s.series[0] as TrialSeries, s.series[1] as TrialSeries),
    )
    for (const n of nulls) expect(n).toBeLessThan(observed)
    expect(permutationP(observed, nulls)).toBeCloseTo(1 / 50, 12)
  })

  test('error paths', () => {
    const bad = (code: string) => expect.objectContaining({ code }) as unknown as Error
    expect(() => [...timeOffsetSurrogates([], {})]).toThrow(bad('invalid_plan'))
    expect(() => [...timeOffsetSurrogates([a, series('b', [1, 2, 3])])]).toThrow(
      bad('source_mismatch'),
    )
    expect(() => [...timeOffsetSurrogates([series('a', [5])])]).toThrow(bad('insufficient_data'))
    expect(() => [...timeOffsetSurrogates([a, b], { offsets: [0] })]).toThrow(bad('invalid_plan'))
    expect(() => [...timeOffsetSurrogates([a, b], { offsets: [10] })]).toThrow(bad('invalid_plan'))
    expect(() => [...timeOffsetSurrogates([a, b], { offsets: [1.5] })]).toThrow(bad('invalid_plan'))
    expect(() => [...timeOffsetSurrogates([a, b], { offsets: [] })]).toThrow(bad('invalid_plan'))
    expect(() => [...timeOffsetSurrogates([a, b], { sourceIndex: 2 })]).toThrow(bad('invalid_plan'))
    expect(() => [...timeOffsetSurrogates([a, b], { count: 0 })]).toThrow(bad('invalid_plan'))
  })
})

describe('permutationP', () => {
  test('+1 corrected count of surrogates ≥ observed', () => {
    expect(permutationP(5, [1, 2, 3, 4])).toBeCloseTo(1 / 5, 12)
    expect(permutationP(2, [1, 2, 3])).toBeCloseTo(3 / 4, 12) // tie counts against
    expect(permutationP(0, [1, 2, 3])).toBeCloseTo(1, 12)
    expect(permutationP(9, [1])).toBeCloseTo(1 / 2, 12)
  })

  test('never returns 0 or exceeds 1', () => {
    expect(permutationP(Number.MAX_VALUE, new Float64Array(999))).toBeGreaterThan(0)
    expect(permutationP(-1, [0, 0, 0])).toBeLessThanOrEqual(1)
  })

  test('error paths', () => {
    expect(() => permutationP(1, [])).toThrow(
      expect.objectContaining({ code: 'insufficient_data' }) as unknown as Error,
    )
    expect(() => permutationP(Number.NaN, [1])).toThrow(
      expect.objectContaining({ code: 'invalid_plan' }) as unknown as Error,
    )
    expect(() => permutationP(1, [Number.POSITIVE_INFINITY])).toThrow(
      expect.objectContaining({ code: 'invalid_plan' }) as unknown as Error,
    )
  })
})
