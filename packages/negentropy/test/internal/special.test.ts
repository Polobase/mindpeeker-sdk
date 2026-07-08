import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  chi2Cdf,
  chi2Ppf,
  chi2Sf,
  erfc,
  gammaP,
  gammaQ,
  lnGamma,
  normCdf,
  normPpf,
  normSf,
} from '../../src/internal/special.js'

interface SpecialFixtures {
  gammainc: Array<{ a: number; x: number; p: number; q: number }>
  erfc: Array<{ x: number; value: number }>
  normSf: Array<{ z: number; value: number }>
  normPpf: Array<{ p: number; value: number }>
  chi2Sf: Array<{ x: number; k: number; value: number }>
  chi2Ppf: Array<{ p: number; k: number; value: number }>
}

const fixtures = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'fixtures', 'special.json'), 'utf8'),
) as SpecialFixtures

/** Relative-error assertion with an absolute floor for values near zero. */
function expectClose(actual: number, expected: number, relTol: number, absTol = 1e-300) {
  const err = Math.abs(actual - expected)
  const bound = Math.max(absTol, relTol * Math.abs(expected))
  expect(err).toBeLessThanOrEqual(bound)
}

describe('lnGamma', () => {
  test('matches exact factorials', () => {
    // Γ(n) = (n−1)!
    expectClose(lnGamma(1), 0, 1e-14, 1e-14)
    expectClose(lnGamma(2), 0, 1e-14, 1e-14)
    expectClose(lnGamma(5), Math.log(24), 1e-14)
    expectClose(lnGamma(11), Math.log(3628800), 1e-14)
  })

  test('matches Γ(1/2) = √π and the reflection region', () => {
    expectClose(lnGamma(0.5), Math.log(Math.sqrt(Math.PI)), 1e-14)
    expectClose(lnGamma(0.25), Math.log(3.625609908221908), 1e-13) // Γ(1/4)
  })

  test('rejects non-positive arguments', () => {
    expect(() => lnGamma(0)).toThrow(RangeError)
    expect(() => lnGamma(-1)).toThrow(RangeError)
  })
})

describe('incomplete gamma', () => {
  test('Q(1, x) = exp(−x) exactly (chi-square df=2 identity)', () => {
    for (const x of [0.1, 1, 5, 20, 100]) {
      expectClose(gammaQ(1, x), Math.exp(-x), 1e-13)
    }
  })

  test('Q(n, x) equals the Poisson tail sum for integer n', () => {
    // Q(n, x) = e^{−x} Σ_{j<n} x^j/j!
    for (const n of [1, 2, 3, 5, 8, 10]) {
      for (const x of [0.5, 2, 7.5, 15]) {
        let term = 1
        let sum = 1
        for (let j = 1; j < n; j++) {
          term *= x / j
          sum += term
        }
        expectClose(gammaQ(n, x), Math.exp(-x) * sum, 1e-12)
      }
    }
  })

  test('P + Q = 1 across both branches', () => {
    for (const a of [0.5, 3, 42, 1234]) {
      for (const ratio of [0.2, 0.9, 1.0, 1.1, 3]) {
        const x = a * ratio
        expect(Math.abs(gammaP(a, x) + gammaQ(a, x) - 1)).toBeLessThan(1e-13)
      }
    }
  })

  test('matches the scipy fixture grid to 1e-10 relative', () => {
    for (const { a, x, p, q } of fixtures.gammainc) {
      expectClose(gammaP(a, x), p, 1e-10, 1e-280)
      expectClose(gammaQ(a, x), q, 1e-10, 1e-280)
    }
  })

  test('is monotone in x and handles edges', () => {
    expect(gammaP(3, 0)).toBe(0)
    expect(gammaQ(3, 0)).toBe(1)
    let previous = -1
    for (let x = 0.1; x < 30; x += 0.7) {
      const value = gammaP(4.2, x)
      expect(value).toBeGreaterThan(previous)
      expect(value).toBeLessThanOrEqual(1)
      previous = value
    }
    expect(() => gammaP(0, 1)).toThrow(RangeError)
    expect(() => gammaQ(2, -1)).toThrow(RangeError)
  })
})

describe('erfc / normal', () => {
  test('erfc known answers', () => {
    expect(erfc(0)).toBe(1)
    expectClose(erfc(1), 0.15729920705028513, 1e-12)
    expectClose(erfc(-1), 1.8427007929497148, 1e-12)
  })

  test('erfc matches the fixture grid', () => {
    for (const { x, value } of fixtures.erfc) {
      expectClose(erfc(x), value, 1e-11, 1e-280)
    }
  })

  test('normSf matches fixtures including deep tails', () => {
    for (const { z, value } of fixtures.normSf) {
      expectClose(normSf(z), value, 1e-11, 1e-280)
    }
  })

  test('normCdf and normSf are complementary', () => {
    for (const z of [-4, -1, 0, 0.3, 2, 5]) {
      expect(Math.abs(normCdf(z) + normSf(z) - 1)).toBeLessThan(1e-14)
    }
  })

  test('normPpf matches fixtures', () => {
    for (const { p, value } of fixtures.normPpf) {
      expectClose(normPpf(p), value, 1e-12, 1e-12)
    }
  })

  test('normPpf(0.975) is the canonical 1.96', () => {
    expectClose(normPpf(0.975), 1.959963984540054, 1e-13)
  })

  test('normPpf round-trips through normCdf below the upper saturation region', () => {
    // above z ≈ 4 the CDF saturates toward 1 and float64 representation of p
    // (not the algorithms) caps the recoverable precision — the tail is
    // covered by the normSf round-trip below
    for (let z = -8; z <= 4; z += 0.25) {
      expect(Math.abs(normPpf(normCdf(z)) - z)).toBeLessThan(1e-9)
    }
  })

  test('normPpf round-trips through normSf in the deep tail', () => {
    for (let z = 0; z <= 8; z += 0.25) {
      expect(Math.abs(normPpf(normSf(z)) + z)).toBeLessThan(1e-9)
    }
  })

  test('normPpf rejects out-of-domain p', () => {
    expect(() => normPpf(0)).toThrow(RangeError)
    expect(() => normPpf(1)).toThrow(RangeError)
    expect(() => normPpf(-0.5)).toThrow(RangeError)
  })
})

describe('chi-square', () => {
  test('sf/cdf match fixtures, including the GCP 9/11 triple', () => {
    for (const { x, k, value } of fixtures.chi2Sf) {
      expectClose(chi2Sf(x, k), value, 1e-10, 1e-280)
    }
  })

  test('chi2Sf(15332, 15000) reproduces the published p ≈ 0.028', () => {
    expectClose(chi2Sf(15332, 15000), 0.02828082914199243, 1e-10)
  })

  test('ppf matches fixtures', () => {
    for (const { p, k, value } of fixtures.chi2Ppf) {
      expectClose(chi2Ppf(p, k), value, 1e-9)
    }
  })

  test('chi2Ppf(0.95, 1) is the squared 1.96', () => {
    expectClose(chi2Ppf(0.95, 1), 1.959963984540054 ** 2, 1e-11)
  })

  test('ppf round-trips through cdf', () => {
    for (const k of [1, 2, 7, 64, 1500]) {
      for (const x of [k * 0.3, k * 0.9, k * 1.05, k * 1.8]) {
        const p = chi2Cdf(x, k)
        if (p >= 1) continue // CDF saturated in float64 — nothing to invert
        expectClose(chi2Ppf(p, k), x, 1e-8)
      }
    }
  })

  test('edges and domain errors', () => {
    expect(chi2Sf(0, 5)).toBe(1)
    expect(chi2Cdf(-3, 5)).toBe(0)
    expect(() => chi2Ppf(0, 5)).toThrow(RangeError)
    expect(() => chi2Ppf(0.5, 0)).toThrow(RangeError)
  })
})
