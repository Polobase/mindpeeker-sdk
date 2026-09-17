import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  binomialBayesFactor,
  binomialLogBayesFactor,
  lnBayesFactor,
  resolveBinomialModel,
} from '../../src/bayes/binomial.js'

interface BayesCase {
  k: number
  n: number
  a: number
  b: number
  lnBf10: number
  bf10: number | null
}

interface P0Case {
  k: number
  n: number
  a: number
  b: number
  p0: number
  lnBf10: number
  lnBfPlus?: number
  lnBfMinus?: number
}

const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'fixtures', 'bayes.json'), 'utf8'),
) as { cases: BayesCase[] }

/** mpmath (40 digits) loggamma + quad, side masses cross-checked against scipy betainc/betaincc. */
const p0Fixture = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'fixtures', 'bayes-p0.json'), 'utf8'),
) as { cases: P0Case[] }

/** |actual − expected| ≤ tol·max(1, |expected|). */
function close(actual: number, expected: number, tol: number): boolean {
  return Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected))
}

describe('binomialBayesFactor', () => {
  test('matches the scipy fixture to high precision', () => {
    const cases = fixture.cases
    expect(cases.length).toBeGreaterThan(30)
    for (const c of cases) {
      const bf = binomialBayesFactor(c.k, c.n, { a: c.a, b: c.b })
      expect(Math.log(bf)).toBeCloseTo(c.lnBf10, 9)
      if (c.bf10 !== null && c.bf10 > 0) {
        expect(Math.abs(bf / c.bf10 - 1)).toBeLessThan(1e-9)
      }
    }
  })

  test('exact small cases: BF10 = B(k+1, n−k+1)·2ⁿ under the uniform prior', () => {
    expect(binomialBayesFactor(0, 1)).toBeCloseTo(1, 12) // B(1,2)·2 = 1
    expect(binomialBayesFactor(1, 1)).toBeCloseTo(1, 12) // B(2,1)·2 = 1
    expect(binomialBayesFactor(1, 2)).toBeCloseTo(2 / 3, 12) // B(2,2)·4 = 4/6
    expect(binomialBayesFactor(2, 2)).toBeCloseTo(4 / 3, 12) // B(3,1)·4 = 4/3
  })

  test('symmetric priors give BF10(k, n) = BF10(n−k, n)', () => {
    for (const [k, n] of [
      [3, 10],
      [40, 100],
      [499, 1000],
    ] as const) {
      expect(binomialBayesFactor(k, n, { a: 2, b: 2 })).toBeCloseTo(
        binomialBayesFactor(n - k, n, { a: 2, b: 2 }),
        10,
      )
    }
  })

  test('evidence points the right way', () => {
    expect(binomialBayesFactor(80, 100)).toBeGreaterThan(1e6) // strong bias
    expect(binomialBayesFactor(50, 100)).toBeLessThan(1) // supports chance
    expect(binomialBayesFactor(500, 1000)).toBeLessThan(binomialBayesFactor(50, 100)) // more data, more H0 support
  })

  test('general null p0 and one-sided alternatives match the mpmath fixture up to n = 1e6', () => {
    const cases = p0Fixture.cases
    expect(cases.length).toBeGreaterThan(60)
    expect(Math.max(...cases.map((c) => c.n))).toBe(1_000_000)
    for (const c of cases) {
      const prior = { a: c.a, b: c.b, p0: c.p0 }
      const two = binomialLogBayesFactor(c.k, c.n, prior)
      expect(close(two, c.lnBf10, 1e-12), `two-sided ${JSON.stringify(c)} got ${two}`).toBe(true)
      if (c.lnBfPlus !== undefined) {
        const plus = binomialLogBayesFactor(c.k, c.n, { ...prior, alternative: 'greater' })
        expect(close(plus, c.lnBfPlus, 1e-11), `greater ${JSON.stringify(c)} got ${plus}`).toBe(
          true,
        )
      }
      if (c.lnBfMinus !== undefined) {
        const minus = binomialLogBayesFactor(c.k, c.n, { ...prior, alternative: 'less' })
        expect(close(minus, c.lnBfMinus, 1e-11), `less ${JSON.stringify(c)} got ${minus}`).toBe(
          true,
        )
      }
    }
  })

  test('an explicit p0 = ½ equals the default; lnBayesFactor is an alias', () => {
    for (const c of fixture.cases) {
      expect(binomialLogBayesFactor(c.k, c.n, { a: c.a, b: c.b, p0: 0.5 })).toBe(
        binomialLogBayesFactor(c.k, c.n, { a: c.a, b: c.b }),
      )
    }
    expect(lnBayesFactor).toBe(binomialLogBayesFactor)
  })

  test('exact small cases with a general null', () => {
    // one trial, uniform prior: BF10 = (1/2)/p0 for a hit, (1/2)/(1−p0) for a miss
    expect(binomialBayesFactor(1, 1, { p0: 0.25 })).toBeCloseTo(2, 12)
    expect(binomialBayesFactor(0, 1, { p0: 0.25 })).toBeCloseTo(2 / 3, 12)
    // one hit, 'greater' with uniform prior: ∫_{p0}^1 p dp /(1−p0) / p0 = (1+p0)/(2 p0)
    expect(binomialBayesFactor(1, 1, { p0: 0.25, alternative: 'greater' })).toBeCloseTo(2.5, 12)
    // one miss, 'less': ∫_0^{p0} (1−p) dp / p0 / (1−p0) = (1 − p0/2)/(1−p0)
    expect(binomialBayesFactor(0, 1, { p0: 0.25, alternative: 'less' })).toBeCloseTo(
      0.875 / 0.75,
      12,
    )
  })

  test('the log form never overflows where the linear form saturates', () => {
    const ln = binomialLogBayesFactor(0, 1_000_000)
    expect(Number.isFinite(ln)).toBe(true)
    // ln BF10(0, n) = ln B(1, n+1) + n ln 2 = n ln 2 − ln(n+1) exactly
    expect(close(ln, 1_000_000 * Math.LN2 - Math.log(1_000_001), 1e-12)).toBe(true)
    expect(binomialBayesFactor(0, 1_000_000)).toBe(Number.POSITIVE_INFINITY)
    expect(binomialLogBayesFactor(0, 0)).toBe(0) // no data, no evidence
    expect(binomialLogBayesFactor(0, 0, { alternative: 'greater' })).toBe(0)
  })

  test('one-sided factors point the right way', () => {
    // a hitting surplus favors 'greater' over two-sided, and 'less' collapses
    const two = binomialLogBayesFactor(560, 1000)
    const plus = binomialLogBayesFactor(560, 1000, { alternative: 'greater' })
    const minus = binomialLogBayesFactor(560, 1000, { alternative: 'less' })
    expect(plus).toBeGreaterThan(two)
    expect(minus).toBeLessThan(0)
    // symmetric prior, p0 = ½: two-sided BF = average of the one-sided ones
    expect(Math.exp(two)).toBeCloseTo((Math.exp(plus) + Math.exp(minus)) / 2, 8)
  })

  test('resolveBinomialModel resolves defaults and freezes', () => {
    const model = resolveBinomialModel()
    expect(model).toEqual({ a: 1, b: 1, p0: 0.5, alternative: 'two-sided' })
    expect(Object.isFrozen(model)).toBe(true)
  })

  test('invalid inputs raise invalid_plan', () => {
    const bad = expect.objectContaining({
      name: 'PsiError',
      code: 'invalid_plan',
    }) as unknown as Error
    expect(() => binomialBayesFactor(-1, 10)).toThrow(bad)
    expect(() => binomialBayesFactor(11, 10)).toThrow(bad)
    expect(() => binomialBayesFactor(0.5, 10)).toThrow(bad)
    expect(() => binomialBayesFactor(5, 0)).toThrow(bad)
    expect(() => binomialBayesFactor(5, 10, { a: 0 })).toThrow(bad)
    expect(() => binomialBayesFactor(5, 10, { b: -1 })).toThrow(bad)
    expect(() => binomialBayesFactor(5, 10, { a: Number.POSITIVE_INFINITY })).toThrow(bad)
    for (const p0 of [0, 1, -0.5, 1.5, Number.NaN]) {
      expect(() => binomialLogBayesFactor(5, 10, { p0 })).toThrow(bad)
    }
    expect(() =>
      binomialLogBayesFactor(5, 10, { alternative: 'up' as unknown as 'greater' }),
    ).toThrow(bad)
    expect(() => binomialLogBayesFactor(5, 10.5)).toThrow(bad)
    expect(() => binomialLogBayesFactor(5, 2 ** 53)).toThrow(bad)
    // a prior with no representable mass above p0
    expect(() =>
      binomialLogBayesFactor(5, 10, { a: 1, b: 1e6, p0: 0.5, alternative: 'greater' }),
    ).toThrow(bad)
  })
})
