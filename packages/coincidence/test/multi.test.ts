import { describe, expect, test } from 'bun:test'
import {
  birthdayMatch,
  multiCategory,
  multiCategoryMatch,
  multiCategoryNoMatch,
} from '../src/index.js'
import fixture from './fixtures/multi.json' with { type: 'json' }
import { expectInvalid } from './helpers/errors.js'
import { expectClose, forEachTuple, rat, toNumber } from './helpers/exact.js'

describe('multiCategoryMatch / multiCategoryNoMatch', () => {
  test('agree with mpmath products (fixture)', () => {
    for (const c of fixture.cases) {
      expectClose(multiCategoryNoMatch(c.n, c.cs), c.noMatch, 1e-13)
      expectClose(multiCategoryMatch(c.n, c.cs), c.match, 1e-13)
    }
  })

  test('the product rule matches brute-force enumeration of people × attributes', () => {
    const cs = [2, 3]
    for (let n = 0; n <= 4; n++) {
      let none = 0n
      // each person is a pair (value of attribute 0, value of attribute 1), encoded 0 … 5
      forEachTuple(6, n, (people) => {
        const first = new Set(people.map((p) => p % 2))
        const second = new Set(people.map((p) => Math.floor(p / 2)))
        if (first.size === n && second.size === n) none++
      })
      const total = 6n ** BigInt(n)
      expectClose(multiCategoryNoMatch(n, cs), toNumber(rat(none, total)), 1e-14, 1e-300)
    }
  })

  test('one attribute is the birthday problem', () => {
    expectClose(multiCategoryMatch(23, [365]), birthdayMatch(23, 365), 1e-15)
    expect(multiCategoryMatch(3, [2, 1000])).toBe(1)
  })

  test('validates', () => {
    expectInvalid(() => multiCategoryMatch(-1, [365]), 'n')
    expectInvalid(() => multiCategoryMatch(2, []), 'cs')
    expectInvalid(() => multiCategoryNoMatch(2, [365, 0]), 'cs[1]')
  })
})

describe('multiCategory', () => {
  test("Diaconis & Mosteller's example: 365 birthdays, 1000 lottery tickets, 500 nights → 16", () => {
    const summary = multiCategory([365, 1000, 500])
    expect(summary.peopleExact).toBe(16)
    expect(summary.p).toBe(0.5)
    expectClose(summary.effectiveCategories, 1 / (1 / 365 + 1 / 1000 + 1 / 500), 1e-14)
    expectClose(summary.harmonicMean, 3 / (1 / 365 + 1 / 1000 + 1 / 500), 1e-14)
    // their rounded multiplier 1.2 gives 15.8 ≈ 16
    expect((summary.peopleApprox * 1.2) / Math.sqrt(2 * Math.LN2)).toBeCloseTo(15.84, 2)
  })

  test('exact and approximate people counts (fixture)', () => {
    for (const c of fixture.people) {
      const summary = multiCategory(c.cs, { p: c.p })
      expect(summary.peopleExact).toBe(c.n)
      expectClose(summary.peopleApprox, c.approx, 1e-13)
    }
    expect(multiCategory([12, 31, 7], { p: 1 }).peopleExact).toBe(8)
    expect(multiCategory([12, 31, 7], { p: 1 }).peopleApprox).toBe(Number.POSITIVE_INFINITY)
  })

  test('validates', () => {
    expectInvalid(() => multiCategory([365], { p: 0 }), 'options.p')
    expectInvalid(() => multiCategory([365], [] as unknown as undefined), 'options')
    expectInvalid(() => multiCategory([1.5]), 'cs[0]')
  })
})
