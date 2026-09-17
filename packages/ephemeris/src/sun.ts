import { eclipticToEquatorial } from './internal/coords.js'
import { assertJulianDay, centuries, cosd, horner, mod, RAD, sind } from './internal/math.js'
import { meanObliquity } from './nutation.js'
import type { SunPosition } from './types.js'

/**
 * Geocentric position of the Sun to ≈ 0.01° — Meeus ch. 25, "low
 * accuracy" (a Keplerian ellipse with the equation of centre). Against
 * astropy/ERFA at 150 instants in 1900–2100: apparent longitude within 28″,
 * right ascension within 29″, declination within 11″, distance within
 * 0.00007 AU (test fixture).
 *
 * - $L_0 = 280.46646° + 36000.76983°\,T + 0.0003032°\,T^2$ (25.2)
 * - $M = 357.52911° + 35999.05029°\,T - 0.0001537°\,T^2$ (25.3)
 * - $e = 0.016708634 - 0.000042037\,T - 0.0000001267\,T^2$ (25.4)
 * - $C = (1.914602° - 0.004817°\,T - 0.000014°\,T^2)\sin M + (0.019993° - 0.000101°\,T)\sin 2M + 0.000289°\sin 3M$
 * - $\odot = L_0 + C$, $\nu = M + C$, $R = 1.000001018\,(1 - e^2)/(1 + e\cos\nu)$ AU (25.5)
 * - $\Omega = 125.04° - 1934.136°\,T$; apparent $\lambda = \odot - 0.00569° - 0.00478°\sin\Omega$
 * - $\alpha, \delta$ with $\varepsilon = \varepsilon_0 + 0.00256°\cos\Omega$ (25.8)
 *
 * Meeus Example 25.a (1992 October 13.0 TD): $\lambda = 199.90895°$,
 * $\alpha = 13^\mathrm{h}13^\mathrm{m}31.4^\mathrm{s}$, $\delta = -7°47'06''$.
 *
 * @param jde Julian Ephemeris Day (TT) — see {@link julianEphemerisDay}.
 * @throws {EphemerisError} `invalid_time` outside the Julian-day domain.
 */
export function sunPosition(jde: number): SunPosition {
  assertJulianDay(jde, 'Julian Ephemeris Day')
  const t = centuries(jde)
  const l0 = horner(t, [280.46646, 36000.76983, 0.0003032])
  const m = horner(t, [357.52911, 35999.05029, -0.0001537])
  const e = horner(t, [0.016708634, -0.000042037, -0.0000001267])
  const c =
    horner(t, [1.914602, -0.004817, -0.000014]) * sind(m) +
    (0.019993 - 0.000101 * t) * sind(2 * m) +
    0.000289 * sind(3 * m)
  const trueLongitude = l0 + c
  const nu = m + c
  const distanceAu = (1.000001018 * (1 - e * e)) / (1 + e * cosd(nu))
  const omega = 125.04 - 1934.136 * t
  const longitude = trueLongitude - 0.00569 - 0.00478 * sind(omega)
  const obliquity = meanObliquity(jde) + 0.00256 * cosd(omega)
  const { rightAscension, declination } = eclipticToEquatorial(longitude, 0, obliquity)
  return {
    longitude: mod(longitude, 360),
    trueLongitude: mod(trueLongitude, 360),
    meanLongitude: mod(l0, 360),
    meanAnomaly: mod(m, 360),
    distanceAu,
    rightAscension,
    declination,
    obliquity,
  }
}

/**
 * The equation of time in **minutes**: apparent minus mean solar time
 * (positive when a sundial is ahead of the clock). Smart's series as given by
 * Meeus eq. 28.3:
 *
 * $E = y\sin 2L_0 - 2e\sin M + 4ey\sin M\cos 2L_0 - \tfrac12 y^2\sin 4L_0 - \tfrac54 e^2\sin 2M$
 * (radians), $y = \tan^2(\varepsilon_0/2)$,
 *
 * with $L_0$ from Meeus 28.2
 * ($280.4664567° + 360007.6982779°\,\tau + 0.03032028°\,\tau^2 + \tau^3/49931 - \tau^4/15300 - \tau^5/2\,000\,000$,
 * $\tau$ in Julian millennia), $e$ and $M$ from ch. 25. Meeus Example 28.b
 * (1992 October 13.0 TD): $+0.0598256$ rad $= +13^\mathrm{m}42.7^\mathrm{s}$.
 * Against GAST − apparent solar right ascension from ERFA at 150 instants in
 * 1900–2100 the largest difference is 3.2 s (test fixture).
 *
 * @param jde Julian Ephemeris Day (TT).
 * @throws {EphemerisError} `invalid_time` outside the Julian-day domain.
 */
export function equationOfTime(jde: number): number {
  assertJulianDay(jde, 'Julian Ephemeris Day')
  const t = centuries(jde)
  const tau = t / 10
  const l0 =
    horner(tau, [280.4664567, 360007.6982779, 0.03032028]) +
    tau ** 3 / 49931 -
    tau ** 4 / 15300 -
    tau ** 5 / 2000000
  const m = horner(t, [357.52911, 35999.05029, -0.0001537])
  const e = horner(t, [0.016708634, -0.000042037, -0.0000001267])
  const tanHalf = Math.tan((meanObliquity(jde) / 2) * RAD)
  const y = tanHalf * tanHalf
  const radians =
    y * sind(2 * l0) -
    2 * e * sind(m) +
    4 * e * y * sind(m) * cosd(2 * l0) -
    0.5 * y * y * sind(4 * l0) -
    1.25 * e * e * sind(2 * m)
  return (radians / RAD) * 4
}
