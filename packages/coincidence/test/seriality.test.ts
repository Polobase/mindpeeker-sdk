import { describe, expect, test } from 'bun:test'
import { MAX_WINDOWS, seriesClustering } from '../src/index.js'
import fixture from './fixtures/series.json' with { type: 'json' }
import { expectCoincidenceError, expectInvalid } from './helpers/errors.js'
import { expectClose, forEachTuple, rat, seeded, toNumber } from './helpers/exact.js'

describe('seriesClustering', () => {
  test('counts, exact p-values and dispersion moments agree with fractions (fixture)', () => {
    for (const c of fixture.cases) {
      const span = { start: c.span[0] as number, end: c.span[1] as number }
      const result = seriesClustering(c.times, {
        window: c.window,
        span,
        ...(c.rate === null ? {} : { rate: c.rate }),
      })
      expect(result.counts).toEqual(c.counts)
      expect(result.maxCount).toBe(c.maxCount)
      expect(result.null).toBe(c.rate === null ? 'conditional' : 'poisson')
      expectClose(result.pValue, c.pValue, 1e-13)
      result.expected.forEach((e, i) => {
        expectClose(e, c.expected[i] as number, 1e-14)
      })
      if (result.dispersion === null) throw new Error('dispersion expected')
      expectClose(result.dispersion.statistic, c.dispersion, 1e-13)
      expect(result.dispersion.mean).toBe(c.dispersionMean)
      expectClose(result.dispersion.variance, c.dispersionVariance, 1e-13)
    }
  })

  test("Haldane's exact variance of Pearson's X² (fixture enumeration)", () => {
    // n = 5 over 3 equal windows; n = 6 over windows of lengths 1, 1, 1, ½
    const equal = seriesClustering([0.1, 0.2, 1.5, 2.5, 2.6], { window: 1, span: 3 })
    const partial = seriesClustering([0.1, 1.2, 1.3, 2.4, 3.1, 3.2], { window: 1, span: 3.5 })
    const [a, b] = fixture.pearsonMoments
    expectClose(equal.dispersion?.mean ?? Number.NaN, a?.mean ?? 0, 1e-15)
    expectClose(equal.dispersion?.variance ?? Number.NaN, a?.variance ?? 0, 1e-14)
    expectClose(partial.dispersion?.mean ?? Number.NaN, b?.mean ?? 0, 1e-15)
    expectClose(partial.dispersion?.variance ?? Number.NaN, b?.variance ?? 0, 1e-14)
  })

  test('p-value equals brute-force enumeration of window assignments (BigInt)', () => {
    const windows = 3
    for (let n = 1; n <= 7; n++) {
      // put the first ceil(n/2) events in window 0, the rest spread out
      const times = Array.from({ length: n }, (_, i) =>
        i < Math.ceil(n / 2) ? 0.5 : 1 + ((i % 2) + 0.5),
      )
      const result = seriesClustering(times, { window: 1, span: windows })
      let atLeast = 0n
      forEachTuple(windows, n, (tuple) => {
        const counts = new Array<number>(windows).fill(0)
        for (const x of tuple) counts[x] = (counts[x] as number) + 1
        if (Math.max(...counts) >= result.maxCount) atLeast++
      })
      expectClose(result.pValue, toNumber(rat(atLeast, BigInt(windows) ** BigInt(n))), 1e-14)
    }
  })

  test('the conditional p-value is valid under the null (seeded uniform times)', () => {
    const next = seeded(1919)
    const runs = 3000
    let rejections = 0
    for (let run = 0; run < runs; run++) {
      const times = Array.from({ length: 20 }, () => next() * 30)
      if (seriesClustering(times, { window: 1, span: 30 }).pValue <= 0.05) rejections++
    }
    // P(p ≤ 0.05) ≤ 0.05 exactly (discrete, conservative); allow 3 SE of Monte-Carlo noise
    expect(rejections / runs).toBeLessThanOrEqual(0.05 + 3 * Math.sqrt((0.05 * 0.95) / runs))
  })

  test('a Kammerer-style burst is flagged; a spread-out log is not', () => {
    const burst = seriesClustering([1.1, 1.2, 1.3, 1.4, 1.5, 10.5, 20.5], { window: 1, span: 30 })
    expect(burst.maxCount).toBe(5)
    expect(burst.maxWindow).toBe(1)
    expect(burst.maxWindowStart).toBe(1)
    expect(burst.pValue).toBeLessThan(0.001)
    expect(burst.dispersion?.z ?? 0).toBeGreaterThan(3)
    const spread = seriesClustering([1.5, 5.5, 9.5, 13.5, 17.5, 21.5, 25.5], {
      window: 1,
      span: 30,
    })
    expect(spread.maxCount).toBe(1)
    expect(spread.pValue).toBe(1)
  })

  test('edges: no events, end point, Float64Array, single window', () => {
    const none = seriesClustering([], { window: 1, span: 7 })
    expect(none.pValue).toBe(1)
    expect(none.dispersion).toBeNull()
    const noneRate = seriesClustering([], { window: 1, span: 7, rate: 1 })
    expect(noneRate.pValue).toBe(1)
    expect(noneRate.dispersion?.mean).toBe(7)
    const end = seriesClustering(new Float64Array([0, 7]), { window: 1, span: 7 })
    expect(end.counts).toEqual([1, 0, 0, 0, 0, 0, 1])
    const single = seriesClustering([0.2, 0.4], { window: 5, span: 3 })
    expect(single.windows).toBe(1)
    expect(single.pValue).toBe(1)
    expect(single.dispersion?.z).toBeNull()
    // a ratio that rounds just above an integer does not create a sliver window
    expect(0.07 / 0.01).toBeGreaterThan(7)
    expect(seriesClustering([0.01], { window: 0.01, span: 0.07 }).windows).toBe(7)
  })

  test('validates before computing', () => {
    expectInvalid(
      () => seriesClustering([1], undefined as unknown as { window: 1; span: 2 }),
      'options',
    )
    expectInvalid(
      () => seriesClustering('1' as unknown as number[], { window: 1, span: 2 }),
      'times',
    )
    expectInvalid(() => seriesClustering([1], { window: 0, span: 2 }), 'options.window')
    expectInvalid(() => seriesClustering([1], { window: 1, span: -2 }), 'options.span')
    expectInvalid(
      () => seriesClustering([1], { window: 1, span: { start: 2, end: 2 } }),
      'options.span',
    )
    expectInvalid(
      () => seriesClustering([1], { window: 1, span: { start: Number.NaN, end: 2 } }),
      'options.span.start',
    )
    expectInvalid(() => seriesClustering([3], { window: 1, span: 2 }), 'times[0]')
    expectInvalid(() => seriesClustering([1, Number.NaN], { window: 1, span: 2 }), 'times[1]')
    expectInvalid(() => seriesClustering([1], { window: 1, span: 2, rate: 0 }), 'options.rate')
    expectCoincidenceError(
      () => seriesClustering([1], { window: 1, span: MAX_WINDOWS + 1 }),
      'too_large',
      'options.window',
    )
  })
})
