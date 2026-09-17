import { describe, expect, test } from 'bun:test'
import {
  dateFromJulianDay,
  decimalYear,
  deltaT,
  EphemerisError,
  julianCenturies,
  julianDay,
  julianDayToDate,
  julianEphemerisDay,
  UNIX_EPOCH_JD,
  universalJulianDay,
} from '../src/index.js'
import deltaTFixture from './fixtures/delta-t.json' with { type: 'json' }
import julianFixture from './fixtures/julian.json' with { type: 'json' }

function code(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error) {
    if (error instanceof EphemerisError) return error.code
    throw error
  }
  return undefined
}

// Meeus, Astronomical Algorithms (1998) ch. 7: the table on p. 62 and Examples
// 7.a–7.c (each value re-derived with convertdate before it was pinned here).
const MEEUS_TABLE: [number, number, number, number][] = [
  [2000, 1, 1.5, 2451545.0],
  [1999, 1, 1.0, 2451179.5],
  [1987, 1, 27.0, 2446822.5],
  [1987, 6, 19.5, 2446966.0],
  [1988, 1, 27.0, 2447187.5],
  [1988, 6, 19.5, 2447332.0],
  [1900, 1, 1.0, 2415020.5],
  [1600, 1, 1.0, 2305447.5],
  [1600, 12, 31.0, 2305812.5],
  [837, 4, 10.3, 2026871.8],
  [-123, 12, 31.0, 1676496.5],
  [-122, 1, 1.0, 1676497.5],
  [-1000, 7, 12.5, 1356001.0],
  [-1000, 2, 29.0, 1355866.5],
  [-1001, 8, 17.9, 1355671.4],
  [-4712, 1, 1.5, 0.0],
  [1957, 10, 4.81, 2436116.31],
  [333, 1, 27.5, 1842713.0],
  [-584, 5, 28.63, 1507900.13],
]

describe('julianDay (Meeus ch. 7)', () => {
  test('reproduces the Meeus table and Examples 7.a–7.c with the historical calendar', () => {
    for (const [year, month, day, jd] of MEEUS_TABLE) {
      expect(julianDay({ year, month, day })).toBeCloseTo(jd, 8)
    }
  })

  test('the Gregorian reform: 1582 October 4 (Julian) is followed by October 15', () => {
    expect(julianDay({ year: 1582, month: 10, day: 4 })).toBe(2299159.5)
    expect(julianDay({ year: 1582, month: 10, day: 15 })).toBe(2299160.5)
    expect(code(() => julianDay({ year: 1582, month: 10, day: 10 }))).toBe('invalid_time')
    expect(julianDay({ year: 1582, month: 10, day: 10 }, { calendar: 'gregorian' })).toBe(2299155.5)
    expect(julianDay({ year: 1582, month: 10, day: 10 }, { calendar: 'julian' })).toBe(2299165.5)
  })

  test('matches convertdate / ERFA cal2jd on 150 random proleptic dates', () => {
    for (const c of julianFixture.cases) {
      const calendar = c.calendar as 'julian' | 'gregorian'
      const jd = julianDay({ year: c.year, month: c.month, day: c.day }, { calendar })
      expect(Math.abs(jd - c.jd)).toBeLessThan(1e-8)
    }
  })

  test('time-of-day fields add to the day', () => {
    const jd = julianDay({ year: 1987, month: 4, day: 10, hour: 19, minute: 21, second: 0 })
    expect(jd).toBeCloseTo(2446896.30625, 9)
  })

  test('a Date converts exactly through the Unix epoch', () => {
    expect(julianDay(new Date(0))).toBe(UNIX_EPOCH_JD)
    expect(julianDay(new Date('2000-01-01T12:00:00Z'))).toBe(2451545)
    expect(julianDayToDate(2451545).toISOString()).toBe('2000-01-01T12:00:00.000Z')
    const date = new Date('2026-09-17T08:15:42.123Z')
    expect(julianDayToDate(julianDay(date)).getTime()).toBe(date.getTime())
  })

  test('rejects malformed and nonexistent dates', () => {
    expect(code(() => julianDay({ year: 2023, month: 2, day: 29 }))).toBe('invalid_time')
    expect(julianDay({ year: 2024, month: 2, day: 29 })).toBe(2460369.5)
    expect(code(() => julianDay({ year: 1900, month: 2, day: 29 }))).toBe('invalid_time')
    // 1500 is a leap year in the Julian calendar, which 'auto' uses before 1582
    expect(julianDay({ year: 1500, month: 2, day: 29 })).toBe(
      julianDay({ year: 1500, month: 3, day: 1 }) - 1,
    )
    expect(code(() => julianDay({ year: 2000, month: 13, day: 1 }))).toBe('invalid_time')
    expect(code(() => julianDay({ year: 2000.5, month: 1, day: 1 }))).toBe('invalid_time')
    expect(code(() => julianDay({ year: 2000, month: 1, day: 0.5 }))).toBe('invalid_time')
    expect(code(() => julianDay({ year: 2000, month: 1, day: 1, hour: 25 }))).toBe('invalid_time')
    expect(code(() => julianDay({ year: 2000, month: 1, day: 1, minute: 60 }))).toBe('invalid_time')
    expect(code(() => julianDay({ year: -5000, month: 1, day: 1 }))).toBe('invalid_time')
    expect(code(() => julianDay(new Date(Number.NaN)))).toBe('invalid_time')
    expect(
      code(() =>
        julianDay({ year: 2000, month: 1, day: 1 }, { calendar: 'hebrew' as unknown as 'julian' }),
      ),
    ).toBe('invalid_options')
  })
})

describe('dateFromJulianDay (Meeus ch. 7 inverse)', () => {
  test('Examples 7.c and the table entries round-trip', () => {
    expect(dateFromJulianDay(2436116.31)).toEqual({
      year: 1957,
      month: 10,
      day: 4,
      hour: 19,
      minute: 26,
      second: 24,
      calendar: 'gregorian',
    })
    expect(dateFromJulianDay(1842713.0)).toMatchObject({ year: 333, month: 1, day: 27, hour: 12 })
    expect(dateFromJulianDay(1507900.13)).toMatchObject({
      year: -584,
      month: 5,
      day: 28,
      hour: 15,
      minute: 7,
      calendar: 'julian',
    })
    for (const [year, month, day, jd] of MEEUS_TABLE) {
      const d = dateFromJulianDay(jd)
      expect([d.year, d.month, d.day]).toEqual([year, month, Math.floor(day)])
      const fraction = (d.hour + (d.minute + d.second / 60) / 60) / 24
      expect(fraction).toBeCloseTo(day - Math.floor(day), 8)
    }
  })

  test('inverts the convertdate fixture in the requested calendar', () => {
    for (const c of julianFixture.cases) {
      const d = dateFromJulianDay(c.jd, { calendar: c.calendar as 'julian' | 'gregorian' })
      expect([d.year, d.month, d.day]).toEqual([c.year, c.month, Math.floor(c.day)])
    }
  })

  test('a rounding carry rolls into the next day', () => {
    const d = dateFromJulianDay(2451544.5 - 2 ** -31) // the double just below midnight
    expect(d).toMatchObject({ year: 2000, month: 1, day: 1, hour: 0, minute: 0, second: 0 })
  })

  test('rejects Julian days outside [0, 1e7] and hints at Unix time', () => {
    expect(code(() => dateFromJulianDay(-1))).toBe('invalid_time')
    try {
      dateFromJulianDay(Date.UTC(2026, 0, 1))
    } catch (error) {
      expect((error as Error).message).toContain('pass a Date for Unix time')
    }
  })
})

describe('ΔT and time scales', () => {
  test('Espenak–Meeus polynomials: branch anchors', () => {
    expect(deltaT(1900)).toBeCloseTo(-2.79, 10)
    expect(deltaT(1950)).toBeCloseTo(29.07, 10)
    expect(deltaT(1975)).toBeCloseTo(45.45, 10)
    expect(deltaT(2000)).toBeCloseTo(63.86, 10)
    expect(deltaT(1820)).toBeCloseTo(12.1, 0) // smooth through 1800–1860
    expect(deltaT(-1000)).toBeCloseTo(-20 + 32 * ((-1000 - 1820) / 100) ** 2, 8)
    expect(deltaT(3000)).toBeCloseTo(-20 + 32 * ((3000 - 1820) / 100) ** 2, 8)
  })

  test('within 1 s of the observed IERS ΔT for 1962–2005', () => {
    for (const c of deltaTFixture.cases.filter((c) => c.year < 2005)) {
      expect(Math.abs(deltaT(c.year) - c.deltaT)).toBeLessThan(1)
    }
  })

  test('the 2005–2050 extrapolation overshoots the observed ΔT (documented)', () => {
    const observed2025 = deltaTFixture.cases.find((c) => c.year === 2025)?.deltaT as number
    expect(observed2025).toBeCloseTo(69.1, 0)
    expect(deltaT(2025) - observed2025).toBeGreaterThan(5)
  })

  test('JD ↔ JDE round-trip and explicit ΔT', () => {
    const jd = 2460935.25
    const jde = julianEphemerisDay(jd)
    expect((jde - jd) * 86400).toBeCloseTo(deltaT(decimalYear(jd)), 3) // JD resolution ≈ 40 µs
    expect(universalJulianDay(jde)).toBeCloseTo(jd, 9)
    expect(julianEphemerisDay(jd, 69.2)).toBe(jd + 69.2 / 86400)
    expect(universalJulianDay(jd + 69.2 / 86400, 69.2)).toBeCloseTo(jd, 10)
    expect(code(() => julianEphemerisDay(jd, Number.NaN))).toBe('invalid_input')
  })

  test('Julian centuries and decimal year', () => {
    expect(julianCenturies(2451545)).toBe(0)
    expect(julianCenturies(2446895.5)).toBeCloseTo(-0.127296372348, 11)
    expect(decimalYear(2451545)).toBe(2000)
  })
})
