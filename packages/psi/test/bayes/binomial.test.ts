import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { binomialBayesFactor } from '../../src/bayes/binomial.js'

interface BayesCase {
  k: number
  n: number
  a: number
  b: number
  lnBf10: number
  bf10: number | null
}

const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'fixtures', 'bayes.json'), 'utf8'),
) as { cases: BayesCase[] }

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
  })
})
