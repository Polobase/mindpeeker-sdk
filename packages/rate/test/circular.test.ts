import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ratePhases } from '../src/angle.js'
import { circularMean, circularVariance, resultantLength } from '../src/circular.js'
import { RateError } from '../src/errors.js'

interface CircularCase {
  phases: number[]
  circmean: number
  circvar: number
  resultant: number
}

const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures', 'circular.json'), 'utf8'),
) as { cases: CircularCase[] }

describe('directional statistics vs scipy fixtures', () => {
  for (const [i, c] of fixture.cases.entries()) {
    test(`case ${i}: resultant and variance match scipy`, () => {
      expect(resultantLength(c.phases)).toBeCloseTo(c.resultant, 12)
      expect(circularVariance(c.phases)).toBeCloseTo(c.circvar, 12)
    })

    test(`case ${i}: circular mean matches scipy when well-conditioned`, () => {
      // The mean direction is undefined near a vanishing resultant; only
      // compare it where scipy's own value is stable (R clearly nonzero).
      if (c.resultant > 1e-6) {
        expect(circularMean(c.phases)).toBeCloseTo(c.circmean, 10)
      }
    })
  }
})

describe('hand-computed circular statistics', () => {
  test('mean of [0, pi/2] is pi/4', () => {
    expect(circularMean([0, Math.PI / 2])).toBeCloseTo(Math.PI / 4, 14)
  })

  test('coincident angles give R = 1, variance 0', () => {
    expect(resultantLength([1.3, 1.3, 1.3])).toBeCloseTo(1, 14)
    expect(circularVariance([1.3, 1.3, 1.3])).toBeCloseTo(0, 14)
  })

  test('antipodal pair gives R = 0, variance 1', () => {
    expect(resultantLength([0, Math.PI])).toBeCloseTo(0, 14)
    expect(circularVariance([0, Math.PI])).toBeCloseTo(1, 14)
  })

  test('circular mean is returned in [0, 2pi)', () => {
    const mean = circularMean([(7 * Math.PI) / 4, (7 * Math.PI) / 4])
    expect(mean).toBeGreaterThanOrEqual(0)
    expect(mean).toBeLessThan(2 * Math.PI)
    expect(mean).toBeCloseTo((7 * Math.PI) / 4, 12)
  })

  test('empty input throws invalid_rate', () => {
    expect(() => resultantLength([])).toThrow(RateError)
    expect(() => circularMean([])).toThrow(RateError)
    expect(() => circularVariance([])).toThrow(RateError)
  })

  test('stays in [0, 2pi) at the wrap boundary (regression)', () => {
    const TAU = 2 * Math.PI
    // digits [1, 43] of base 44 are symmetric about angle 0; the true mean is
    // 0 but atan2 rounds to a tiny negative, which used to yield exactly TAU.
    for (const digits of [
      [1, 43],
      [2, 42],
      [5, 39],
    ]) {
      const mean = circularMean(ratePhases({ digits, base: 44 }))
      expect(mean).toBeGreaterThanOrEqual(0)
      expect(mean).toBeLessThan(TAU)
      expect(Math.floor((mean / TAU) * 44)).toBeLessThan(44)
    }
  })
})
