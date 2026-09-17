import { describe, expect, test } from 'bun:test'
import { NegentropyError } from '../../src/errors.js'
import { autocorrelation } from '../../src/estimators/autocorrelation.js'
import { varianceRatio } from '../../src/stats/variance-ratio.js'
import { gaussians } from '../helpers/byte-sources.js'
import { sequentialFixtures as fixtures } from '../helpers/sequential-fixtures.js'

describe('varianceRatio (Lo–MacKinlay 1988)', () => {
  test('matches arch.unitroot.VarianceRatio (overlapping, debiased; plain and robust)', () => {
    for (const c of fixtures.varianceRatio) {
      const x = c.series === 'iid' ? fixtures.series.iid : fixtures.series.ar
      const result = varianceRatio(x, c.q)
      expect(result.q).toBe(c.q)
      expect(result.n).toBe(x.length)
      expect(result.ratio).toBeCloseTo(c.ratio, 12)
      expect(result.statistic).toBeCloseTo(c.statistic, 10)
      expect(result.robust.statistic).toBeCloseTo(c.robustStatistic, 10)
      expect(Math.abs(result.pValue - c.pValue)).toBeLessThan(1e-12 + 1e-9 * c.pValue)
      expect(Math.abs(result.robust.pValue - c.robustPValue)).toBeLessThan(
        1e-12 + 1e-9 * c.robustPValue,
      )
    }
  })

  test('VR(2) ≈ 1 + ρ̂(1)', () => {
    const x = gaussians(5000, 0x81).map(
      (v, i, all) => v + 0.2 * (i > 0 ? (all[i - 1] as number) : 0),
    )
    const rho1 = autocorrelation(x, 1)[1] as number
    expect(Math.abs(varianceRatio(x, 2).ratio - (1 + rho1))).toBeLessThan(0.002)
  })

  test('H0 calibration: the iid z rejects at about the nominal rate', () => {
    const reps = 1000
    const n = 1000
    const g = gaussians(reps * n, 0x82)
    let rejected = 0
    let rejectedRobust = 0
    for (let r = 0; r < reps; r++) {
      const result = varianceRatio(g.subarray(r * n, (r + 1) * n), 4)
      if (result.pValue < 0.05) rejected++
      if (result.robust.pValue < 0.05) rejectedRobust++
    }
    const tolerance = 4 * Math.sqrt((0.05 * 0.95) / reps)
    expect(Math.abs(rejected / reps - 0.05)).toBeLessThan(tolerance)
    expect(Math.abs(rejectedRobust / reps - 0.05)).toBeLessThan(tolerance)
  }, 30_000)

  test('validation', () => {
    expect(() => varianceRatio([1, 2, 3], 1)).toThrow(NegentropyError)
    expect(() => varianceRatio([1, 2, 3], 2.5)).toThrow(NegentropyError)
    expect(() => varianceRatio([1, 2], 2)).toThrow(NegentropyError)
    expect(() => varianceRatio([1, 1, 1, 1], 2)).toThrow(NegentropyError)
    expect(() => varianceRatio([1, Number.NaN, 2, 3], 2)).toThrow(NegentropyError)
  })
})
