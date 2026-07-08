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
