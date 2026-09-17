import { describe, expect, test } from 'bun:test'
import {
  deflatedCriticalValue,
  expectedMaxOfLooks,
  expectedMaxOfPmf,
  maxOfLooksPValue,
  optionalStoppingRisk,
} from '../src/index.js'
import { expectClose, expectJudgingError, fixtures } from './helpers/fixtures.js'

describe('expectedMaxOfLooks', () => {
  test('closed forms for I = 1…4', () => {
    expect(expectedMaxOfLooks(1).exact).toBe(0)
    expect(expectedMaxOfLooks(1).approximation).toBeNull()
    expectClose(expectedMaxOfLooks(2).exact, 1 / Math.sqrt(Math.PI), 1e-13)
    expectClose(expectedMaxOfLooks(3).exact, 3 / (2 * Math.sqrt(Math.PI)), 1e-13)
    // E_4 = (3/√π)(½ + asin(⅓)/π)
    expectClose(
      expectedMaxOfLooks(4).exact,
      (3 / Math.sqrt(Math.PI)) * (0.5 + Math.asin(1 / 3) / Math.PI),
      1e-13,
    )
  })

  test('matches mpmath quadrature and the López de Prado approximation', () => {
    for (const c of fixtures.expectedMax) {
      const r = expectedMaxOfLooks(c.looks)
      expectClose(r.exact, c.exact, 1e-12)
      expectClose(r.approximation ?? Number.NaN, c.approximation, 1e-12)
      expect(r.upperBound).toBeGreaterThan(r.exact)
    }
    // the values López de Prado's text implies (checked in the ark-db brief)
    expect(expectedMaxOfLooks(10).exact).toBeCloseTo(1.5388, 4)
    expect(expectedMaxOfLooks(10).approximation).toBeCloseTo(1.5746, 4)
    expect(expectedMaxOfLooks(10000).exact).toBeCloseTo(3.8516, 4)
  })

  test('validates', () => {
    expectJudgingError(() => expectedMaxOfLooks(0), 'invalid_input')
    expectJudgingError(() => expectedMaxOfLooks(2.5), 'invalid_input')
  })
})

describe('expectedMaxOfPmf', () => {
  test('uniform on {0, 1}: E[max of k] = 1 − 2^−k', () => {
    for (const k of [1, 2, 5, 30]) expectClose(expectedMaxOfPmf([0.5, 0.5], k), 1 - 2 ** -k, 1e-15)
    expectClose(expectedMaxOfPmf([0.5, 0.5], 3, 10), 10 + 7 / 8, 1e-15)
  })

  test('validates', () => {
    expectJudgingError(() => expectedMaxOfPmf([0.5, 0.4], 2), 'invalid_input')
    expectJudgingError(() => expectedMaxOfPmf([1.5, -0.5], 2), 'invalid_input')
    expectJudgingError(() => expectedMaxOfPmf([1], 0), 'invalid_input')
    expectJudgingError(() => expectedMaxOfPmf([1], 1, Number.NaN), 'invalid_input')
  })
})

describe('deflatedCriticalValue and maxOfLooksPValue', () => {
  test('Šidák critical values match mpmath', () => {
    for (const c of fixtures.deflated) {
      const r = deflatedCriticalValue(c.looks, { alpha: c.alpha, sided: c.sided })
      expectClose(r.perLookAlpha, c.perLookAlpha, 1e-12)
      expectClose(r.z, c.z, 1e-12)
      expectClose(r.bonferroniZ, c.bonferroniZ, 1e-12)
      expect(r.bonferroniZ).toBeGreaterThanOrEqual(r.z)
    }
    expectClose(deflatedCriticalValue(1).z, 1.6448536269514722, 1e-14)
  })

  test('the p of the best look at its critical value is α', () => {
    for (const looks of [1, 7, 1000]) {
      for (const sided of ['one', 'two'] as const) {
        const { z } = deflatedCriticalValue(looks, { alpha: 0.01, sided })
        expectClose(maxOfLooksPValue(z, looks, { sided }), 0.01, 1e-12)
      }
    }
    expect(maxOfLooksPValue(-50, 3)).toBe(1)
  })

  test('validates', () => {
    expectJudgingError(() => deflatedCriticalValue(0), 'invalid_input')
    expectJudgingError(() => deflatedCriticalValue(3, { alpha: 0 }), 'invalid_options')
    expectJudgingError(
      () => deflatedCriticalValue(3, { sided: 'both' as unknown as 'two' }),
      'invalid_options',
    )
    expectJudgingError(() => maxOfLooksPValue(Number.NaN, 3), 'invalid_input')
  })
})

describe('optionalStoppingRisk', () => {
  test('matches an exact rational DP', () => {
    for (const c of fixtures.optionalStopping) {
      const r = optionalStoppingRisk(c.looks, { p0: c.p0, alpha: c.alpha })
      expect(r.criticalHits).toEqual(c.criticalHits)
      expectClose(r.risk, c.risk, 1e-12)
    }
  })

  test('one look is exactly its own size; more looks only add risk', () => {
    const one = optionalStoppingRisk([100], { p0: 0.25 })
    expectClose(one.risk, one.lookSizes[0] as number, 1e-13)
    expect(one.risk).toBeLessThanOrEqual(0.05)
    const many = optionalStoppingRisk(
      Array.from({ length: 191 }, (_, i) => i + 10),
      { p0: 0.25 },
    )
    expect(many.risk).toBeGreaterThan(3 * 0.05)
    const fewer = optionalStoppingRisk([50, 100, 150, 200], { p0: 0.25 })
    expect(fewer.risk).toBeGreaterThan(one.risk)
    expect(fewer.risk).toBeLessThan(many.risk)
  })

  test('looks that can never reject report null and add nothing', () => {
    // 3 trials at p0 = ½: even 3/3 has P = 1/8 > 0.05
    const r = optionalStoppingRisk([3, 10], { p0: 0.5 })
    expect(r.criticalHits[0]).toBeNull()
    expect(r.lookSizes[0]).toBe(0)
    expectClose(r.risk, r.lookSizes[1] as number, 1e-13)
  })

  test('validates', () => {
    expectJudgingError(() => optionalStoppingRisk([], { p0: 0.5 }), 'invalid_input')
    expectJudgingError(() => optionalStoppingRisk([10, 10], { p0: 0.5 }), 'invalid_input')
    expectJudgingError(() => optionalStoppingRisk([0], { p0: 0.5 }), 'invalid_input')
    expectJudgingError(() => optionalStoppingRisk([10], { p0: 1 }), 'invalid_options')
    expectJudgingError(() => optionalStoppingRisk([10], { p0: 0.5, alpha: 2 }), 'invalid_options')
    expectJudgingError(() => optionalStoppingRisk([100_000], { p0: 0.5 }), 'too_large')
  })
})
