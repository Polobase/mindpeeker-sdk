import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  erfc,
  gammaP,
  gammaPrefactor,
  gammaQ,
  lnGamma,
  log1pmx,
  stirlingCorrection,
} from '../../src/internal/gamma.js'
import { chi2Cdf, chi2Sf, normCdf, normPpf, normSf } from '../../src/internal/special.js'

interface NumericsFixtures {
  gammaLarge: Array<{ a: number; x: number; p: number; q: number }>
  chi2SfLargeDf: Array<{ x: number; k: number; value: number }>
}

const fixtures = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'fixtures', 'numerics.json'), 'utf8'),
) as NumericsFixtures

function expectClose(actual: number, expected: number, relTol: number, absTol = 1e-300) {
  const err = Math.abs(actual - expected)
  expect(err).toBeLessThanOrEqual(Math.max(absTol, relTol * Math.abs(expected)))
}

describe('incomplete gamma beyond a = 12 000 (Temme expansion)', () => {
  test('matches 40-digit mpmath references from a = 1e5 to a = 5e8, deep tails included', () => {
    expect(fixtures.gammaLarge.length).toBeGreaterThan(50)
    for (const { a, x, p, q } of fixtures.gammaLarge) {
      expectClose(gammaP(a, x), p, 1e-12, 1e-300)
      expectClose(gammaQ(a, x), q, 1e-12, 1e-300)
    }
  })

  test('GCP-scale chi-square survival (df = 60 sources × 86 400 s) never throws', () => {
    for (const { x, k, value } of fixtures.chi2SfLargeDf) {
      expectClose(chi2Sf(x, k), value, 1e-12)
    }
  })

  test('the reproduced crash band now yields p ≈ 0.56 (was an untyped Error)', () => {
    // devvar statistic 5 183 500 on df 5 184 000 — normal approx z = −0.155
    expectClose(chi2Sf(5_183_500, 5_184_000), 0.5616210512792313, 1e-12)
    expect(() => chi2Sf(4e6, 4e6)).not.toThrow()
  })

  test('df up to 1e9 is O(1): 10⁴ evaluations at df = 1e7 finish quickly', () => {
    const started = performance.now()
    for (let i = 0; i < 10_000; i++) chi2Sf(1e7 + (i - 5000) * 4.4721, 1e7)
    expect(performance.now() - started).toBeLessThan(2000)
  })

  test('chi2Sf(df, df) sits just below ½ by ≈ (2/3)/√(4π·df)', () => {
    for (const df of [1e4, 1e6, 1e8, 1e9]) {
      const gap = 0.5 - chi2Sf(df, df)
      expect(gap).toBeGreaterThan(0)
      const predicted = 2 / 3 / Math.sqrt(4 * Math.PI * df)
      expect(Math.abs(gap / predicted - 1)).toBeLessThan(0.01)
    }
  })

  test('agrees with Wilson–Hilferty to 1e-9 at huge df where WH is valid (|z| ≤ 3)', () => {
    for (const df of [1e8, 1e9]) {
      const h = 2 / (9 * df)
      for (const z of [-3, -1.5, -0.2, 0, 0.7, 2, 3]) {
        const x = df * (1 - h + z * Math.sqrt(h)) ** 3
        expect(Math.abs(chi2Cdf(x, df) - normCdf(z))).toBeLessThan(1e-9)
      }
    }
  })

  test('approaches the normal approximation as df grows', () => {
    const df = 1e9
    for (const z of [-2, 0.5, 2.5]) {
      const x = df + z * Math.sqrt(2 * df)
      expect(Math.abs(chi2Sf(x, df) - normSf(z))).toBeLessThan(1e-4)
    }
  })

  test('is monotone and continuous across the method switch |x − a| = 0.3a', () => {
    for (const a of [100, 150, 1000, 1e5]) {
      for (const edge of [0.7 * a, 1.3 * a]) {
        const below = gammaQ(a, edge * (1 - 1e-13))
        const above = gammaQ(a, edge * (1 + 1e-13))
        expect(above).toBeLessThanOrEqual(below)
        expectClose(above, below, 1e-10, 1e-300)
        expect(Math.abs(gammaP(a, edge) + gammaQ(a, edge) - 1)).toBeLessThan(1e-14)
      }
      let previous = 2
      const sd = Math.sqrt(a)
      for (let k = -40; k <= 40; k += 0.25) {
        const x = a + k * sd
        if (x <= 0) continue
        const value = gammaQ(a, x)
        expect(value).toBeLessThanOrEqual(previous)
        previous = value
      }
    }
  })

  test('P + Q = 1 inside the Temme band', () => {
    for (const a of [100, 2500.5, 1e6, 3e8]) {
      for (const k of [-3, -0.3, 0, 0.3, 3]) {
        const x = a + k * Math.sqrt(a)
        expect(Math.abs(gammaP(a, x) + gammaQ(a, x) - 1)).toBeLessThan(1e-14)
      }
    }
  })
})

describe('exact limits and NaN', () => {
  test('infinite arguments return exact limits instead of iterating', () => {
    expect(gammaQ(2.5, Number.POSITIVE_INFINITY)).toBe(0)
    expect(gammaP(2.5, Number.POSITIVE_INFINITY)).toBe(1)
    expect(gammaQ(1e7, Number.POSITIVE_INFINITY)).toBe(0)
    expect(erfc(Number.POSITIVE_INFINITY)).toBe(0)
    expect(erfc(Number.NEGATIVE_INFINITY)).toBe(2)
    expect(erfc(1e300)).toBe(0)
    expect(normSf(Number.POSITIVE_INFINITY)).toBe(0)
    expect(normSf(Number.NEGATIVE_INFINITY)).toBe(1)
    expect(normCdf(Number.NEGATIVE_INFINITY)).toBe(0)
    expect(chi2Sf(Number.POSITIVE_INFINITY, 5)).toBe(0)
    expect(chi2Sf(Number.NEGATIVE_INFINITY, 5)).toBe(1)
    expect(chi2Cdf(Number.POSITIVE_INFINITY, 5)).toBe(1)
  })

  test('NaN throws invalid_config everywhere', () => {
    const invalid = expect.objectContaining({ name: 'NegentropyError', code: 'invalid_config' })
    expect(() => gammaP(Number.NaN, 1)).toThrow(invalid)
    expect(() => gammaQ(1, Number.NaN)).toThrow(invalid)
    expect(() => gammaQ(Number.POSITIVE_INFINITY, 1)).toThrow(invalid)
    expect(() => erfc(Number.NaN)).toThrow(invalid)
    expect(() => normSf(Number.NaN)).toThrow(invalid)
    expect(() => normCdf(Number.NaN)).toThrow(invalid)
    expect(() => normPpf(Number.NaN)).toThrow(invalid)
    expect(() => chi2Sf(Number.NaN, 3)).toThrow(invalid)
  })
})

describe('cancellation-free building blocks', () => {
  test('log1pmx matches ln(1+u) − u in both regimes', () => {
    for (const u of [-0.9, -0.5, -0.3, -1e-3, 0.2, 0.49, 0.5, 3, 1e6]) {
      expectClose(log1pmx(u), Math.log1p(u) - u, 1e-10, 1e-300)
    }
    // tiny u: −u²/2 + u³/3 exactly, where ln(1+u) − u would round to garbage
    expectClose(log1pmx(1e-9), -5e-19 + 1e-27 / 3, 1e-15)
  })

  test('Stirling correction δ(a) = lnΓ(a) − [(a − ½)ln a − a + ½ln 2π]', () => {
    for (const a of [10, 12.5, 40, 1000]) {
      const direct = lnGamma(a) - ((a - 0.5) * Math.log(a) - a + 0.5 * Math.log(2 * Math.PI))
      expectClose(stirlingCorrection(a), direct, 1e-9)
    }
    expectClose(stirlingCorrection(1e6), 1 / 12e6, 1e-12)
  })

  test('gammaPrefactor agrees with the direct form where both are accurate', () => {
    for (const [a, x] of [
      [12, 3],
      [12, 12],
      [50, 80],
      [300, 290],
    ] as const) {
      const direct = Math.exp(a * Math.log(x) - x - lnGamma(a))
      expectClose(gammaPrefactor(a, x), direct, 1e-12)
    }
  })

  test('the quantile of the normal approximation stays consistent at df = 5·10⁸', () => {
    const df = 5e8
    const x = df + normPpf(0.975) * Math.sqrt(2 * df)
    expect(Math.abs(chi2Cdf(x, df) - 0.975)).toBeLessThan(1e-3)
  })
})
