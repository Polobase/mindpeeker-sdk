import { describe, expect, test } from 'bun:test'
import {
  halfSquarePlusLnPhi,
  lnGammaP,
  lnGammaPrefactor,
  normalHazardLower,
  stirlingRemainder,
} from '../../src/internal/log-tails.js'
import { lnGamma } from '../../src/internal/special.js'

function logSumExp(values: readonly number[]): number {
  const max = Math.max(...values)
  let sum = 0
  for (const v of values) sum += Math.exp(v - max)
  return max + Math.log(sum)
}

/** ln P(a, x) for integer a via the Poisson identity P(a, x) = P(Poisson(x) ≥ a). */
function poissonUpperLn(a: number, x: number): number {
  const terms: number[] = []
  for (let k = a; k < a + 4000; k++) terms.push(-x + k * Math.log(x) - lnGamma(k + 1))
  return logSumExp(terms)
}

/** Laplace's continued fraction for the Mills ratio R(t) = Φ(−t)/φ(t), t > 0. */
function millsRatio(t: number): number {
  let tail = t
  for (let k = 200; k >= 1; k--) tail = t + k / tail
  return 1 / tail
}

describe('lnGammaP', () => {
  test('a = 1 closed form ln(1 − e⁻ˣ), including the underflow branch', () => {
    for (const x of [1e-300, 1e-100, 1e-10, 0.5, 5, 50]) {
      const expected = x > Math.LN2 ? Math.log1p(-Math.exp(-x)) : Math.log(-Math.expm1(-x))
      expect(Math.abs(lnGammaP(1, x) - expected)).toBeLessThanOrEqual(1e-13 * Math.abs(expected))
    }
  })

  test('integer a against the Poisson tail (lower-series, linear and log1p branches)', () => {
    for (const [a, x] of [
      [500, 50], // P ≈ e^−705: below the linear floor
      [500, 480],
      [500, 700],
      [30, 2],
    ] as const) {
      const expected = poissonUpperLn(a, x)
      expect(Math.abs(lnGammaP(a, x) - expected)).toBeLessThan(
        1e-10 * Math.max(1, Math.abs(expected)),
      )
    }
  })

  test('prefactor and Stirling remainder agree with lnΓ directly', () => {
    for (const [a, x] of [
      [3, 2],
      [50, 40],
      [1e4, 1.2e4],
    ] as const) {
      const direct = a * Math.log(x) - x - lnGamma(a)
      expect(lnGammaPrefactor(a, x)).toBeCloseTo(direct, 8)
    }
    for (const a of [0.5, 9.5, 10, 1000]) {
      const direct = lnGamma(a) - ((a - 0.5) * Math.log(a) - a + 0.5 * Math.log(2 * Math.PI))
      expect(stirlingRemainder(a)).toBeCloseTo(direct, 11)
    }
  })
})

describe('halfSquarePlusLnPhi', () => {
  test('matches x²/2 + ln Φ(x) through Laplace’s Mills-ratio continued fraction', () => {
    for (const x of [-1e6, -1000, -45, -30.5, -29.5, -12, -6]) {
      const expected = -0.5 * Math.log(2 * Math.PI) + Math.log(millsRatio(-x))
      expect(Math.abs(halfSquarePlusLnPhi(x) - expected)).toBeLessThan(1e-12 * Math.abs(expected))
    }
  })

  test('positive side and the φ/Φ hazard', () => {
    expect(halfSquarePlusLnPhi(0)).toBeCloseTo(Math.log(0.5), 15)
    expect(halfSquarePlusLnPhi(10)).toBeCloseTo(50, 12)
    // φ(0)/Φ(0) = 2/√(2π); for x → −∞, φ/Φ → −x
    expect(normalHazardLower(0)).toBeCloseTo(2 / Math.sqrt(2 * Math.PI), 14)
    expect(normalHazardLower(-1e4) / 1e4).toBeCloseTo(1, 7)
  })
})
