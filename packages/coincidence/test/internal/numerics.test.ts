import { describe, expect, test } from 'bun:test'
import {
  FALLING_LOOP_LIMIT,
  lnFallingOverPower,
  lnGamma,
  log1pmx,
  NeumaierSum,
  oneMinusExp,
  poissonSplit,
  reachesTarget,
} from '../../src/internal/numerics.js'
import fixture from '../fixtures/numerics.json' with { type: 'json' }
import { expectClose } from '../helpers/exact.js'

describe('lnGamma', () => {
  test('agrees with mpmath loggamma (fixture)', () => {
    for (const { x, value } of fixture.lnGamma) {
      expect(Math.abs(lnGamma(Number(x)) - value)).toBeLessThanOrEqual(
        Math.max(1e-14, 1e-14 * Math.abs(value)),
      )
    }
  })
})

describe('lnFallingOverPower', () => {
  test('agrees with mpmath for the loop, Stirling and small-remainder branches (fixture)', () => {
    for (const { a, m, c, value } of fixture.lnFallingOverPower) {
      expect(Math.abs(lnFallingOverPower(a, m, c) - value)).toBeLessThanOrEqual(
        Math.max(1e-12, 1e-13 * Math.abs(value)),
      )
    }
  })

  test('the Stirling form continues the summed form across the loop limit', () => {
    const direct = (a: number, m: number, c: number) => {
      const sum = new NeumaierSum()
      for (let i = 0; i < m; i++) sum.add(Math.log1p((a - i - c) / c))
      return sum.value
    }
    const m = FALLING_LOOP_LIMIT + 1
    for (const [a, c] of [
      [1e6, 1e6],
      [1e12, 1e12],
      [m + 40, 1e4],
      [m + 3, 5e3],
      [5e5 - 11, 5e5],
    ] as const) {
      expectClose(lnFallingOverPower(a, m, c), direct(a, m, c), 1e-13)
    }
  })

  test('zero factors give −∞; empty products give 0', () => {
    expect(lnFallingOverPower(5, 6, 5)).toBe(Number.NEGATIVE_INFINITY)
    expect(lnFallingOverPower(5, 0, 5)).toBe(0)
    expect(lnFallingOverPower(5, 5, 5)).toBeCloseTo(Math.log(120 / 3125), 14)
  })
})

describe('poissonSplit', () => {
  test('both tails at full relative precision (mpmath fixture)', () => {
    for (const { k, lambda, below, atLeast } of fixture.poisson) {
      const split = poissonSplit(k, lambda)
      expectClose(split.below, below, 1e-12, 1e-310)
      expectClose(split.atLeast, atLeast, 1e-12, 1e-310)
    }
    expect(poissonSplit(0, 3)).toEqual({ below: 0, atLeast: 1 })
    expect(poissonSplit(2, 0)).toEqual({ below: 1, atLeast: 0 })
  })
})

describe('small helpers', () => {
  test('log1pmx, oneMinusExp and reachesTarget', () => {
    expectClose(log1pmx(1e-5), Math.log1p(1e-5) - 1e-5, 1e-9)
    expectClose(log1pmx(0.3), Math.log1p(0.3) - 0.3, 1e-14)
    expect(Object.is(oneMinusExp(0), 0)).toBe(true)
    expect(reachesTarget(Math.log(0.25), 0.75)).toBe(true)
    expect(reachesTarget(Math.log(0.26), 0.75)).toBe(false)
    expect(reachesTarget(Math.log(0.85), 0.1)).toBe(true)
    expect(reachesTarget(Number.NEGATIVE_INFINITY, 1)).toBe(true)
    expect(reachesTarget(-800, 1)).toBe(false)
  })

  test('NeumaierSum keeps an added term larger than the running sum', () => {
    const sum = new NeumaierSum()
    for (const x of [1, 1e100, 1, -1e100]) sum.add(x)
    expect(sum.value).toBe(2)
  })
})
