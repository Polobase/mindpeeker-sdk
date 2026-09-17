import { describe, expect, test } from 'bun:test'
import { equationOfTime, julianDay, sunPosition, toSexagesimal } from '../src/index.js'
import fixture from './fixtures/sun.json' with { type: 'json' }

const wrap = (x: number): number => ((((x + 180) % 360) + 360) % 360) - 180

describe('sunPosition (Meeus ch. 25, low accuracy)', () => {
  test('Example 25.a: 1992 October 13.0 TD', () => {
    const jde = julianDay({ year: 1992, month: 10, day: 13 })
    expect(jde).toBe(2448908.5)
    const sun = sunPosition(jde)
    expect(sun.meanLongitude).toBeCloseTo(201.8072, 4)
    expect(sun.meanAnomaly).toBeCloseTo(278.99397, 5)
    expect(sun.trueLongitude).toBeCloseTo(199.90988, 4)
    expect(sun.distanceAu).toBeCloseTo(0.99766, 5)
    expect(sun.longitude).toBeCloseTo(199.90895, 4)
    expect(sun.obliquity).toBeCloseTo(23.43999, 5)
    const ra = toSexagesimal(sun.rightAscension / 15)
    expect([ra.whole, ra.minutes]).toEqual([13, 13])
    expect(ra.seconds).toBeCloseTo(31.4, 1)
    const dec = toSexagesimal(sun.declination)
    expect([dec.sign, dec.whole, dec.minutes]).toEqual([-1, 7, 47])
    expect(dec.seconds).toBeCloseTo(6, 0)
  })

  test('within 30″ in longitude and RA, 12″ in declination of astropy/ERFA, 1900–2100', () => {
    for (const c of fixture.cases) {
      const sun = sunPosition(c.jde)
      expect(Math.abs(wrap(sun.longitude - c.longitude)) * 3600).toBeLessThan(30)
      expect(Math.abs(wrap(sun.rightAscension - c.rightAscension)) * 3600).toBeLessThan(30)
      expect(Math.abs(sun.declination - c.declination) * 3600).toBeLessThan(12)
      expect(Math.abs(sun.distanceAu - c.distanceAu)).toBeLessThan(1e-4)
    }
  })
})

describe('equationOfTime (Meeus 28.3)', () => {
  test('Example 28.b: +0.0598256 rad = +13m42.7s on 1992 October 13.0 TD', () => {
    const minutes = equationOfTime(2448908.5)
    expect(((minutes / 4) * Math.PI) / 180).toBeCloseTo(0.0598256, 7)
    expect(minutes * 60).toBeCloseTo(13 * 60 + 42.7, 1)
  })

  test('within 3.5 s of GAST − apparent solar RA from ERFA, 1900–2100', () => {
    for (const c of fixture.cases) {
      expect(Math.abs(equationOfTime(c.jde) - c.equationOfTimeMinutes) * 60).toBeLessThan(3.5)
    }
  })

  test('annual range: about −14.2 min in February to +16.4 min in November', () => {
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (let jde = 2460676.5; jde < 2461041.5; jde += 0.25) {
      const e = equationOfTime(jde)
      min = Math.min(min, e)
      max = Math.max(max, e)
    }
    expect(min).toBeCloseTo(-14.2, 0)
    expect(max).toBeCloseTo(16.4, 0)
  })
})
