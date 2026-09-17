import { EphemerisError } from './errors.js'
import { assertFinite, assertJulianDay, cosd, J2000, mod, sind } from './internal/math.js'

/** Options for {@link lst}. */
export interface LstOptions {
  /**
   * `'mean'` (default) adds the longitude to {@link gmst};
   * `'apparent'` adds it to {@link gast}. They differ
   * by the equation of the equinoxes, at most ≈ 1.1 s.
   */
  readonly sidereal?: 'mean' | 'apparent'
}

/**
 * Greenwich mean sidereal time in hours $[0, 24)$ — the IAU 1982 expression in
 * the form of Meeus eq. 12.4:
 *
 * $\theta_0 = 280.46061837° + 360.98564736629°\,(\mathrm{JD} - 2451545.0) + 0.000387933°\,T^2 - T^3/38\,710\,000$,
 *
 * divided by 15. The argument is UT1; a UTC Julian day is within 0.9 s.
 * Meeus Example 12.a: 1987 April 10, 0h UT → 13h10m46.3668s.
 *
 * @param jd Julian day (UT).
 * @throws {EphemerisError} `invalid_time` outside the Julian-day domain.
 */
export function gmst(jd: number): number {
  assertJulianDay(jd)
  const d = jd - J2000
  const t = d / 36525
  const degrees = 280.46061837 + 360.98564736629 * d + t * t * (0.000387933 - t / 38710000)
  return mod(degrees, 360) / 15
}

/**
 * The equation of the equinoxes $\Delta\psi\cos\varepsilon$ in hours (of
 * time), with the U.S. Naval Observatory's short series
 * (aa.usno.navy.mil/faq/GAST):
 *
 * $\Delta\psi \approx -0.000319^\mathrm{h}\sin\Omega - 0.000024^\mathrm{h}\sin 2L$,
 * $\Omega = 125.04° - 0.052954°\,D$, $L = 280.47° + 0.98565°\,D$,
 * $\varepsilon = 23.4393° - 0.0000004°\,D$, $D = \mathrm{JD} - 2451545.0$.
 *
 * Its magnitude never exceeds ≈ 1.1 s. USNO takes $D$ in TT; using the UT
 * day moves $\Omega$ by less than 0.0001°, which is invisible here.
 *
 * @param jd Julian day (UT).
 * @throws {EphemerisError} `invalid_time` outside the Julian-day domain.
 */
export function equationOfTheEquinoxes(jd: number): number {
  assertJulianDay(jd)
  const d = jd - J2000
  const omega = 125.04 - 0.052954 * d
  const l = 280.47 + 0.98565 * d
  const epsilon = 23.4393 - 0.0000004 * d
  const dPsiHours = -0.000319 * sind(omega) - 0.000024 * sind(2 * l)
  return dPsiHours * cosd(epsilon)
}

/**
 * Greenwich apparent sidereal time in hours $[0, 24)$:
 * $\mathrm{GAST} = \mathrm{GMST} + \mathrm{eqeq}$ with
 * {@link gmst} and the USNO
 * {@link equationOfTheEquinoxes}. Against ERFA `gst94` (full IAU 1980
 * nutation) the largest difference over 300 instants in 1800–2200 is 0.036 s
 * (test fixture). Meeus Example 12.a (full nutation) prints 13h10m46.1351s;
 * the USNO series gives 46.115s.
 *
 * @param jd Julian day (UT).
 * @throws {EphemerisError} `invalid_time` outside the Julian-day domain.
 */
export function gast(jd: number): number {
  return mod(gmst(jd) + equationOfTheEquinoxes(jd), 24)
}

/**
 * Local sidereal time in hours $[0, 24)$: the right ascension on the
 * observer's meridian, $\mathrm{LST} = \mathrm{GMST} + \lambda_\mathrm{east}/15$
 * (or GAST with `sidereal: 'apparent'`). Longitude is **east-positive**
 * (Meeus uses west-positive; negate his values).
 *
 * @param jd Julian day (UT).
 * @param longitudeEastDeg Geographic longitude in degrees, east positive.
 * @throws {EphemerisError} `invalid_time` outside the Julian-day domain;
 *   `invalid_input` for a non-finite longitude; `invalid_options` for an
 *   unknown `sidereal` mode.
 */
export function lst(jd: number, longitudeEastDeg: number, opts: LstOptions = {}): number {
  assertFinite(longitudeEastDeg, 'longitudeEastDeg')
  const mode = opts.sidereal ?? 'mean'
  if (mode !== 'mean' && mode !== 'apparent') {
    throw new EphemerisError(
      'invalid_options',
      `sidereal must be 'mean' or 'apparent', got ${String(mode)}`,
    )
  }
  const greenwich = mode === 'mean' ? gmst(jd) : gast(jd)
  return mod(greenwich + longitudeEastDeg / 15, 24)
}

/**
 * Local mean solar time in hours $[0, 24)$: $\mathrm{UT} + \lambda_\mathrm{east}/15$
 * — clock time at the meridian, without zones or daylight saving. Useful as a
 * stratum when separating a sidereal effect from a time-of-day effect (LST is
 * local solar time plus a term that advances ≈ 3m56s per day through the year).
 *
 * @param jd Julian day (UT).
 * @param longitudeEastDeg Geographic longitude in degrees, east positive.
 * @throws {EphemerisError} `invalid_time` outside the Julian-day domain;
 *   `invalid_input` for a non-finite longitude.
 */
export function localMeanSolarTime(jd: number, longitudeEastDeg: number): number {
  assertJulianDay(jd)
  assertFinite(longitudeEastDeg, 'longitudeEastDeg')
  const utHours = (jd + 0.5 - Math.floor(jd + 0.5)) * 24
  return mod(utHours + longitudeEastDeg / 15, 24)
}
