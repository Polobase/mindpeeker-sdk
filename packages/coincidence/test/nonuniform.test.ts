import { describe, expect, test } from 'bun:test'
import {
  birthdayMatch,
  birthdayNoMatch,
  collisionProbability,
  kWayProbabilities,
  NONUNIFORM_EXACT_LIMIT,
  noMatchNonUniform,
  probabilitiesFromCounts,
} from '../src/index.js'
import fixture from './fixtures/nonuniform.json' with { type: 'json' }
import { expectCoincidenceError, expectInvalid } from './helpers/errors.js'
import {
  add,
  equal,
  expectClose,
  factorial,
  mul,
  ONE,
  type Rational,
  rat,
  seeded,
  sub,
  ZERO,
} from './helpers/exact.js'

/** n! · e_n(p) in exact rationals. */
function allDistinct(n: number, probs: readonly Rational[]): Rational {
  const e: Rational[] = [ONE, ...new Array<Rational>(n).fill(ZERO)]
  for (const p of probs) {
    for (let j = n; j >= 1; j--) e[j] = add(e[j] as Rational, mul(p, e[j - 1] as Rational))
  }
  return mul(e[n] as Rational, rat(factorial(n)))
}

function elementary(n: number, probs: readonly Rational[]): Rational {
  const e: Rational[] = [ONE, ...new Array<Rational>(Math.max(n, 0)).fill(ZERO)]
  for (const p of probs) {
    for (let j = n; j >= 1; j--) e[j] = add(e[j] as Rational, mul(p, e[j - 1] as Rational))
  }
  return e[n] as Rational
}

/** A random rational probability vector with denominators up to 64. */
function randomVector(next: () => number, c: number): Rational[] {
  const weights = Array.from({ length: c }, () => 1 + Math.floor(next() * 64))
  const total = weights.reduce((a, b) => a + b, 0)
  return weights.map((w) => rat(w, total))
}

describe('collisionProbability', () => {
  test('is Σp² (fixture) and 1/c for equal categories', () => {
    for (const c of fixture.cases) expectClose(collisionProbability(c.probs), c.collision, 1e-14)
    expectClose(collisionProbability(new Array(365).fill(1 / 365)), 1 / 365, 1e-13)
    expect(collisionProbability(new Float64Array([0.5, 0.5]))).toBe(0.5)
  })

  test('validates the probability vector', () => {
    expectInvalid(() => collisionProbability([0.5, 0.4]), 'probs')
    expectInvalid(() => collisionProbability([]), 'probs')
    expectInvalid(() => collisionProbability([1.5, -0.5]), 'probs[0]')
    expectInvalid(() => collisionProbability([Number.NaN, 1]), 'probs[0]')
    expectInvalid(() => collisionProbability('0.5' as unknown as number[]), 'probs')
  })
})

describe('probabilitiesFromCounts', () => {
  test('normalizes a histogram', () => {
    expect(probabilitiesFromCounts([2, 1, 1])).toEqual([0.5, 0.25, 0.25])
    expect(probabilitiesFromCounts(new Float64Array([0, 3]))).toEqual([0, 1])
  })

  test('validates', () => {
    expectInvalid(() => probabilitiesFromCounts([0, 0]), 'counts')
    expectInvalid(() => probabilitiesFromCounts([1, -1]), 'counts[1]')
    expectInvalid(() => probabilitiesFromCounts(null as unknown as number[]), 'counts')
  })
})

describe('noMatchNonUniform', () => {
  test('exact values agree with fractions (fixture), both tails', () => {
    for (const c of fixture.cases) {
      const r = noMatchNonUniform(c.n, c.probs)
      expect(r.method).toBe('exact')
      expectClose(r.noMatch, c.noMatch, 1e-12, 1e-300)
      expectClose(r.match, c.match, 1e-12, 1e-300)
    }
  })

  test('equal categories reproduce the birthday problem', () => {
    const probs = new Array(365).fill(1 / 365)
    for (const n of [2, 10, 23, 57, 100]) {
      const r = noMatchNonUniform(n, probs)
      expectClose(r.noMatch, birthdayNoMatch(n, 365), 1e-12)
      expectClose(r.match, birthdayMatch(n, 365), 1e-12)
    }
  })

  test('a tiny match probability keeps full relative precision', () => {
    const c = 1_000_000
    const r = noMatchNonUniform(3, new Array(c).fill(1 / c))
    // exact: 1 − (1 − 1/c)(1 − 2/c) = 3/c − 2/c²
    expectClose(r.match, 3 / c - 2 / (c * c), 1e-12)
  })

  test('no intermediate underflow: many draws over many categories', () => {
    // (1/5000)^600 underflows, so an unscaled e_n recursion loses almost everything here
    const r = noMatchNonUniform(600, new Array(5000).fill(1 / 5000))
    expectClose(r.noMatch, birthdayNoMatch(600, 5000), 1e-12)
    expectClose(r.match, birthdayMatch(600, 5000), 1e-14)
  })

  test('agrees with the independent k-fold engine at k = 2 on random vectors', () => {
    const next = seeded(4242)
    for (let trial = 0; trial < 6; trial++) {
      const c = 200 + Math.floor(next() * 1500)
      const n = 20 + Math.floor(next() * 300)
      const probs = probabilitiesFromCounts(Array.from({ length: c }, () => next() ** 2 + 0.01))
      const a = noMatchNonUniform(n, probs)
      const b = kWayProbabilities(n, probs, 2)
      expectClose(a.noMatch, b.noMatch, 1e-12, 1e-300)
      expectClose(a.match, b.match, 1e-12, 1e-300)
    }
  })

  test('lemma: averaging two probabilities raises P(all different) by n!·(x−y)²/4·e_{n−2}(rest)', () => {
    const next = seeded(20260917)
    for (let trial = 0; trial < 60; trial++) {
      const c = 3 + Math.floor(next() * 4)
      const n = 2 + Math.floor(next() * Math.min(3, c - 1))
      const probs = randomVector(next, c)
      const x = probs[0] as Rational
      const y = probs[1] as Rational
      const rest = probs.slice(2)
      const mean = mul(add(x, y), rat(1, 2))
      const before = allDistinct(n, probs)
      const after = allDistinct(n, [mean, mean, ...rest])
      const diff = sub(x, y)
      const predicted = mul(
        mul(mul(diff, diff), rat(1, 4)),
        mul(elementary(n - 2, rest), rat(factorial(n))),
      )
      expect(equal(sub(after, before), predicted)).toBe(true)
      expect(sub(after, before).num >= 0n).toBe(true)
    }
  })

  test('non-uniformity never lowers the match probability (floating point)', () => {
    const next = seeded(7)
    for (let trial = 0; trial < 200; trial++) {
      const c = 2 + Math.floor(next() * 40)
      const n = 2 + Math.floor(next() * Math.min(c, 15))
      const weights = Array.from({ length: c }, () => next() ** 3 + 1e-3)
      const probs = probabilitiesFromCounts(weights)
      expect(noMatchNonUniform(n, probs).match).toBeGreaterThanOrEqual(
        birthdayMatch(n, c) * (1 - 1e-12),
      )
    }
  })

  test('noMatch + match = 1 for the exact method', () => {
    const next = seeded(99)
    for (let trial = 0; trial < 50; trial++) {
      const c = 5 + Math.floor(next() * 200)
      const n = Math.floor(next() * 30)
      const probs = probabilitiesFromCounts(Array.from({ length: c }, () => next()))
      const r = noMatchNonUniform(n, probs, { method: 'exact' })
      expect(Math.abs(r.noMatch + r.match - 1)).toBeLessThan(1e-12)
    }
  })

  test('approximations: poisson and second-order', () => {
    const c = 10_000
    const probs = new Array(c).fill(1 / c)
    const exact = Math.log(birthdayNoMatch(100, c))
    const poisson = noMatchNonUniform(100, probs, { method: 'poisson' })
    const second = noMatchNonUniform(100, probs, { method: 'second-order' })
    expect(poisson.method).toBe('poisson')
    expect(poisson.noMatch).toBe(Math.exp(-(100 * 99) / 2 / c))
    expect(second.method).toBe('second-order')
    expect(Math.abs(Math.log(second.noMatch) - exact)).toBeLessThan(
      Math.abs(Math.log(poisson.noMatch) - exact) / 50,
    )
    expect(Math.abs(second.noMatch + second.match - 1)).toBeLessThan(1e-15)
  })

  test("'auto' switches to second-order beyond the work limit; 'exact' refuses", () => {
    const c = 100_000
    const n = Math.floor(NONUNIFORM_EXACT_LIMIT / c) + 1
    const probs = new Array(c).fill(1 / c)
    const auto = noMatchNonUniform(n, probs)
    expect(auto.method).toBe('second-order')
    expect(Math.abs(Math.log(auto.noMatch) - Math.log(birthdayNoMatch(n, c)))).toBeLessThan(0.02)
    expectCoincidenceError(() => noMatchNonUniform(n, probs, { method: 'exact' }), 'too_large', 'n')
  })

  test('pigeonhole on the categories with p > 0; n ≤ 1', () => {
    expect(noMatchNonUniform(3, [0, 0.5, 0, 0.5])).toEqual({
      noMatch: 0,
      match: 1,
      method: 'exact',
    })
    expect(noMatchNonUniform(1, [1])).toEqual({ noMatch: 1, match: 0, method: 'exact' })
    expect(noMatchNonUniform(0, [1], { method: 'poisson' }).method).toBe('poisson')
  })

  test('validates', () => {
    expectInvalid(() => noMatchNonUniform(-1, [1]), 'n')
    expectInvalid(() => noMatchNonUniform(2, [0.3, 0.3]), 'probs')
    expectInvalid(
      () => noMatchNonUniform(2, [1], { method: 'fast' as unknown as 'exact' }),
      'options.method',
    )
    expectInvalid(() => noMatchNonUniform(2, [1], 'exact' as unknown as undefined), 'options')
  })
})
