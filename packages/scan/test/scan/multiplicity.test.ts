import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deviationStat } from '../../src/scan/deviation.js'
import { adjustFamily } from '../../src/scan/multiplicity.js'

const fx = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'fixtures', 'multiplicity.json'), 'utf8'),
) as {
  n: number
  alpha: number
  counts: number[]
  p: number[]
  pBonferroni: number[]
  pHolm: number[]
  qBH: number[]
  omnibusStatistic: number
  omnibusP: number
}

describe('adjustFamily vs statsmodels multipletests', () => {
  const stats = fx.counts.map((k) => deviationStat(k, fx.n))
  const { adjusted, summary } = adjustFamily(stats, fx.alpha)

  test('Bonferroni, Holm, and BH adjusted p-values per item', () => {
    adjusted.forEach((r, i) => {
      expect(r.p).toBeCloseTo(fx.p[i] as number, 12)
      expect(r.pBonferroni).toBeCloseTo(fx.pBonferroni[i] as number, 12)
      expect(r.pHolm).toBeCloseTo(fx.pHolm[i] as number, 12)
      expect(r.qBH).toBeCloseTo(fx.qBH[i] as number, 12)
    })
  })

  test('family summary: expected false positives, counts, omnibus χ²', () => {
    const m = fx.counts.length
    expect(summary.tests).toBe(m)
    expect(summary.alpha).toBe(fx.alpha)
    expect(summary.bonferroniAlpha).toBeCloseTo(fx.alpha / m, 15)
    expect(summary.expectedFalsePositives).toBeCloseTo(m * fx.alpha, 15)
    expect(summary.nominalHits).toBe(fx.p.filter((p) => p <= fx.alpha).length)
    expect(summary.holmRejections).toBe(fx.pHolm.filter((p) => p <= fx.alpha).length)
    expect(summary.bhRejections).toBe(fx.qBH.filter((p) => p <= fx.alpha).length)
    expect(summary.omnibus.df).toBe(m)
    expect(summary.omnibus.statistic).toBeCloseTo(fx.omnibusStatistic, 10)
    expect(summary.omnibus.p).toBeCloseTo(fx.omnibusP, 12)
  })
})
