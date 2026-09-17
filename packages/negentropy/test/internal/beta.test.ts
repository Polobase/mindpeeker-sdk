import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { betaInc, betaPpf, lnBeta } from '../../src/internal/beta.js'
import { lnGamma } from '../../src/internal/gamma.js'

const fixtures = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'fixtures', 'numerics.json'), 'utf8'),
) as { betaInc: Array<{ a: number; b: number; x: number; value: number }> }

function expectClose(actual: number, expected: number, relTol: number, absTol = 1e-300) {
  const err = Math.abs(actual - expected)
  expect(err).toBeLessThanOrEqual(Math.max(absTol, relTol * Math.abs(expected)))
}

const invalid = expect.objectContaining({ name: 'NegentropyError', code: 'invalid_config' })

describe('lnBeta', () => {
  test('matches lnΓ sums and closed forms', () => {
    expectClose(lnBeta(1, 1), 0, 1e-14, 1e-14)
    expectClose(lnBeta(0.5, 0.5), Math.log(Math.PI), 1e-14)
    expectClose(lnBeta(2, 3), Math.log(1 / 12), 1e-14)
    for (const [a, b] of [
      [3.5, 12],
      [40, 60],
      [0.3, 25],
    ] as const) {
      expectClose(lnBeta(a, b), lnGamma(a) + lnGamma(b) - lnGamma(a + b), 1e-12)
    }
  })

  test('keeps all digits when one argument is huge: B(1, b) = 1/b', () => {
    for (const b of [1e6, 1e12, 1e15]) expectClose(lnBeta(1, b), -Math.log(b), 1e-14)
    // B(½, b) → √(π/b) as b → ∞
    expectClose(lnBeta(0.5, 1e12), 0.5 * Math.log(Math.PI / 1e12), 1e-12)
  })

  test('rejects invalid shapes', () => {
    expect(() => lnBeta(0, 1)).toThrow(invalid)
    expect(() => lnBeta(1, Number.NaN)).toThrow(invalid)
    expect(() => lnBeta(1, Number.POSITIVE_INFINITY)).toThrow(invalid)
  })
})

describe('betaInc', () => {
  test('closed form I_x(1, b) = 1 − (1 − x)^b', () => {
    for (const b of [0.5, 1, 3, 17.5]) {
      for (const x of [1e-9, 0.05, 0.4, 0.9]) {
        expectClose(betaInc(1, b, x), -Math.expm1(b * Math.log1p(-x)), 1e-13)
      }
    }
  })

  test('closed form I_x(a, 1) = x^a', () => {
    for (const a of [0.25, 2, 9]) {
      for (const x of [0.01, 0.5, 0.99]) expectClose(betaInc(a, 1, x), x ** a, 1e-13)
    }
  })

  test('symmetry I_x(a, b) = 1 − I_{1−x}(b, a)', () => {
    for (const [a, b, x] of [
      [2.5, 7, 0.3],
      [40, 3, 0.9],
      [0.7, 0.2, 0.6],
      [1000, 1200, 0.46],
    ] as const) {
      expect(Math.abs(betaInc(a, b, x) + betaInc(b, a, 1 - x) - 1)).toBeLessThan(1e-14)
    }
  })

  test('I_{1/2}(a, a) = 1/2 (relative error grows like √a through the continued fraction)', () => {
    for (const a of [0.5, 1, 5, 123.25, 1e4]) expectClose(betaInc(a, a, 0.5), 0.5, 1e-13)
    expectClose(betaInc(1e6, 1e6, 0.5), 0.5, 1e-12)
    expectClose(betaInc(1e8, 1e8, 0.5), 0.5, 5e-11)
  })

  test('matches 40-digit mpmath references (moderate shapes and exact binomial sums at n = 2·10⁶)', () => {
    expect(fixtures.betaInc.length).toBeGreaterThan(50)
    for (const { a, b, x, value } of fixtures.betaInc) {
      expectClose(betaInc(a, b, x), value, 1e-11, 1e-300)
    }
  })

  test('edges and validation', () => {
    expect(betaInc(2, 3, 0)).toBe(0)
    expect(betaInc(2, 3, 1)).toBe(1)
    expect(() => betaInc(2, 3, 1.5)).toThrow(invalid)
    expect(() => betaInc(2, 3, Number.NaN)).toThrow(invalid)
    expect(() => betaInc(-1, 3, 0.5)).toThrow(invalid)
  })
})

describe('betaPpf', () => {
  test('inverts closed forms: Beta(1, b) and Beta(a, 1)', () => {
    for (const q of [1e-10, 0.05, 0.5, 0.95, 1 - 1e-9]) {
      expectClose(betaPpf(q, 1, 4), -Math.expm1(Math.log1p(-q) / 4), 1e-11)
      expectClose(betaPpf(q, 3, 1), q ** (1 / 3), 1e-12)
    }
  })

  test('round-trips through betaInc, deep tails included', () => {
    for (const [a, b] of [
      [0.5, 0.5],
      [2.5, 7],
      [30, 4],
      [500, 800],
    ] as const) {
      for (const q of [1e-12, 1e-4, 0.3, 0.5, 0.8, 0.9999]) {
        const x = betaPpf(q, a, b)
        expect(x).toBeGreaterThan(0)
        expect(x).toBeLessThan(1)
        expectClose(betaInc(a, b, x), q, 1e-9)
      }
    }
  })

  test('is monotone in q and exact at 0 and 1', () => {
    expect(betaPpf(0, 2, 3)).toBe(0)
    expect(betaPpf(1, 2, 3)).toBe(1)
    let previous = 0
    for (const q of [1e-9, 0.01, 0.2, 0.5, 0.7, 0.99]) {
      const x = betaPpf(q, 4, 9)
      expect(x).toBeGreaterThan(previous)
      previous = x
    }
    expect(() => betaPpf(-0.1, 2, 3)).toThrow(invalid)
  })
})
