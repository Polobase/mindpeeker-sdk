import { describe, expect, test } from 'bun:test'
import { chiSquareP, normalP, P_FLOOR } from '../../src/stats/pvalues.js'

describe('normalP', () => {
  test('tails', () => {
    expect(normalP(1.959963984540054, 'upper')).toBeCloseTo(0.025, 10)
    expect(normalP(-1.959963984540054, 'lower')).toBeCloseTo(0.025, 10)
    expect(normalP(1.959963984540054, 'two')).toBeCloseTo(0.05, 10)
    expect(normalP(0, 'two')).toBe(1)
  })

  test('never returns zero — floored for probit safety', () => {
    expect(normalP(60, 'upper')).toBeGreaterThanOrEqual(P_FLOOR)
    expect(normalP(-60, 'lower')).toBeGreaterThanOrEqual(P_FLOOR)
  })
})

describe('chiSquareP', () => {
  test('matches the GCP triple and simple identities', () => {
    expect(chiSquareP(15332, 15000)).toBeCloseTo(0.02828082914199243, 10)
    expect(chiSquareP(2, 2)).toBeCloseTo(Math.exp(-1), 12)
    expect(chiSquareP(0, 5)).toBe(1)
  })

  test('floored deep in the tail', () => {
    expect(chiSquareP(10_000, 10)).toBeGreaterThanOrEqual(P_FLOOR)
  })
})

describe('boundary validation', () => {
  const invalid = expect.objectContaining({ name: 'NegentropyError', code: 'invalid_config' })

  test('NaN and infinite statistics throw invalid_config (never a RangeError)', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => normalP(bad)).toThrow(invalid)
      expect(() => chiSquareP(bad, 5)).toThrow(invalid)
    }
    expect(() => chiSquareP(5, 0)).toThrow(invalid)
    expect(() => chiSquareP(5, Number.NaN)).toThrow(invalid)
    expect(() => normalP(1, 'sideways' as 'two')).toThrow(invalid)
  })

  test('GCP network scale: devvar-sized df gives a p-value on both sides of the mean', () => {
    const df = 60 * 86_400
    const sd = Math.sqrt(2 * df)
    for (const z of [-1.366, -0.155, 0, 0.3, 2]) {
      const p = chiSquareP(df + z * sd, df)
      expect(Math.abs(p - normalP(z, 'upper'))).toBeLessThan(2e-3) // skew √(8/df) ≈ 1.2e-3
    }
  })
})
