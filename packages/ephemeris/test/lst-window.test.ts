import { describe, expect, test } from 'bun:test'
import { type EphemerisError, lstWindowTest } from '../src/index.js'
import { binomialBand, inWindow, syntheticTrials } from './helpers/data.js'

function combinations(n: number, k: number): number[][] {
  const out: number[][] = []
  const pick = (start: number, chosen: number[]) => {
    if (chosen.length === k) {
      out.push(chosen.slice())
      return
    }
    for (let i = start; i < n; i++) {
      chosen.push(i)
      pick(i + 1, chosen)
      chosen.pop()
    }
  }
  pick(0, [])
  return out
}

describe('lstWindowTest', () => {
  test('group means and the circular half-open window', () => {
    const trials = [
      { lstHours: 23.5, effect: 3 },
      { lstHours: 0.99, effect: 5 },
      { lstHours: 1, effect: 100 }, // just outside [23, 1)
      { lstHours: 12, effect: 1 },
    ]
    const r = lstWindowTest(trials, { centerHours: 0, halfWidthHours: 1, permutations: 10 })
    expect(r.inside).toEqual({ n: 2, mean: 4 })
    expect(r.outside).toEqual({ n: 2, mean: 50.5 })
    expect(r.difference).toBe(-46.5)
    expect(r.overallMean).toBe(27.25)
    expect(r.gain).toBeCloseTo(4 / 27.25, 12)
  })

  test('Monte Carlo p converges to the exact proportion over all C(10, 4) splits', () => {
    const lstHours = [1, 3, 5, 12.6, 13.1, 13.9, 14.2, 18, 20, 22]
    const effects = [0.1, -0.4, 0.3, 1.2, 0.8, -0.2, 0.9, 0.5, -1.0, 0.0]
    const trials = lstHours.map((h, i) => ({ lstHours: h, effect: effects[i] as number }))
    const inside = lstHours.map((h) => inWindow(h, 13.47, 2))
    const nIn = inside.filter(Boolean).length
    const observed = effects.filter((_, i) => inside[i]).reduce((a, b) => a + b, 0)
    const splits = combinations(10, nIn)
    const exact =
      splits.filter(
        (idx) => idx.reduce((s, i) => s + (effects[i] as number), 0) >= observed - 1e-12,
      ).length / splits.length
    const m = 50000
    const r = lstWindowTest(trials, {
      centerHours: 13.47,
      halfWidthHours: 1,
      permutations: m,
      seed: 3,
    })
    expect(r.inside.n).toBe(nIn)
    const se = Math.sqrt((exact * (1 - exact)) / m)
    expect(Math.abs(r.exceedances / m - exact)).toBeLessThan(5 * se)
  })

  test('detects a planted window effect and stays calibrated under the null', () => {
    const planted = syntheticTrials(400, 8, 0.8, 12.47, 14.47)
    const hit = lstWindowTest(planted, { centerHours: 13.47, halfWidthHours: 1, permutations: 999 })
    expect(hit.pValue).toBeLessThan(0.01)

    const datasets = 300
    let rejections = 0
    for (let d = 0; d < datasets; d++) {
      const trials = syntheticTrials(60, 700 + d)
      const r = lstWindowTest(trials, {
        centerHours: 13.47,
        halfWidthHours: 2,
        permutations: 19,
        seed: d,
      })
      if (r.pValue <= 0.05) rejections++
    }
    const band = binomialBand(datasets, 0.05, 0.001)
    expect(rejections).toBeGreaterThanOrEqual(band[0])
    expect(rejections).toBeLessThanOrEqual(band[1])
  })

  test('strata keep between-study differences out of the null', () => {
    const trials = [
      ...syntheticTrials(100, 1, 0, 0, 0).map((t) => ({
        lstHours: 12 + (t.lstHours / 24) * 3,
        effect: t.effect + 1.5,
        stratum: 1,
      })),
      ...syntheticTrials(300, 2).map((t) => ({ ...t, stratum: 2 })),
    ]
    const pooled = trials.map(({ lstHours, effect }) => ({ lstHours, effect }))
    const opts = { centerHours: 13.5, halfWidthHours: 1.5, permutations: 499, seed: 5 }
    expect(lstWindowTest(pooled, opts).pValue).toBeLessThan(0.01)
    const stratified = lstWindowTest(trials, opts)
    expect(stratified.stratified).toBe(true)
    expect(stratified.pValue).toBeGreaterThan(0.01)
  })

  test('deterministic for a seed', () => {
    const trials = syntheticTrials(120, 4, 0.2)
    const opts = { centerHours: 6, halfWidthHours: 3, permutations: 200, seed: 9n }
    expect(lstWindowTest(trials, opts)).toEqual(lstWindowTest(trials, opts))
  })

  test('validation', () => {
    const trials = syntheticTrials(30, 5)
    const codeOf = (run: () => unknown) => {
      try {
        run()
      } catch (error) {
        return (error as EphemerisError).code
      }
      return undefined
    }
    expect(codeOf(() => lstWindowTest(trials, undefined as never))).toBe('invalid_options')
    expect(codeOf(() => lstWindowTest(trials, { centerHours: 24, halfWidthHours: 1 }))).toBe(
      'invalid_options',
    )
    expect(codeOf(() => lstWindowTest(trials, { centerHours: 1, halfWidthHours: 12 }))).toBe(
      'invalid_options',
    )
    expect(
      codeOf(() =>
        lstWindowTest(
          [
            { lstHours: 1, effect: 0 },
            { lstHours: 2, effect: 1 },
          ],
          {
            centerHours: 12,
            halfWidthHours: 1,
          },
        ),
      ),
    ).toBe('insufficient_data')
    expect(
      codeOf(() => lstWindowTest(trials, { centerHours: 1, halfWidthHours: 1, permutations: 1e8 })),
    ).toBe('invalid_options')
  })
})
