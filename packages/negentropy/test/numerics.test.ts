import { describe, expect, test } from 'bun:test'
import {
  chi2Cdf,
  chi2Ppf,
  chi2Sf,
  concatBytes,
  erfc,
  gammaP,
  gammaQ,
  KahanSum,
  lnGamma,
  normCdf,
  normPpf,
  normSf,
  POPCOUNT,
  toBits,
  Welford,
} from '../src/numerics.js'

/**
 * The `./numerics` subpath is a public re-export of internals that sibling
 * packages depend on. Deep accuracy is covered by test/internal/*.test.ts
 * against scipy fixtures; here we pin the barrel's surface (every name is
 * exported and callable) and spot-check values so a broken re-export or a
 * swapped implementation fails loudly.
 */
describe('numerics barrel surface', () => {
  test('every re-export is a function or class', () => {
    const callables = {
      chi2Cdf,
      chi2Ppf,
      chi2Sf,
      concatBytes,
      erfc,
      gammaP,
      gammaQ,
      KahanSum,
      lnGamma,
      normCdf,
      normPpf,
      normSf,
      toBits,
      Welford,
    }
    for (const [name, value] of Object.entries(callables)) {
      expect(typeof value, `${name} should be a function/class`).toBe('function')
    }
  })

  test('POPCOUNT is the 256-entry per-byte one-bits table', () => {
    expect(POPCOUNT).toBeInstanceOf(Uint8Array)
    expect(POPCOUNT.length).toBe(256)
    expect(POPCOUNT[0]).toBe(0)
    expect(POPCOUNT[1]).toBe(1)
    expect(POPCOUNT[0b1010_1010]).toBe(4)
    expect(POPCOUNT[255]).toBe(8)
  })
})

describe('special functions spot checks', () => {
  test('normCdf/normSf at zero and symmetry', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 15)
    expect(normSf(0)).toBeCloseTo(0.5, 15)
    expect(normCdf(1.96) + normSf(1.96)).toBeCloseTo(1, 14)
  })

  test('normPpf inverts normCdf at the 97.5th percentile', () => {
    expect(normPpf(0.975)).toBeCloseTo(1.959963984540054, 12)
    expect(normCdf(normPpf(0.123456))).toBeCloseTo(0.123456, 12)
  })

  test('chi2Sf(1.96², 1) ≈ 0.05 (two-sided normal ↔ chi-square df=1 identity)', () => {
    // chi2Sf(z², 1) = 2·(1 − Φ(z)); at z = 1.96 that is 0.04999579…
    expect(chi2Sf(1.96 ** 2, 1)).toBeCloseTo(0.05, 4)
    expect(chi2Sf(1.96 ** 2, 1)).toBeCloseTo(2 * normSf(1.96), 14)
  })

  test('chi2Cdf + chi2Sf = 1 and chi2Ppf round-trips', () => {
    expect(chi2Cdf(3.5, 4) + chi2Sf(3.5, 4)).toBeCloseTo(1, 14)
    expect(chi2Ppf(chi2Cdf(3.5, 4), 4)).toBeCloseTo(3.5, 10)
  })

  test('gammaP + gammaQ = 1 and Q(1, x) = exp(−x)', () => {
    expect(gammaP(2.5, 1.3) + gammaQ(2.5, 1.3)).toBeCloseTo(1, 14)
    expect(gammaQ(1, 2)).toBeCloseTo(Math.exp(-2), 13)
  })

  test('erfc anchors: erfc(0) = 1, erfc(x) + erfc(−x) = 2', () => {
    expect(erfc(0)).toBe(1)
    expect(erfc(0.7) + erfc(-0.7)).toBeCloseTo(2, 14)
  })

  test('lnGamma matches exact factorials', () => {
    expect(lnGamma(5)).toBeCloseTo(Math.log(24), 14)
    expect(lnGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 14)
  })
})

describe('KahanSum', () => {
  test('recovers a low-order bit that naive summation drops', () => {
    // 1 + ε/2 + ε/2: naive float addition yields 1 (each half-ulp rounds away);
    // Kahan compensation carries it and lands exactly on 1 + ε.
    const kahan = new KahanSum()
    kahan.add(1)
    kahan.add(Number.EPSILON / 2)
    kahan.add(Number.EPSILON / 2)
    expect(kahan.value).toBe(1 + Number.EPSILON)
    expect(1 + Number.EPSILON / 2 + Number.EPSILON / 2).toBe(1)
  })

  test('sums repeated decimals tightly', () => {
    const kahan = new KahanSum()
    for (let i = 0; i < 10; i++) kahan.add(0.1)
    expect(kahan.value).toBeCloseTo(1, 15)
  })
})

describe('Welford', () => {
  test('mean, sample and population variance on a known set', () => {
    const w = new Welford()
    for (const x of [2, 4, 4, 4, 5, 5, 7, 9]) w.push(x)
    expect(w.n).toBe(8)
    expect(w.mean).toBeCloseTo(5, 14)
    expect(w.populationVariance).toBeCloseTo(4, 14)
    expect(w.variance).toBeCloseTo(32 / 7, 14)
    expect(w.sd).toBeCloseTo(Math.sqrt(32 / 7), 14)
  })

  test('variance is NaN below two observations', () => {
    const w = new Welford()
    expect(w.variance).toBeNaN()
    w.push(3)
    expect(w.variance).toBeNaN()
    expect(w.mean).toBe(3)
  })
})

describe('byte utilities', () => {
  test('toBits unpacks MSB-first (SDK-wide bit order)', () => {
    expect(Array.from(toBits(new Uint8Array([0b1011_0001])))).toEqual([1, 0, 1, 1, 0, 0, 0, 1])
    expect(Array.from(toBits(new Uint8Array([0x80, 0x01])))).toEqual([
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ])
  })

  test('concatBytes preserves order and handles empty input', () => {
    const joined = concatBytes([new Uint8Array([1, 2]), new Uint8Array([]), new Uint8Array([3])])
    expect(Array.from(joined)).toEqual([1, 2, 3])
    expect(concatBytes([]).length).toBe(0)
  })
})
