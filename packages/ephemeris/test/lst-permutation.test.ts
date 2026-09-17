import { describe, expect, test } from 'bun:test'
import { EphemerisError, type LstLabelledTrial, lstPermutationTest } from '../src/index.js'
import {
  binomialBand,
  bruteWindowMeans,
  mulberry32,
  normal,
  syntheticTrials,
} from './helpers/data.js'

function permutationsOf<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()]
  const out: T[][] = []
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)]
    for (const p of permutationsOf(rest)) out.push([item, ...p])
  })
  return out
}

const peakOf = (trials: readonly LstLabelledTrial[], w: number, step: number): number =>
  Math.max(...bruteWindowMeans(trials, w, step).flatMap((b) => (b.mean === null ? [] : [b.mean])))

describe('lstPermutationTest', () => {
  test('Monte Carlo exceedance rate converges to the exact enumeration over all 7! relabelings', () => {
    const lstHours = [0.3, 2.1, 5.5, 12.9, 13.4, 13.8, 20.2]
    const effects = [0.2, -1.1, 0.4, 2.3, 1.7, -0.6, 0.9]
    const trials = lstHours.map((h, i) => ({ lstHours: h, effect: effects[i] as number }))
    const observed = peakOf(trials, 2, 1)
    const all = permutationsOf(effects)
    const exact =
      all.filter((perm) => {
        const relabeled = lstHours.map((h, i) => ({ lstHours: h, effect: perm[i] as number }))
        return peakOf(relabeled, 2, 1) >= observed - 1e-12
      }).length / all.length
    const m = 40000
    const result = lstPermutationTest(trials, { stepHours: 1, permutations: m, seed: 1 })
    expect(result.statistic).toBeCloseTo(observed, 12)
    const se = Math.sqrt((exact * (1 - exact)) / m)
    expect(Math.abs(result.exceedances / m - exact)).toBeLessThan(5 * se)
    expect(result.pValue).toBe((1 + result.exceedances) / (1 + m))
  })

  test('detects a planted LST effect near 13.5 h', () => {
    const trials = syntheticTrials(600, 2024, 1.0, 12.5, 14.5)
    const result = lstPermutationTest(trials, { permutations: 199, seed: 7 })
    expect(result.exceedances).toBe(0)
    expect(result.pValue).toBe(1 / 200)
    expect(Math.abs(result.scan.peak.centerHours - 13.5)).toBeLessThan(0.75)
    expect(Math.abs(result.scan.peak.centroidHours - 13.5)).toBeLessThan(0.75)
  })

  test('null calibration: P(p ≤ α) matches α over 300 null datasets', () => {
    const datasets = 300
    const m = 39 // p ∈ {1/40, …, 1}: P(p ≤ 0.05) = 2/40 and P(p ≤ 0.25) = 10/40 exactly
    let at05 = 0
    let at25 = 0
    for (let d = 0; d < datasets; d++) {
      const trials = syntheticTrials(80, 5000 + d)
      const { pValue } = lstPermutationTest(trials, { permutations: m, seed: d })
      if (pValue <= 0.05) at05++
      if (pValue <= 0.25) at25++
    }
    const band05 = binomialBand(datasets, 0.05, 0.001)
    const band25 = binomialBand(datasets, 0.25, 0.001)
    expect(at05).toBeGreaterThanOrEqual(band05[0])
    expect(at05).toBeLessThanOrEqual(band05[1])
    expect(at25).toBeGreaterThanOrEqual(band25[0])
    expect(at25).toBeLessThanOrEqual(band25[1])
  })

  test('study mix confound: unstratified nulls reject, stratified nulls stay calibrated', () => {
    // Study A ran only between 12 h and 15 h LST and scores higher overall; neither study has
    // any LST dependence within itself.
    const datasets = 100
    let unstratified = 0
    let stratified = 0
    for (let d = 0; d < datasets; d++) {
      const random = mulberry32(9000 + d)
      const gauss = normal(random)
      const trials: LstLabelledTrial[] = [
        ...Array.from({ length: 150 }, () => ({
          lstHours: 12 + random() * 3,
          effect: 1.5 + gauss(),
          stratum: 'A',
        })),
        ...Array.from({ length: 1200 }, () => ({
          lstHours: random() * 24,
          effect: gauss(),
          stratum: 'B',
        })),
      ]
      const withStrata = lstPermutationTest(trials, { permutations: 19, seed: d })
      expect(withStrata.stratified).toBe(true)
      expect(withStrata.strata).toBe(2)
      if (withStrata.pValue <= 0.05) stratified++
      const pooled = trials.map(({ lstHours, effect }) => ({ lstHours, effect }))
      if (lstPermutationTest(pooled, { permutations: 19, seed: d }).pValue <= 0.05) unstratified++
    }
    expect(unstratified / datasets).toBeGreaterThan(0.9)
    const band = binomialBand(datasets, 0.05, 0.001)
    expect(stratified).toBeLessThanOrEqual(band[1])
  })

  test('deterministic for a seed; seeds change the ensemble', () => {
    const trials = syntheticTrials(150, 77, 0.3)
    const a = lstPermutationTest(trials, { permutations: 299, seed: 'c0ffee' })
    const b = lstPermutationTest(trials, { permutations: 299, seed: 'c0ffee' })
    expect(b).toEqual(a)
    const c = lstPermutationTest(trials, { permutations: 299, seed: 12345 })
    expect(c.statistic).toBe(a.statistic)
  })

  test('validation', () => {
    const trials = syntheticTrials(10, 1)
    const codeOf = (run: () => unknown) => {
      try {
        run()
      } catch (error) {
        return (error as EphemerisError).code
      }
      return undefined
    }
    expect(codeOf(() => lstPermutationTest(trials.slice(0, 1)))).toBe('insufficient_data')
    expect(codeOf(() => lstPermutationTest(trials, { permutations: 0 }))).toBe('invalid_options')
    expect(codeOf(() => lstPermutationTest(trials, { permutations: 1.5 }))).toBe('invalid_options')
    expect(codeOf(() => lstPermutationTest(trials, { seed: -3 }))).toBe('invalid_options')
    expect(() => lstPermutationTest(trials, { stepHours: 5 })).toThrow(EphemerisError)
  })
})
