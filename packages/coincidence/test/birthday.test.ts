import { describe, expect, test } from 'bun:test'
import {
  birthdayApprox,
  birthdayMatch,
  birthdayNoMatch,
  peopleForMatch,
  peopleForMatchApprox,
} from '../src/index.js'
import fixture from './fixtures/birthday.json' with { type: 'json' }
import { expectInvalid } from './helpers/errors.js'
import { expectClose, forEachTuple, rat, toNumber } from './helpers/exact.js'

describe('birthdayNoMatch / birthdayMatch', () => {
  test('agree with exact fractions and 60-digit mpmath (fixture)', () => {
    for (const c of fixture.cases) {
      const noMatch = birthdayNoMatch(c.n, c.c)
      const match = birthdayMatch(c.n, c.c)
      if (c.noMatch === 0) expect(noMatch).toBeLessThan(1e-300)
      else expectClose(noMatch, c.noMatch, 1e-13)
      expectClose(match, c.match, 1e-13)
    }
  })

  test('equal brute-force enumeration of every assignment (BigInt)', () => {
    for (let c = 1; c <= 6; c++) {
      for (let n = 0; n <= 6; n++) {
        let distinct = 0n
        forEachTuple(c, n, (tuple) => {
          if (new Set(tuple).size === n) distinct++
        })
        const total = BigInt(c) ** BigInt(n)
        expectClose(birthdayNoMatch(n, c), toNumber(rat(distinct, total)), 1e-14)
        expectClose(birthdayMatch(n, c), toNumber(rat(total - distinct, total)), 1e-14)
      }
    }
  })

  test('the classic values', () => {
    expect(birthdayMatch(23, 365)).toBeCloseTo(0.5073, 4)
    expect(birthdayMatch(22, 365)).toBeCloseTo(0.4757, 4)
    // Haigh, Taking Chances: P(all different) 0.5243 (22), 0.4927 (23)
    expect(birthdayNoMatch(22, 365)).toBeCloseTo(0.5243, 4)
    expect(birthdayNoMatch(23, 365)).toBeCloseTo(0.4927, 4)
    // leap year: 0.5252 (Haigh prints 0.5254) and 0.4937
    expect(birthdayNoMatch(22, 366)).toBeCloseTo(0.5252, 4)
    expect(birthdayNoMatch(23, 366)).toBeCloseTo(0.4937, 4)
    // classes of 26, 32, 50: all different 0.40, 0.25, < 0.03
    expect(birthdayNoMatch(26, 365)).toBeCloseTo(0.4018, 4)
    expect(birthdayNoMatch(32, 365)).toBeCloseTo(0.2467, 4)
    expect(birthdayNoMatch(50, 365)).toBeLessThan(0.03)
    // 100 number plates: 20 → 0.1304; 11, 12, 13 → 0.565, 0.503, 0.443
    expect(birthdayNoMatch(20, 100)).toBeCloseTo(0.1304, 4)
    expect(birthdayNoMatch(11, 100)).toBeCloseTo(0.5653, 4)
    expect(birthdayNoMatch(12, 100)).toBeCloseTo(0.5032, 4)
    expect(birthdayNoMatch(13, 100)).toBeCloseTo(0.4428, 4)
    // a popular figure "0.85 for 35 people" is wrong: it is 0.814
    expect(birthdayMatch(35, 365)).toBeCloseTo(0.8144, 4)
    // Mlodinow: 500 draws from 2.4 million → about 5 %; Lotto 6/49 over 3016 draws → about 28 %
    expect(birthdayMatch(500, 2_400_000)).toBeCloseTo(0.0507, 4)
    expect(birthdayMatch(3016, 13_983_816)).toBeCloseTo(0.2776, 4)
  })

  test('pigeonhole and edge cases', () => {
    expect(birthdayNoMatch(0, 1)).toBe(1)
    expect(birthdayNoMatch(1, 1)).toBe(1)
    expect(birthdayNoMatch(2, 1)).toBe(0)
    expect(birthdayMatch(366, 365)).toBe(1)
    expect(birthdayMatch(1, Number.MAX_SAFE_INTEGER)).toBe(0)
    // a tiny match probability keeps its digits: 2 draws from 2^53 − 1
    expectClose(birthdayMatch(2, Number.MAX_SAFE_INTEGER), 1 / Number.MAX_SAFE_INTEGER, 1e-15)
  })

  test('reject invalid arguments before computing', () => {
    expectInvalid(() => birthdayNoMatch(-1, 365), 'n')
    expectInvalid(() => birthdayNoMatch(1.5, 365), 'n')
    expectInvalid(() => birthdayMatch(Number.NaN, 365), 'n')
    expectInvalid(() => birthdayMatch('3' as unknown as number, 365), 'n')
    expectInvalid(() => birthdayMatch(3, 0), 'c')
    expectInvalid(() => birthdayMatch(3, 2.5), 'c')
    expectInvalid(() => birthdayNoMatch(3, Number.POSITIVE_INFINITY), 'c')
  })
})

describe('birthdayApprox', () => {
  test('is exp(−n(n−1)/2c) and close to exact for n ≪ c^(2/3)', () => {
    expect(birthdayApprox(23, 365)).toBe(Math.exp((-23 * 22) / 730))
    expect(birthdayApprox(0, 365)).toBe(1)
    expect(birthdayApprox(1, 365)).toBe(1)
    expect(Math.abs(birthdayApprox(23, 365) - birthdayNoMatch(23, 365))).toBeLessThan(0.008)
    expect(Math.abs(birthdayApprox(1000, 1e9) - birthdayNoMatch(1000, 1e9))).toBeLessThan(1e-6)
    expect(birthdayApprox(10, 36.5)).toBe(Math.exp(-90 / 73))
  })

  test('validates', () => {
    expectInvalid(() => birthdayApprox(-1, 10), 'n')
    expectInvalid(() => birthdayApprox(1, 0), 'c')
  })
})

describe('peopleForMatch', () => {
  test('inverts the exact probability (fixture)', () => {
    for (const c of fixture.peopleForMatch) {
      expect(peopleForMatch(c.p, c.c)).toBe(c.n)
    }
  })

  test('is the boundary: P(n − 1) < p ≤ P(n)', () => {
    for (const [p, c] of [
      [0.5, 365],
      [0.95, 365],
      [0.2, 10_000],
      [0.999, 1e6],
      [0.5, 1e15],
    ] as const) {
      const n = peopleForMatch(p, c)
      expect(birthdayMatch(n, c)).toBeGreaterThanOrEqual(p)
      expect(birthdayMatch(n - 1, c)).toBeLessThan(p)
    }
    expect(peopleForMatch(1, 365)).toBe(366)
    expect(peopleForMatch(1e-9, 365)).toBe(2)
    expect(peopleForMatch(0.5, 1)).toBe(2)
  })

  test('validates', () => {
    expectInvalid(() => peopleForMatch(0, 365), 'p')
    expectInvalid(() => peopleForMatch(1.01, 365), 'p')
    expectInvalid(() => peopleForMatch(0.5, 0), 'c')
  })
})

describe('peopleForMatchApprox', () => {
  test('Diaconis–Mosteller multipliers: 1.1774√c at ½ ("1.2"), 2.4477√c at 0.95 ("2.5")', () => {
    expect(peopleForMatchApprox(0.5, 1)).toBeCloseTo(Math.sqrt(2 * Math.LN2), 14)
    expect(peopleForMatchApprox(0.5, 365) / Math.sqrt(365)).toBeCloseTo(1.1774, 4)
    expect(peopleForMatchApprox(0.95, 365) / Math.sqrt(365)).toBeCloseTo(2.448, 3)
    expect(peopleForMatchApprox(1, 365)).toBe(Number.POSITIVE_INFINITY)
  })

  test("equals @mindpeeker/gematria's leading-order birthdayBound with q = 1/c", () => {
    // gematria birthdayBound(1/365, 0.5) = sqrt(2 ln 2 · 365) = 22.494… (B1 report)
    expect(peopleForMatchApprox(0.5, 365)).toBeCloseTo(22.4944, 4)
  })

  test('validates', () => {
    expectInvalid(() => peopleForMatchApprox(0, 365), 'p')
    expectInvalid(() => peopleForMatchApprox(0.5, -1), 'c')
  })
})
