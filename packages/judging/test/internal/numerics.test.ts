import { describe, expect, test } from 'bun:test'
import { JudgingError } from '../../src/errors.js'
import {
  binomialSf,
  factorial,
  lnBetaPrefactor,
  normIsf,
  ratioToNumber,
} from '../../src/internal/numerics.js'
import { expectClose, expectJudgingError } from '../helpers/fixtures.js'

describe('internal numerics', () => {
  test('ratioToNumber is accurate far outside the double range of its operands', () => {
    expect(ratioToNumber(0n, 7n)).toBe(0)
    expectClose(ratioToNumber(1n, 3n), 1 / 3, 1e-16)
    expectClose(
      ratioToNumber(3n ** 700n, 2n ** 1100n),
      Math.exp(700 * Math.log(3) - 1100 * Math.log(2)),
      1e-12,
    )
    expectClose(
      ratioToNumber(2n ** 1100n, 3n ** 700n),
      Math.exp(1100 * Math.log(2) - 700 * Math.log(3)),
      1e-12,
    )
    expectClose(ratioToNumber(factorial(170), factorial(169)), 170, 1e-15)
  })

  test('lnBetaPrefactor: the Stirling expansion agrees with the direct form where both are exact enough', () => {
    // α, β = 12, 15 (expanded) vs direct logs with lnGamma-based lnBeta
    const direct = (a: number, b: number, x: number): number => {
      let lnB = 0
      for (let i = 1; i < a; i++) lnB += Math.log(i)
      for (let i = 1; i < b; i++) lnB += Math.log(i)
      for (let i = 1; i < a + b; i++) lnB -= Math.log(i)
      return a * Math.log(x) + b * Math.log1p(-x) - lnB
    }
    expectClose(lnBetaPrefactor(12, 15, 0.4), direct(12, 15, 0.4), 1e-12)
    expectClose(lnBetaPrefactor(40, 25, 0.3), direct(40, 25, 0.3), 1e-11)
  })

  test('normIsf is the upper-tail quantile in both halves', () => {
    expectClose(normIsf(0.025), 1.959963984540054, 1e-14)
    expectClose(normIsf(0.975), -1.959963984540054, 1e-14)
    expect(normIsf(1e-300)).toBeGreaterThan(37)
  })

  test('negentropy failures surface as JudgingError numerical with the cause', () => {
    const error = expectJudgingError(() => binomialSf(1, 10, 2), 'numerical')
    expect(error).toBeInstanceOf(JudgingError)
    expect((error.cause as Error).name).toBe('NegentropyError')
  })
})
