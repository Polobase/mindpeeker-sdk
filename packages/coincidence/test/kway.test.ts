import { describe, expect, test } from 'bun:test'
import {
  birthdayMatch,
  birthdayNoMatch,
  kWayMatch,
  kWayMatchApprox,
  kWayNoMatch,
  kWayProbabilities,
  peopleForKWayMatch,
  peopleForKWayMatchApprox,
} from '../src/index.js'
import { kWayDp, kWayLevin } from '../src/internal/kway-engine.js'
import fixture from './fixtures/kway.json' with { type: 'json' }
import { expectCoincidenceError, expectInvalid } from './helpers/errors.js'
import { expectClose, forEachTuple, rat, toNumber } from './helpers/exact.js'

/** Diaconis & Mosteller (1989), Table 3 (Bruce Levin): least N with P(k-fold) > ½, c = 365. */
const TABLE_3: Record<number, number> = {
  2: 23,
  3: 88,
  4: 187,
  5: 313,
  6: 460,
  7: 623,
  8: 798,
  9: 985,
  10: 1181,
  11: 1385,
  12: 1596,
  13: 1813,
}

describe('kWayProbabilities', () => {
  test("agrees with exact big-integer counts (fixture) and reproduces Levin's Table 3", () => {
    let table3Rows = 0
    for (const c of fixture.uniform) {
      const r = kWayProbabilities(c.n, c.c, c.k)
      if (c.c === 365 && (c.n === TABLE_3[c.k] || c.n === (TABLE_3[c.k] as number) - 1)) {
        // P(N − 1) < ½ < P(N) for the published N
        if (c.n === TABLE_3[c.k]) expect(r.match).toBeGreaterThan(0.5)
        else expect(r.match).toBeLessThan(0.5)
        table3Rows++
      }
      if (r.method === 'dp') {
        expectClose(r.noMatch, c.noMatch, 1e-13, 1e-300)
        expectClose(r.match, c.match, 1e-13, 1e-300)
      } else {
        // Levin: relative error of noMatch grows like c · 1e-16
        const tolerance = c.c * 1e-15
        expectClose(r.noMatch, c.noMatch, tolerance)
        expect(Math.abs(r.match - c.match)).toBeLessThanOrEqual(tolerance)
      }
    }
    expect(table3Rows).toBe(24)
    expect(kWayProbabilities(3000, 1_000_000, 3).method).toBe('levin')
    expect(kWayProbabilities(1813, 365, 13).method).toBe('dp')
  })

  test('unequal categories agree with exact fractions (fixture)', () => {
    for (const c of fixture.nonuniform) {
      const r = kWayProbabilities(c.n, c.probs, c.k)
      expectClose(r.noMatch, c.noMatch, 1e-13)
      expectClose(r.match, c.match, 1e-13)
    }
  })

  test('brute-force enumeration of every assignment (BigInt)', () => {
    for (let c = 1; c <= 4; c++) {
      for (let n = 0; n <= 6; n++) {
        for (let k = 1; k <= 4; k++) {
          let none = 0n
          forEachTuple(c, n, (tuple) => {
            const counts = new Array<number>(c).fill(0)
            for (const x of tuple) counts[x] = (counts[x] as number) + 1
            if (Math.max(0, ...counts) < k) none++
          })
          const total = BigInt(c) ** BigInt(n)
          expectClose(kWayNoMatch(n, c, k), toNumber(rat(none, total)), 1e-14, 1e-300)
          expectClose(kWayMatch(n, c, k), toNumber(rat(total - none, total)), 1e-14, 1e-300)
        }
      }
    }
  })

  test('k = 2 is the birthday problem', () => {
    for (const [n, c] of [
      [23, 365],
      [40, 1000],
      [5, 5],
      [6, 5],
    ] as const) {
      expectClose(kWayMatch(n, c, 2), birthdayMatch(n, c), 1e-13, 1e-300)
      expectClose(kWayNoMatch(n, c, 2), birthdayNoMatch(n, c), 1e-13, 1e-300)
    }
  })

  test('the DP and Levin agree where both run', () => {
    const cases: [number, number | number[], number][] = [
      [300, 3000, 3],
      [120, 365, 4],
      [50, 64, 5],
      [40, [0.4, 0.2, 0.2, 0.1, 0.1], 12],
      [30, Array.from({ length: 20 }, (_, i) => (i < 10 ? 0.06 : 0.04)), 4],
    ]
    for (const [n, probs, k] of cases) {
      const a = kWayDp(n, probs, k)
      const b = kWayLevin(n, probs, k)
      expectClose(b.noMatch, a.noMatch, 1e-11)
      expect(Math.abs(b.match - a.match)).toBeLessThan(1e-11)
    }
  })

  test('trivial regions are exact', () => {
    expect(kWayProbabilities(2, 365, 3)).toEqual({ noMatch: 1, match: 0, method: 'dp' })
    expect(kWayMatch(1, 365, 1)).toBe(1)
    expect(kWayMatch(0, 365, 1)).toBe(0)
    expect(kWayMatch(731, 365, 3)).toBe(1) // pigeonhole: 365 · 2 < 731
    expect(kWayMatch(3, 1, 3)).toBe(1)
    expect(kWayMatch(3, [0, 1, 0], 2)).toBe(1)
  })

  test('refuses computations beyond the work limit with too_large', () => {
    expectCoincidenceError(() => kWayMatch(100_000, 1e12, 40), 'too_large', 'n')
  })

  test('validates', () => {
    expectInvalid(() => kWayMatch(-1, 365, 3), 'n')
    expectInvalid(() => kWayMatch(3, 0, 3), 'categories')
    expectInvalid(() => kWayMatch(3, [0.5, 0.6], 3), 'categories')
    expectInvalid(() => kWayMatch(3, 365, 0), 'k')
    expectInvalid(() => kWayNoMatch(3, 365, 2.5), 'k')
  })
})

describe('peopleForKWayMatch', () => {
  test('inverts the exact probability (fixture)', () => {
    for (const c of fixture.people) expect(peopleForKWayMatch(c.p, c.c, c.k)).toBe(c.n)
  })

  test('works for unequal categories and at the edges', () => {
    const probs = [0.4, 0.2, 0.2, 0.1, 0.1]
    const n = peopleForKWayMatch(0.9, probs, 4)
    expect(kWayMatch(n, probs, 4)).toBeGreaterThanOrEqual(0.9)
    expect(kWayMatch(n - 1, probs, 4)).toBeLessThan(0.9)
    expect(peopleForKWayMatch(1, 365, 3)).toBe(731)
    expect(peopleForKWayMatch(0.5, 365, 1)).toBe(1)
    expect(peopleForKWayMatch(0.5, 365, 2)).toBe(23)
  })

  test('validates', () => {
    expectInvalid(() => peopleForKWayMatch(0, 365, 3), 'p')
    expectInvalid(() => peopleForKWayMatch(0.5, 365, 0), 'k')
  })
})

describe('Diaconis–Mosteller approximations', () => {
  test('eq. 7.5 solved for N (fixture), their day-of-month example gives 18', () => {
    for (const c of fixture.dm75) expectClose(peopleForKWayMatchApprox(c.p, c.c, c.k), c.n, 1e-9)
    expect(Math.round(peopleForKWayMatchApprox(0.5, 30, 3))).toBe(18)
    expect(peopleForKWayMatchApprox(1, 30, 3)).toBe(Number.POSITIVE_INFINITY)
    expect(peopleForKWayMatchApprox(0.5, 30, 1)).toBe(1)
  })

  test('their curve fit 47(k − 1.5)^(3/2) is within 3 % of Table 3 for k = 3 … 13', () => {
    for (let k = 3; k <= 13; k++) {
      const big = TABLE_3[k] as number
      expect(Math.abs((47 * (k - 1.5) ** 1.5) / big - 1)).toBeLessThan(0.03)
    }
  })

  test('kWayMatchApprox tracks the exact value for large c', () => {
    const exact = fixture.uniform.find((c) => c.c === 1_000_000)
    if (exact === undefined) throw new Error('fixture row missing')
    expect(Math.abs(kWayMatchApprox(exact.n, exact.c, exact.k) / exact.match - 1)).toBeLessThan(
      0.01,
    )
    // at the approximate N the approximate probability is p
    const n = peopleForKWayMatchApprox(0.5, 365, 4)
    expect(n).toBeGreaterThan(186)
    expect(n).toBeLessThan(187)
    expect(kWayMatchApprox(0, 365, 3)).toBe(0)
    expect(kWayMatchApprox(731, 365, 3)).toBe(1)
    expect(kWayMatchApprox(5, 365, 1)).toBe(1)
  })

  test('validates', () => {
    expectInvalid(() => kWayMatchApprox(3, -1, 3), 'c')
    expectInvalid(() => peopleForKWayMatchApprox(0.5, 30, 0), 'k')
  })
})
