import { describe, expect, test } from 'bun:test'
import { NegentropyError } from '../../src/errors.js'
import { anytimeP, villeCrossing } from '../../src/stats/eprocess.js'
import { P_FLOOR } from '../../src/stats/pvalues.js'

describe('anytimeP', () => {
  test('is the running 1 / max M, capped at 1 and floored', () => {
    const p = anytimeP([-1, Math.log(4), Math.log(2), Math.log(10), 1e6])
    expect(p[0]).toBe(1)
    expect(p[1]).toBeCloseTo(0.25, 15)
    expect(p[2]).toBeCloseTo(0.25, 15) // never increases
    expect(p[3]).toBeCloseTo(0.1, 15)
    expect(p[4]).toBe(P_FLOOR)
  })

  test('accepts −∞ (M = 0) and an empty path, rejects NaN', () => {
    expect([...anytimeP([Number.NEGATIVE_INFINITY])]).toEqual([1])
    expect(anytimeP([]).length).toBe(0)
    expect(() => anytimeP([0, Number.NaN])).toThrow(NegentropyError)
  })
})

describe('villeCrossing', () => {
  test('returns the first index with ln M ≥ ln(1/α), or −1', () => {
    const path = [0, 2, Math.log(20), 5, 1]
    expect(villeCrossing(path, 0.05)).toBe(2) // ln 20 reaches 1/0.05 exactly
    expect(villeCrossing(path, 0.001)).toBe(-1)
    expect(villeCrossing([], 0.05)).toBe(-1)
  })

  test('validates α and the path', () => {
    for (const alpha of [0, 1, -0.1, Number.NaN]) {
      expect(() => villeCrossing([0], alpha)).toThrow(NegentropyError)
    }
    expect(() => villeCrossing([Number.NaN], 0.05)).toThrow(NegentropyError)
  })
})
