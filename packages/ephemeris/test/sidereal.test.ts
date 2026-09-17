import { describe, expect, test } from 'bun:test'
import {
  EphemerisError,
  equationOfTheEquinoxes,
  gast,
  gmst,
  julianDay,
  localMeanSolarTime,
  lst,
  normalizeDegrees,
  normalizeHours,
  toSexagesimal,
} from '../src/index.js'
import fixture from './fixtures/sidereal.json' with { type: 'json' }

const wrapHours = (x: number): number => ((((x + 12) % 24) + 24) % 24) - 12

function hms(hours: number): number {
  const { whole, minutes, seconds } = toSexagesimal(hours)
  return whole * 3600 + minutes * 60 + seconds
}

describe('sidereal time (Meeus ch. 12, USNO)', () => {
  test('Example 12.a: 1987 April 10, 0h UT', () => {
    const s = toSexagesimal(gmst(2446895.5))
    expect([s.whole, s.minutes]).toEqual([13, 10])
    expect(s.seconds).toBeCloseTo(46.3668, 4)
    // Meeus prints 46.1351s with the full IAU 1980 nutation; the USNO short series is 0.02 s away.
    expect(hms(gast(2446895.5)) - (13 * 3600 + 10 * 60 + 46.1351)).toBeCloseTo(0, 1)
  })

  test('Example 12.b: 1987 April 10, 19h21m00s UT', () => {
    const jd = julianDay({ year: 1987, month: 4, day: 10, hour: 19, minute: 21 })
    const s = toSexagesimal(gmst(jd))
    expect([s.whole, s.minutes]).toEqual([8, 34])
    expect(s.seconds).toBeCloseTo(57.0896, 3)
  })

  test('GMST equals ERFA gmst82 to < 0.1 ms over 1800–2200', () => {
    for (const c of fixture.cases) {
      expect(Math.abs(wrapHours(gmst(c.jd) - c.gmstHours)) * 3600).toBeLessThan(1e-4)
    }
  })

  test('GAST is within 0.04 s of ERFA gst94 (full nutation) over 1800–2200', () => {
    for (const c of fixture.cases) {
      expect(Math.abs(wrapHours(gast(c.jd) - c.gastHours)) * 3600).toBeLessThan(0.04)
    }
  })

  test('the equation of the equinoxes stays within ±1.2 s', () => {
    for (let jd = 2415020.5; jd < 2488069.5; jd += 97.3) {
      expect(Math.abs(equationOfTheEquinoxes(jd) * 3600)).toBeLessThan(1.2)
    }
  })

  test('a mean sidereal day is 23h56m04.0905s of UT', () => {
    const siderealDay = 1 / 1.00273790935
    const start = 2460000.3
    expect(wrapHours(gmst(start + siderealDay) - gmst(start)) * 3600).toBeCloseTo(0, 2)
    expect((1 - siderealDay) * 86400).toBeCloseTo(235.9095, 3)
  })

  test('LST adds east longitude; apparent mode adds the equation of the equinoxes', () => {
    const jd = 2446895.5
    expect(lst(jd, 0)).toBeCloseTo(gmst(jd), 12)
    expect(lst(jd, 15)).toBeCloseTo(normalizeHours(gmst(jd) + 1), 12)
    expect(lst(jd, -77.0365)).toBeCloseTo(normalizeHours(gmst(jd) - 77.0365 / 15), 12)
    expect(lst(jd, 360 + 15)).toBeCloseTo(lst(jd, 15), 12)
    expect(lst(jd, 10, { sidereal: 'apparent' })).toBeCloseTo(
      normalizeHours(gast(jd) + 10 / 15),
      12,
    )
  })

  test('13.47 h of LST is right ascension 202.05°', () => {
    expect(13.47 * 15).toBeCloseTo(202.05, 10)
  })

  test('local mean solar time is UT plus east longitude', () => {
    expect(localMeanSolarTime(2451545.0, 0)).toBe(12)
    expect(localMeanSolarTime(2451545.25, -90)).toBeCloseTo(12, 10)
    expect(localMeanSolarTime(2451544.5, -15)).toBeCloseTo(23, 10)
  })

  test('validation', () => {
    const codeOf = (run: () => unknown) => {
      try {
        run()
      } catch (error) {
        return (error as EphemerisError).code
      }
      return undefined
    }
    expect(codeOf(() => gmst(Number.POSITIVE_INFINITY))).toBe('invalid_time')
    expect(codeOf(() => lst(2451545, Number.NaN))).toBe('invalid_input')
    expect(codeOf(() => lst(2451545, 0, { sidereal: 'true' as 'mean' }))).toBe('invalid_options')
    expect(codeOf(() => localMeanSolarTime(1.7e12, 0))).toBe('invalid_time')
  })
})

describe('angle helpers', () => {
  test('normalize and split', () => {
    expect(normalizeDegrees(-30)).toBe(330)
    expect(normalizeDegrees(720)).toBe(0)
    expect(normalizeHours(-1e-17)).toBe(0)
    expect(toSexagesimal(-7.785069796)).toMatchObject({ sign: -1, whole: 7, minutes: 47 })
    expect(toSexagesimal(-7.785069796).seconds).toBeCloseTo(6.2513, 4)
    expect(() => toSexagesimal(Number.NaN)).toThrow(EphemerisError)
  })
})

describe('toSexagesimal edge', () => {
  test('seconds stay below 60 just under a whole unit', () => {
    const s = toSexagesimal(1 - Number.EPSILON / 2)
    expect(s.whole).toBe(0)
    expect(s.minutes).toBe(59)
    expect(s.seconds).toBeLessThan(60)
  })
})
