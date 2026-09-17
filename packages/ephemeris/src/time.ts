import { EphemerisError } from './errors.js'
import { assertFinite, assertJulianDay, J2000, JD_MAX, JD_MIN, mod } from './internal/math.js'
import type { CalendarDate, CalendarDateTime, CalendarOptions, CalendarSystem } from './types.js'

/** Julian day of the Unix epoch, 1970 January 1, 0h UTC. */
export const UNIX_EPOCH_JD = 2440587.5

const MS_PER_DAY = 86_400_000

/** First Julian day number (at noon) of the Gregorian calendar: 1582 October 15. */
const GREGORIAN_START_JDN = 2299161

const CALENDARS: readonly CalendarSystem[] = ['auto', 'gregorian', 'julian']

function resolveCalendar(opts: CalendarOptions | undefined): CalendarSystem {
  const calendar = opts?.calendar ?? 'auto'
  if (!CALENDARS.includes(calendar)) {
    throw new EphemerisError(
      'invalid_options',
      `calendar must be 'auto', 'gregorian' or 'julian', got ${String(calendar)}`,
    )
  }
  return calendar
}

function isLeapYear(year: number, gregorian: boolean): boolean {
  if (!gregorian) return mod(year, 4) === 0
  return (mod(year, 4) === 0 && mod(year, 100) !== 0) || mod(year, 400) === 0
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

function timeField(value: number | undefined, what: string, max: number, inclusive: boolean) {
  if (value === undefined) return 0
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    (inclusive ? value > max : value >= max)
  ) {
    throw new EphemerisError(
      'invalid_time',
      `${what} must be a finite number in [0, ${max}${inclusive ? ']' : ')'}, got ${String(value)}`,
    )
  }
  return value
}

/**
 * Julian day (JD) of a `Date` or a calendar date — Meeus, *Astronomical
 * Algorithms* (2nd ed. 1998), ch. 7:
 *
 * $\mathrm{JD} = \lfloor 365.25\,(Y + 4716) \rfloor + \lfloor 30.6001\,(M + 1) \rfloor + D + B - 1524.5$,
 *
 * with January and February counted as months 13 and 14 of the previous
 * year, $B = 0$ in the Julian calendar and $B = 2 - A + \lfloor A/4 \rfloor$,
 * $A = \lfloor Y/100 \rfloor$ in the Gregorian calendar.
 *
 * A `Date` is converted exactly as $\mathrm{JD} = t_\mathrm{ms} / 86\,400\,000 + 2\,440\,587.5$
 * (a `Date` is proleptic Gregorian UTC). The result is on whatever time scale
 * the input is: a UTC clock reading gives a UTC Julian day, which the sidereal
 * functions treat as UT1 ($|\mathrm{UT1} - \mathrm{UTC}| < 0.9$ s). Use
 * {@link julianEphemerisDay} to move to TT for the Sun and Moon.
 *
 * @throws {EphemerisError} `invalid_time` for an invalid `Date`, a malformed
 *   or nonexistent calendar date (e.g. February 30, or 1582 October 5–14 under
 *   `'auto'`), or a result outside $0 \le \mathrm{JD} \le 10^7$;
 *   `invalid_options` for an unknown calendar.
 */
export function julianDay(input: Date | CalendarDate, opts?: CalendarOptions): number {
  const calendar = resolveCalendar(opts)
  if (input instanceof Date) {
    const ms = input.getTime()
    if (!Number.isFinite(ms)) throw new EphemerisError('invalid_time', 'Date is invalid')
    const jd = ms / MS_PER_DAY + UNIX_EPOCH_JD
    assertJulianDay(jd, 'Julian day of the Date')
    return jd
  }
  if (input === null || typeof input !== 'object') {
    throw new EphemerisError('invalid_time', 'expected a Date or a { year, month, day } object')
  }
  const { year, month, day } = input
  if (typeof year !== 'number' || !Number.isSafeInteger(year)) {
    throw new EphemerisError('invalid_time', `year must be an integer, got ${String(year)}`)
  }
  if (typeof month !== 'number' || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new EphemerisError('invalid_time', `month must be an integer 1–12, got ${String(month)}`)
  }
  if (typeof day !== 'number' || !Number.isFinite(day) || day < 1) {
    throw new EphemerisError('invalid_time', `day must be a finite number ≥ 1, got ${String(day)}`)
  }
  const hour = timeField(input.hour, 'hour', 24, true)
  const minute = timeField(input.minute, 'minute', 60, false)
  const second = timeField(input.second, 'second', 61, false)

  const dayOfMonth = Math.floor(day)
  const onOrAfterSwitch =
    year > 1582 || (year === 1582 && (month > 10 || (month === 10 && dayOfMonth >= 15)))
  if (calendar === 'auto' && year === 1582 && month === 10 && dayOfMonth >= 5 && dayOfMonth <= 14) {
    throw new EphemerisError(
      'invalid_time',
      `1582 October ${dayOfMonth} does not exist in the historical calendar (use calendar 'gregorian' or 'julian')`,
    )
  }
  const gregorian = calendar === 'gregorian' || (calendar === 'auto' && onOrAfterSwitch)
  const monthDays =
    month === 2 && isLeapYear(year, gregorian) ? 29 : (MONTH_DAYS[month - 1] as number)
  if (dayOfMonth > monthDays) {
    throw new EphemerisError(
      'invalid_time',
      `day ${day} is beyond the ${monthDays} days of month ${month} in year ${year}`,
    )
  }

  let y = year
  let m = month
  if (m <= 2) {
    y -= 1
    m += 12
  }
  let b = 0
  if (gregorian) {
    const a = Math.floor(y / 100)
    b = 2 - a + Math.floor(a / 4)
  }
  const dayWithTime = day + (hour + (minute + second / 60) / 60) / 24
  const jd =
    Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + dayWithTime + b - 1524.5
  assertJulianDay(jd, 'Julian day of the calendar date')
  return jd
}

/**
 * Calendar date and time of a Julian day — the inverse algorithm of Meeus
 * ch. 7 (valid for $\mathrm{JD} \ge 0$). Seconds are rounded to 0.1 ms, just
 * above the ≈ 40 µs resolution of a double-precision Julian day; a rounding
 * carry rolls over into the next day.
 *
 * @throws {EphemerisError} `invalid_time` outside $0 \le \mathrm{JD} \le 10^7$;
 *   `invalid_options` for an unknown calendar.
 */
export function dateFromJulianDay(jd: number, opts?: CalendarOptions): CalendarDateTime {
  const calendar = resolveCalendar(opts)
  assertJulianDay(jd)
  let z = Math.floor(jd + 0.5)
  let tenthMs = Math.round((jd + 0.5 - z) * 864_000_000)
  if (tenthMs >= 864_000_000) {
    z += 1
    tenthMs -= 864_000_000
  }
  const gregorian = calendar === 'gregorian' || (calendar === 'auto' && z >= GREGORIAN_START_JDN)
  let a = z
  if (gregorian) {
    const alpha = Math.floor((z - 1867216.25) / 36524.25)
    a = z + 1 + alpha - Math.floor(alpha / 4)
  }
  const b = a + 1524
  const c = Math.floor((b - 122.1) / 365.25)
  const d = Math.floor(365.25 * c)
  const e = Math.floor((b - d) / 30.6001)
  const day = b - d - Math.floor(30.6001 * e)
  const month = e < 14 ? e - 1 : e - 13
  const year = month > 2 ? c - 4716 : c - 4715
  const hour = Math.floor(tenthMs / 36_000_000)
  const minute = Math.floor((tenthMs - hour * 36_000_000) / 600_000)
  const second = (tenthMs - hour * 36_000_000 - minute * 600_000) / 10_000
  return { year, month, day, hour, minute, second, calendar: gregorian ? 'gregorian' : 'julian' }
}

/**
 * The `Date` (proleptic Gregorian UTC) of a Julian day, rounded to the
 * millisecond: $t_\mathrm{ms} = (\mathrm{JD} - 2\,440\,587.5) \cdot 86\,400\,000$.
 *
 * @throws {EphemerisError} `invalid_time` outside $0 \le \mathrm{JD} \le 10^7$.
 */
export function julianDayToDate(jd: number): Date {
  assertJulianDay(jd)
  return new Date(Math.round((jd - UNIX_EPOCH_JD) * MS_PER_DAY))
}

/**
 * Julian centuries since J2000.0: $T = (\mathrm{JD} - 2\,451\,545.0) / 36\,525$
 * (Meeus 12.1). Pass a JDE for the TT-based series.
 *
 * @throws {EphemerisError} `invalid_time` outside the Julian-day domain.
 */
export function julianCenturies(jd: number): number {
  assertJulianDay(jd)
  return (jd - J2000) / 36525
}

/**
 * Decimal year of a Julian day on the Julian-year scale used by ΔT:
 * $y = 2000 + (\mathrm{JD} - 2\,451\,545.0) / 365.25$ (continuous, so
 * ΔT has no month steps).
 *
 * @throws {EphemerisError} `invalid_time` outside the Julian-day domain.
 */
export function decimalYear(jd: number): number {
  assertJulianDay(jd)
  return 2000 + (jd - J2000) / 365.25
}

/**
 * ΔT = TT − UT in seconds for a decimal year — the Espenak & Meeus (2006)
 * polynomials published with NASA's *Five Millennium Canon of Solar
 * Eclipses* (eclipse.gsfc.nasa.gov/SEhelp/deltatpoly2004.html), piecewise
 * from before −500 to after 2150. The lunar-acceleration correction
 * $-0.000012932\,(y - 1955)^2$ is **not** applied (it only matters when
 * pairing ΔT with a lunar ephemeris using $\dot n = -26''/\mathrm{cy}^2$).
 *
 * Accuracy: a model, not a measurement. Within ≈ 1 s of the observed IERS
 * values for 1962–2005 (see the test fixture), but the 2005–2050 branch is a
 * 2004 extrapolation that runs ahead of the observed ΔT (IERS: 69.1 s in
 * 2025; this polynomial: 74.5 s). Historical uncertainty grows to minutes
 * before 1600 and hours before −500.
 *
 * @throws {EphemerisError} `invalid_input` for a non-finite year.
 */
export function deltaT(year: number): number {
  assertFinite(year, 'year')
  const y = year
  if (y < -500) {
    const u = (y - 1820) / 100
    return -20 + 32 * u * u
  }
  if (y < 500) {
    const u = y / 100
    return (
      10583.6 +
      u *
        (-1014.41 +
          u *
            (33.78311 + u * (-5.952053 + u * (-0.1798452 + u * (0.022174192 + u * 0.0090316521)))))
    )
  }
  if (y < 1600) {
    const u = (y - 1000) / 100
    return (
      1574.2 +
      u *
        (-556.01 +
          u *
            (71.23472 + u * (0.319781 + u * (-0.8503463 + u * (-0.005050998 + u * 0.0083572073)))))
    )
  }
  if (y < 1700) {
    const t = y - 1600
    return 120 - 0.9808 * t - 0.01532 * t * t + (t * t * t) / 7129
  }
  if (y < 1800) {
    const t = y - 1700
    return 8.83 + t * (0.1603 + t * (-0.0059285 + t * 0.00013336)) - t ** 4 / 1174000
  }
  if (y < 1860) {
    const t = y - 1800
    return (
      13.72 +
      t *
        (-0.332447 +
          t *
            (0.0068612 +
              t *
                (0.0041116 +
                  t *
                    (-0.00037436 + t * (0.0000121272 + t * (-0.0000001699 + t * 0.000000000875))))))
    )
  }
  if (y < 1900) {
    const t = y - 1860
    return (
      7.62 + t * (0.5737 + t * (-0.251754 + t * (0.01680668 + t * -0.0004473624))) + t ** 5 / 233174
    )
  }
  if (y < 1920) {
    const t = y - 1900
    return -2.79 + t * (1.494119 + t * (-0.0598939 + t * (0.0061966 + t * -0.000197)))
  }
  if (y < 1941) {
    const t = y - 1920
    return 21.2 + t * (0.84493 + t * (-0.0761 + t * 0.0020936))
  }
  if (y < 1961) {
    const t = y - 1950
    return 29.07 + 0.407 * t - (t * t) / 233 + (t * t * t) / 2547
  }
  if (y < 1986) {
    const t = y - 1975
    return 45.45 + 1.067 * t - (t * t) / 260 - (t * t * t) / 718
  }
  if (y < 2005) {
    const t = y - 2000
    return (
      63.86 +
      t * (0.3345 + t * (-0.060374 + t * (0.0017275 + t * (0.000651814 + t * 0.00002373599))))
    )
  }
  if (y < 2050) {
    const t = y - 2000
    return 62.92 + 0.32217 * t + 0.005589 * t * t
  }
  if (y < 2150) {
    const u = (y - 1820) / 100
    return -20 + 32 * u * u - 0.5628 * (2150 - y)
  }
  const u = (y - 1820) / 100
  return -20 + 32 * u * u
}

function resolveDeltaT(jd: number, deltaTSeconds: number | undefined): number {
  if (deltaTSeconds === undefined) return deltaT(2000 + (jd - J2000) / 365.25)
  assertFinite(deltaTSeconds, 'deltaTSeconds')
  return deltaTSeconds
}

/**
 * Julian Ephemeris Day (TT) from a Julian day in UT:
 * $\mathrm{JDE} = \mathrm{JD} + \Delta T / 86\,400$, with ΔT from
 * {@link deltaT} unless you pass the value you trust (e.g. an IERS number).
 *
 * @throws {EphemerisError} `invalid_time` outside the Julian-day domain;
 *   `invalid_input` for a non-finite `deltaTSeconds`.
 */
export function julianEphemerisDay(jd: number, deltaTSeconds?: number): number {
  assertJulianDay(jd)
  const jde = jd + resolveDeltaT(jd, deltaTSeconds) / 86400
  assertJulianDay(jde, 'Julian Ephemeris Day')
  return jde
}

/**
 * Julian day in UT from a Julian Ephemeris Day (TT):
 * $\mathrm{JD} = \mathrm{JDE} - \Delta T / 86\,400$ — the inverse of
 * {@link julianEphemerisDay} (ΔT is evaluated at the JDE; it changes by
 * microseconds across ΔT itself).
 *
 * @throws {EphemerisError} `invalid_time` outside the Julian-day domain;
 *   `invalid_input` for a non-finite `deltaTSeconds`.
 */
export function universalJulianDay(jde: number, deltaTSeconds?: number): number {
  assertJulianDay(jde, 'Julian Ephemeris Day')
  const jd = jde - resolveDeltaT(jde, deltaTSeconds) / 86400
  if (jd < JD_MIN || jd > JD_MAX) {
    throw new EphemerisError(
      'invalid_time',
      `UT Julian day ${jd} is outside [${JD_MIN}, ${JD_MAX}]`,
    )
  }
  return jd
}
