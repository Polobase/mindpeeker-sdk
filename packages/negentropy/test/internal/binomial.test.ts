import { describe, expect, test } from 'bun:test'
import { binomialCdf, binomialPmf, binomialSf } from '../../src/internal/binomial.js'

/** Exact rational → double, correctly rounded to ~1e-16 via a 64-bit quotient. */
function ratio(numerator: bigint, denominator: bigint): number {
  if (numerator === 0n) return 0
  const shift = Math.max(0, denominator.toString(2).length - numerator.toString(2).length + 64)
  const quotient = (numerator << BigInt(shift)) / denominator
  return Number(quotient) / 2 ** shift
}

function choose(n: number, k: number): bigint {
  let result = 1n
  for (let i = 1; i <= k; i++) result = (result * BigInt(n - k + i)) / BigInt(i)
  return result
}

/** Exact Binomial(n, r/s) masses as numerators over s^n. */
function exactMasses(n: number, r: number, s: number): { masses: bigint[]; total: bigint } {
  const masses: bigint[] = []
  for (let j = 0; j <= n; j++) {
    masses.push(choose(n, j) * BigInt(r) ** BigInt(j) * BigInt(s - r) ** BigInt(n - j))
  }
  return { masses, total: BigInt(s) ** BigInt(n) }
}

function expectClose(actual: number, expected: number, relTol: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(relTol * Math.abs(expected))
}

describe('binomial against exact BigInt enumeration (n ≤ 60)', () => {
  for (const [r, s] of [
    [1, 2],
    [1, 3],
    [1, 7],
    [9, 10],
  ] as const) {
    test(`p = ${r}/${s}: pmf, CDF and SF at every k for n ∈ {1, 5, 17, 40, 60}`, () => {
      const p = r / s
      for (const n of [1, 5, 17, 40, 60]) {
        const { masses, total } = exactMasses(n, r, s)
        let below = 0n
        for (let k = 0; k <= n; k++) {
          const mass = masses[k] as bigint
          below += mass
          const above = total - below
          expectClose(binomialPmf(k, n, p), ratio(mass, total), 1e-12)
          expectClose(binomialCdf(k, n, p), ratio(below, total), 1e-12)
          if (above > 0n) expectClose(binomialSf(k, n, p), ratio(above, total), 1e-11)
          else expect(binomialSf(k, n, p)).toBe(0)
        }
      }
    })
  }

  test('the smallest tail masses keep full relative precision (P(X = 60) = 7⁻⁶⁰)', () => {
    const { masses, total } = exactMasses(60, 1, 7)
    expectClose(binomialSf(59, 60, 1 / 7), ratio(masses[60] as bigint, total), 1e-11)
    expectClose(binomialCdf(0, 60, 6 / 7), ratio(masses[60] as bigint, total), 1e-11)
  })
})

describe('binomial at large n (log space)', () => {
  test('CDF + SF = 1 and the pmf sums to the CDF increment at n = 10⁸', () => {
    const n = 100_000_000
    for (const k of [49_990_000, 50_000_000, 50_004_000]) {
      expect(Math.abs(binomialCdf(k, n, 0.5) + binomialSf(k, n, 0.5) - 1)).toBeLessThan(1e-13)
      const increment = binomialCdf(k, n, 0.5) - binomialCdf(k - 1, n, 0.5)
      expectClose(binomialPmf(k, n, 0.5), increment, 1e-8)
    }
    // mode mass ≈ √(2/(πn))
    expectClose(binomialPmf(n / 2, n, 0.5), Math.sqrt(2 / (Math.PI * n)), 1e-7)
  })

  test('tiny p with huge n approaches the Poisson limit', () => {
    const n = 1e9
    const p = 3e-9 // λ = 3
    expectClose(binomialPmf(2, n, p), (Math.exp(-3) * 9) / 2, 1e-7)
    expectClose(binomialCdf(2, n, p), Math.exp(-3) * (1 + 3 + 4.5), 1e-7)
  })
})

describe('conventions and validation', () => {
  test('SF is strictly greater (scipy), k floors, and ±∞ give limits', () => {
    expect(binomialSf(3, 3, 0.4)).toBe(0)
    expect(binomialCdf(3, 3, 0.4)).toBe(1)
    expect(binomialCdf(-1, 3, 0.4)).toBe(0)
    expect(binomialSf(-1, 3, 0.4)).toBe(1)
    expect(binomialCdf(1.9, 4, 0.5)).toBe(binomialCdf(1, 4, 0.5))
    expect(binomialCdf(Number.POSITIVE_INFINITY, 4, 0.5)).toBe(1)
    expect(binomialSf(Number.NEGATIVE_INFINITY, 4, 0.5)).toBe(1)
    expect(binomialPmf(1.5, 4, 0.5)).toBe(0)
    expect(binomialPmf(0, 0, 0.3)).toBe(1)
  })

  test('degenerate p', () => {
    expect(binomialPmf(0, 5, 0)).toBe(1)
    expect(binomialPmf(5, 5, 1)).toBe(1)
    expect(binomialCdf(2, 5, 0)).toBe(1)
    expect(binomialSf(2, 5, 1)).toBe(1)
  })

  test('invalid n, p, or NaN k throw invalid_config', () => {
    const invalid = expect.objectContaining({ name: 'NegentropyError', code: 'invalid_config' })
    expect(() => binomialCdf(1, 2.5, 0.5)).toThrow(invalid)
    expect(() => binomialCdf(1, -1, 0.5)).toThrow(invalid)
    expect(() => binomialSf(1, 4, 1.2)).toThrow(invalid)
    expect(() => binomialPmf(Number.NaN, 4, 0.5)).toThrow(invalid)
  })
})
