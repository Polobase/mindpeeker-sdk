import { describe, expect, test } from 'bun:test'
import { forcedChoiceBayesFactor } from '../src/index.js'
import { expectClose, expectJudgingError, fixtures } from './helpers/fixtures.js'

describe('forcedChoiceBayesFactor', () => {
  test('matches 50-digit mpmath log-beta differences, including n = 10^6', () => {
    for (const c of fixtures.bayes) {
      const r = forcedChoiceBayesFactor(c.hits, c.trials, {
        p0: c.p0,
        prior: { a: c.a, b: c.b },
        alternative: c.alternative,
      })
      // absolute tolerance in ln space: 1e-9 relative to the O(n) terms that cancel
      expectClose(r.lnBf10, c.lnBf10, 1e-10, 1e-9)
      expect(r.alternative).toBe(c.alternative)
    }
  })

  test('closed form for the uniform prior: BF10 = 1 / ((n + 1)·C(n,k)·p0^k·q0^(n−k))', () => {
    const n = 20
    const k = 9
    const p0 = 0.25
    let choose = 1
    for (let j = 1; j <= k; j++) choose = (choose * (n - j + 1)) / j
    const expected = 1 / ((n + 1) * choose * p0 ** k * (1 - p0) ** (n - k))
    const r = forcedChoiceBayesFactor(k, n, { choices: 4 })
    expectClose(r.bf10, expected, 1e-12)
    expectClose(r.bf01 * r.bf10, 1, 1e-12)
    expect(r.p0).toBe(0.25)
  })

  test('the one-sided factors average back to the two-sided one for a prior symmetric about p0', () => {
    // Beta(a, a) is symmetric about ½, so BF_two = ½ BF_+ + ½ BF_−
    const two = forcedChoiceBayesFactor(28, 50, { p0: 0.5, prior: { a: 3, b: 3 } }).bf10
    const plus = forcedChoiceBayesFactor(28, 50, {
      p0: 0.5,
      prior: { a: 3, b: 3 },
      alternative: 'greater',
    }).bf10
    const minus = forcedChoiceBayesFactor(28, 50, {
      p0: 0.5,
      prior: { a: 3, b: 3 },
      alternative: 'less',
    }).bf10
    expectClose(0.5 * plus + 0.5 * minus, two, 1e-12)
    expect(plus).toBeGreaterThan(two)
  })

  test('n = 0 gives BF = 1', () => {
    expect(forcedChoiceBayesFactor(0, 0, { choices: 5 }).lnBf10).toBeCloseTo(0, 14)
  })

  test('validates', () => {
    expectJudgingError(() => forcedChoiceBayesFactor(3, 2, { p0: 0.5 }), 'invalid_input')
    expectJudgingError(() => forcedChoiceBayesFactor(1, 2, {}), 'invalid_options')
    expectJudgingError(
      () => forcedChoiceBayesFactor(1, 2, { p0: 0.5, choices: 2 }),
      'invalid_options',
    )
    expectJudgingError(() => forcedChoiceBayesFactor(1, 2, { p0: 0 }), 'invalid_options')
    expectJudgingError(() => forcedChoiceBayesFactor(1, 2, { choices: 1 }), 'invalid_options')
    expectJudgingError(
      () => forcedChoiceBayesFactor(1, 2, { p0: 0.5, prior: { a: 0 } }),
      'invalid_options',
    )
    expectJudgingError(
      () =>
        forcedChoiceBayesFactor(1, 2, {
          p0: 0.5,
          alternative: 'up' as unknown as 'greater',
        }),
      'invalid_options',
    )
  })
})
