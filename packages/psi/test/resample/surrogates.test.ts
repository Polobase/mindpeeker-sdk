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
    expect(() => [...timeOffsetSurrogates([a, b], { surrogates: 2, count: 3 })]).toThrow(
      bad('invalid_plan'),
    )
    // biome-ignore lint/suspicious/noExplicitAny: deliberately unknown mode
    expect(() => [...timeOffsetSurrogates([a, b], { rotate: 'some' as any })]).toThrow(
      bad('invalid_plan'),
    )
    expect(() => [...timeOffsetSurrogates([a, b], { seed: 1 })]).toThrow(bad('invalid_plan'))
    expect(() => [...timeOffsetSurrogates([a, b], { design: 'latin' })]).toThrow(
      bad('invalid_plan'),
    )
    expect(() => [...timeOffsetSurrogates([a, b], { rotate: 'all', sourceIndex: 1 })]).toThrow(
      bad('invalid_plan'),
    )
    expect(() => [...timeOffsetSurrogates([a], { rotate: 'all-but-one' })]).toThrow(
      bad('invalid_plan'),
    )
    expect(() => [
      ...timeOffsetSurrogates([a, b], { rotate: 'all-but-one', offsets: [1] }),
    ]).toThrow(bad('invalid_plan'))
    expect(() => [
      ...timeOffsetSurrogates([a, b], { rotate: 'all-but-one', design: 'latin', seed: 3 }),
    ]).toThrow(bad('invalid_plan'))
    const tiny = [series('x', [1, 2]), series('y', [1, 2]), series('z', [1, 2])]
    expect(() => [...timeOffsetSurrogates(tiny, { rotate: 'all-but-one' })]).toThrow(
      bad('insufficient_data'),
    )
    expect(() => [...timeOffsetSurrogates([a, b], { sourceOffsets: [] })]).toThrow(
      bad('invalid_plan'),
    )
    expect(() => [...timeOffsetSurrogates([a, b], { sourceOffsets: [[1]] })]).toThrow(
      bad('invalid_plan'),
    )
    expect(() => [...timeOffsetSurrogates([a, b], { sourceOffsets: [[3, 13]] })]).toThrow(
      bad('invalid_plan'),
    )
    expect(() => [
      ...timeOffsetSurrogates([a, b], { sourceOffsets: [[0, 1]], rotate: 'one' }),
    ]).toThrow(bad('invalid_plan'))
  })
})

/** Deterministic N(0,1) draws (Box–Muller over the seeded xorshift uniforms). */
function gaussians(n: number, seed: number): number[] {
  const u = prngUniforms(2 * n, seed)
  return Array.from(
    { length: n },
    (_, i) =>
      Math.sqrt(-2 * Math.log(u[2 * i] as number)) *
      Math.cos(2 * Math.PI * (u[2 * i + 1] as number)),
  )
}

/** Pseudo-z series: sums on a k = 16 grid scaled so (sum − 8)/2 is the given value. */
function zSeries(source: string, z: readonly number[]): TrialSeries {
  return series(
    source,
    z.map((v) => 8 + 2 * v),
  )
}

/** netvar over whole series: Σ_t (Σ_i z_i(t))² / N. */
function netvarOf(set: readonly TrialSeries[]): number {
  const steps = (set[0] as TrialSeries).sums.length
  let total = 0
  for (let t = 0; t < steps; t++) {
    let column = 0
    for (const s of set) column += ((s.sums[t] as number) - 8) / 2
    total += (column * column) / set.length
  }
  return total
}

describe('timeOffsetSurrogates — multi-source modes', () => {
  test("rotate: 'all-but-one' random design matches the reference and misaligns every pair", () => {
    const set = [0, 1, 2].map((i) => zSeries(`s${i}`, gaussians(10, 100 + i)))
    const vectors = [
      ...timeOffsetSurrogates(set, { rotate: 'all-but-one', surrogates: 3, seed: 5 }),
    ]
    // independent Python partial Fisher–Yates over the same splitmix64 → xoshiro128** stream
    expect(vectors.map((v) => v.offsets)).toEqual([
      [0, 9, 2],
      [0, 4, 7],
      [0, 4, 5],
    ])
    expect(vectors[0]?.offset).toBe(9)
    expect(vectors[0]?.series[0]).toBe(set[0] as TrialSeries) // reference shared by reference
    const big = [0, 1, 2, 3].map((i) => zSeries(`b${i}`, gaussians(1000, 200 + i)))
    const ref = [
      ...timeOffsetSurrogates(big, {
        rotate: 'all-but-one',
        sourceIndex: 2,
        surrogates: 2,
        seed: 11,
      }),
    ]
    expect(ref.map((v) => v.offsets)).toEqual([
      [670, 752, 0, 5],
      [497, 867, 0, 690],
    ])
    for (const v of [...timeOffsetSurrogates(big, { rotate: 'all-but-one', surrogates: 50 })]) {
      expect(new Set(v.offsets).size).toBe(4) // pairwise distinct, reference 0
      expect(v.offsets[0]).toBe(0)
    }
  })

  test("rotate: 'all-but-one' latin design uses coprime multipliers r·g mod T", () => {
    const set = [0, 1, 2].map((i) => zSeries(`s${i}`, gaussians(10, 300 + i)))
    const latin = [
      ...timeOffsetSurrogates(set, { rotate: 'all-but-one', design: 'latin', surrogates: 3 }),
    ]
    // starts round((j+1)·10/4) = 3, 5, 8 → coprime g = 3, 7, 9
    expect(latin.map((v) => v.offsets)).toEqual([
      [0, 3, 6],
      [0, 7, 4],
      [0, 9, 8],
    ])
    // φ(10) = 4 multipliers exist: asking for more yields at most 4
    expect(
      [...timeOffsetSurrogates(set, { rotate: 'all-but-one', design: 'latin', surrogates: 9 })]
        .length,
    ).toBe(4)
  })

  test("rotate: 'all' shifts every source together (pseudo-event) and keeps cross terms", () => {
    const set = [0, 1].map((i) => zSeries(`s${i}`, gaussians(10, 400 + i)))
    const [surrogate] = [...timeOffsetSurrogates(set, { rotate: 'all', offsets: [4] })]
    expect(surrogate?.offsets).toEqual([4, 4])
    for (let i = 0; i < 2; i++) {
      const rotated = surrogate?.series[i] as TrialSeries
      for (let t = 0; t < 10; t++) {
        expect(rotated.sums[t]).toBe((set[i] as TrialSeries).sums[(t + 4) % 10] as number)
      }
    }
    // a whole-series statistic is invariant under a common rotation
    expect(netvarOf(surrogate?.series ?? [])).toBeCloseTo(netvarOf(set), 12)
  })

  test('explicit sourceOffsets are normalized and applied per source', () => {
    const set = [0, 1, 2].map((i) => zSeries(`s${i}`, gaussians(10, 500 + i)))
    const [surrogate] = [...timeOffsetSurrogates(set, { sourceOffsets: [[0, -1, 12]] })]
    expect(surrogate?.offsets).toEqual([0, 9, 2])
    expect(surrogate?.offset).toBe(9)
    expect((surrogate?.series[2] as TrialSeries).sums[0]).toBe(
      (set[2] as TrialSeries).sums[2] as number,
    )
  })

  test("N = 3 with a shared signal on sources 1–2: 'one' keeps the effect in the null, 'all-but-one' removes it", () => {
    const T = 400
    const common = gaussians(T, 900)
    const z0 = gaussians(T, 901)
    const z1 = gaussians(T, 902).map((v, t) => 0.7 * v + 0.7 * (common[t] as number))
    const z2 = gaussians(T, 903).map((v, t) => 0.7 * v + 0.7 * (common[t] as number))
    const set = [zSeries('a', z0), zSeries('b', z1), zSeries('c', z2)]
    const observed = netvarOf(set)
    const single = [...timeOffsetSurrogates(set, { surrogates: 99 })].map((s) => netvarOf(s.series))
    const all = [...timeOffsetSurrogates(set, { rotate: 'all-but-one', surrogates: 99 })].map((s) =>
      netvarOf(s.series),
    )
    const mean = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / xs.length
    // E[single-rotation null] retains the b–c cross term; the all-but-one null centres near T·(1+…)
    expect(mean(single)).toBeGreaterThan(mean(all) + 0.1 * T)
    expect(permutationP(observed, all)).toBeLessThan(permutationP(observed, single))
    expect(permutationP(observed, all)).toBeLessThanOrEqual(0.05)
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
