import { describe, expect, test } from 'bun:test'
import { digitToAngle } from '../src/angle.js'
import { convertBase, dialToBase44 } from '../src/dial.js'
import { RateError } from '../src/errors.js'
import { TAU } from '../src/types.js'

/** Half a target step is the tight upper bound on nearest-angle rounding. */
function bound(targetBase: number): number {
  return Math.PI / targetBase + 1e-12
}

describe('dialToBase44', () => {
  test('projects a base-10 De La Warr-style rate onto base 44', () => {
    const { rate, maxErrorRad } = dialToBase44([1, 1, 1, 4, 8])
    // targetDigit = round(d * 44 / 10) mod 44
    expect(rate).toEqual({ digits: [4, 4, 4, 18, 35], base: 44 })
    expect(maxErrorRad).toBeLessThanOrEqual(bound(44))
  })

  test('a base-10 digit landing exactly on a base-44 step has zero error', () => {
    // 5 * 44/10 = 22 exactly, so angle pi -> pi.
    const { rate, maxErrorRad } = dialToBase44([5])
    expect(rate.digits).toEqual([22])
    expect(maxErrorRad).toBeCloseTo(0, 15)
  })

  test('reported maxErrorRad equals the true max per-digit angular error', () => {
    const dial = [1, 4, 8]
    const { rate, maxErrorRad } = dialToBase44(dial)
    let expected = 0
    for (let i = 0; i < dial.length; i++) {
      const src = digitToAngle(dial[i] as number, 10)
      const tgt = digitToAngle(rate.digits[i] as number, 44)
      const d = tgt - src
      const wrapped = Math.abs(Math.atan2(Math.sin(d), Math.cos(d)))
      expected = Math.max(expected, wrapped)
    }
    expect(maxErrorRad).toBeCloseTo(expected, 15)
  })

  test('every base-10 digit stays within half a base-44 step', () => {
    for (let d = 0; d < 10; d++) {
      const { maxErrorRad } = dialToBase44([d])
      expect(maxErrorRad).toBeLessThanOrEqual(bound(44))
    }
  })

  test('rejects out-of-range dial digits', () => {
    expect(() => dialToBase44([10])).toThrow(RateError)
    expect(() => dialToBase44([-1])).toThrow(RateError)
    expect(() => dialToBase44([2.5])).toThrow(RateError)
  })

  test('custom fromBase / toBase', () => {
    const { rate } = dialToBase44([0, 5], { fromBase: 10, toBase: 10 })
    expect(rate).toEqual({ digits: [0, 5], base: 10 })
  })
})

describe('convertBase', () => {
  test('converting a rate to its own base is the identity with zero error', () => {
    const rate = { digits: [12, 33, 7], base: 44 }
    const { rate: out, maxErrorRad } = convertBase(rate, 44)
    expect(out).toEqual(rate)
    expect(maxErrorRad).toBe(0)
  })

  test('base 44 -> base 10 loses resolution but stays within half a base-10 step', () => {
    const { rate, maxErrorRad } = convertBase({ digits: [11, 22, 33], base: 44 }, 10)
    // round(11*10/44)=round(2.5)=3 (round-half-up), round(22*10/44)=5, round(33*10/44)=round(7.5)=8
    expect(rate.digits).toEqual([3, 5, 8])
    expect(maxErrorRad).toBeLessThanOrEqual(bound(10))
  })

  test('rejects an invalid target base', () => {
    expect(() => convertBase({ digits: [1], base: 44 }, 1)).toThrow(RateError)
  })

  test('bound holds across a wide sweep of source digits', () => {
    for (let d = 0; d < 44; d++) {
      const { maxErrorRad } = convertBase({ digits: [d], base: 44 }, 10)
      expect(maxErrorRad).toBeLessThanOrEqual(bound(10))
    }
    // sanity: a nonzero rate produces angles below a full turn
    expect(digitToAngle(43, 44)).toBeLessThan(TAU)
  })
})
