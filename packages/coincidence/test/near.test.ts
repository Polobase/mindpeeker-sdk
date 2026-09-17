import { describe, expect, test } from 'bun:test'
import {
  birthdayMatch,
  nearMatch,
  nearNoMatch,
  peopleForNearMatch,
  peopleForNearMatchApprox,
} from '../src/index.js'
import fixture from './fixtures/near.json' with { type: 'json' }
import { expectInvalid } from './helpers/errors.js'
import { expectClose, forEachTuple, rat, toNumber } from './helpers/exact.js'

describe('nearNoMatch / nearMatch', () => {
  test('agree with exact fractions and mpmath (fixture)', () => {
    for (const c of fixture.cases) {
      const topology = c.circular ? 'circle' : 'line'
      const noMatch = nearNoMatch(c.n, c.c, c.d, { topology })
      const match = nearMatch(c.n, c.c, c.d, { topology })
      if (c.noMatch === 0) expect(noMatch).toBeLessThan(1e-300)
      else expectClose(noMatch, c.noMatch, 1e-13)
      expectClose(match, c.match, 1e-13)
    }
  })

  test('brute-force enumeration on the circle and the line (BigInt)', () => {
    for (let c = 1; c <= 7; c++) {
      for (let n = 0; n <= 3; n++) {
        for (let d = 0; d <= 3; d++) {
          for (const topology of ['circle', 'line'] as const) {
            let far = 0n
            forEachTuple(c, n, (xs) => {
              for (let i = 0; i < n; i++) {
                for (let j = i + 1; j < n; j++) {
                  const diff = Math.abs((xs[i] as number) - (xs[j] as number))
                  const distance = topology === 'circle' ? Math.min(diff, c - diff) : diff
                  if (distance <= d) return
                }
              }
              far++
            })
            const total = BigInt(c) ** BigInt(n)
            const options = { topology }
            expectClose(nearNoMatch(n, c, d, options), toNumber(rat(far, total)), 1e-14, 1e-300)
            expectClose(
              nearMatch(n, c, d, options),
              toNumber(rat(total - far, total)),
              1e-14,
              1e-300,
            )
          }
        }
      }
    }
  })

  test('d = 0 is the birthday problem; circle is the default', () => {
    expectClose(nearMatch(23, 365, 0), birthdayMatch(23, 365), 1e-14)
    expectClose(nearMatch(23, 365, 0, { topology: 'line' }), birthdayMatch(23, 365), 1e-14)
    expect(nearMatch(14, 365, 1)).toBe(nearMatch(14, 365, 1, { topology: 'circle' }))
  })

  test('Abramson & Moser: 14 people for a birthday within a day; about 7 within a week', () => {
    expect(nearMatch(13, 365, 1)).toBeLessThan(0.5)
    expect(nearMatch(14, 365, 1)).toBeCloseTo(0.5375, 4)
    expect(nearMatch(7, 365, 7)).toBeGreaterThan(0.5)
    expect(nearMatch(6, 365, 7)).toBeLessThan(0.5)
  })

  test('validates', () => {
    expectInvalid(() => nearMatch(2, 365, -1), 'd')
    expectInvalid(() => nearMatch(2, 0, 1), 'c')
    expectInvalid(() => nearNoMatch(2.5, 365, 1), 'n')
    expectInvalid(
      () => nearMatch(2, 365, 1, { topology: 'torus' as unknown as 'line' }),
      'options.topology',
    )
    expectInvalid(() => nearMatch(2, 365, 1, 5 as unknown as undefined), 'options')
  })
})

describe('peopleForNearMatch', () => {
  test('inverts the exact probability (fixture)', () => {
    for (const c of fixture.peopleForNearMatch) {
      const topology = c.circular ? 'circle' : 'line'
      expect(peopleForNearMatch(c.p, c.c, c.d, { topology })).toBe(c.n)
    }
    expect(peopleForNearMatch(0.5, 365, 1)).toBe(14)
  })

  test('p = 1 returns the first certain count', () => {
    expect(peopleForNearMatch(1, 365, 1)).toBe(183) // 183 · 2 > 365
    expect(nearNoMatch(182, 365, 1)).toBeGreaterThan(0)
    expect(peopleForNearMatch(1, 365, 1, { topology: 'line' })).toBe(184)
    expect(nearNoMatch(183, 365, 1, { topology: 'line' })).toBeGreaterThan(0)
    expect(peopleForNearMatch(1, 5, 2)).toBe(2)
  })

  test('validates', () => {
    expectInvalid(() => peopleForNearMatch(0, 365, 1), 'p')
    expectInvalid(() => peopleForNearMatch(0.5, 365, 1.5), 'd')
  })
})

describe('peopleForNearMatchApprox', () => {
  test("eq. 7.6: 1.1774·√(c/(2d+1)) at ½ (Diaconis & Mosteller's 1.2 gives 13.2)", () => {
    const value = peopleForNearMatchApprox(0.5, 365, 1)
    expect(value).toBeCloseTo(Math.sqrt(2 * Math.LN2 * (365 / 3)), 12)
    expect((value * 1.2) / Math.sqrt(2 * Math.LN2)).toBeCloseTo(13.2, 1)
    expect(peopleForNearMatchApprox(1, 365, 1)).toBe(Number.POSITIVE_INFINITY)
    expectInvalid(() => peopleForNearMatchApprox(0.5, 0, 1), 'c')
  })
})
