import { describe, expect, test } from 'bun:test'
import {
  degreesToRadians,
  digitToAngle,
  digitToDegrees,
  radiansToDegrees,
  ratePhases,
} from '../src/angle.js'
import { RateError } from '../src/errors.js'
import { TAU } from '../src/types.js'

describe('digitToAngle', () => {
  test('digit 0 maps to angle 0 in any base', () => {
    expect(digitToAngle(0, 44)).toBe(0)
    expect(digitToAngle(0, 10)).toBe(0)
  })

  test('digit 11 in base 44 lands exactly on pi/2', () => {
    expect(digitToAngle(11, 44)).toBeCloseTo(Math.PI / 2, 15)
    expect(digitToAngle(11, 44)).toBe((11 * TAU) / 44)
  })

  test('digit 22 in base 44 lands on pi', () => {
    expect(digitToAngle(22, 44)).toBeCloseTo(Math.PI, 15)
  })

  test('top edge digit 43 in base 44 is just under a full turn', () => {
    expect(digitToAngle(43, 44)).toBeCloseTo((43 * TAU) / 44, 15)
    expect(digitToAngle(43, 44)).toBeLessThan(TAU)
  })

  test('rejects out-of-range digits', () => {
    expect(() => digitToAngle(44, 44)).toThrow(RateError)
    expect(() => digitToAngle(-1, 44)).toThrow(RateError)
    expect(() => digitToAngle(1.5, 44)).toThrow(RateError)
  })

  test('rejects invalid bases', () => {
    expect(() => digitToAngle(0, 1)).toThrow(RateError)
    expect(() => digitToAngle(0, 3.5)).toThrow(RateError)
    try {
      digitToAngle(0, 1)
    } catch (err) {
      expect((err as RateError).code).toBe('invalid_base')
    }
  })
})

describe('digitToDegrees', () => {
  test('digit 11 in base 44 is exactly 90 degrees', () => {
    expect(digitToDegrees(11, 44)).toBeCloseTo(90, 12)
  })

  test('the base-44 step is 360/44 degrees', () => {
    expect(digitToDegrees(1, 44)).toBeCloseTo(360 / 44, 12)
  })
})

describe('radian/degree helpers round-trip', () => {
  test('deg -> rad -> deg', () => {
    for (const deg of [0, 8.1818, 45, 90, 180, 359]) {
      expect(radiansToDegrees(degreesToRadians(deg))).toBeCloseTo(deg, 12)
    }
  })
})

describe('ratePhases', () => {
  test('produces one phase per digit', () => {
    const phases = ratePhases({ digits: [12, 33, 7], base: 44 })
    expect(phases.length).toBe(3)
    expect(phases[0]).toBeCloseTo((12 * TAU) / 44, 15)
    expect(phases[1]).toBeCloseTo((33 * TAU) / 44, 15)
    expect(phases[2]).toBeCloseTo((7 * TAU) / 44, 15)
  })

  test('empty rate gives empty phase vector', () => {
    expect(ratePhases({ digits: [], base: 44 }).length).toBe(0)
  })
})
