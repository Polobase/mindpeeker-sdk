import { eclipticToEquatorial } from './internal/coords.js'
import { assertJulianDay, centuries, mod, RAD, sind } from './internal/math.js'
import { LATITUDE_TERMS, LONGITUDE_DISTANCE_TERMS } from './internal/moon-tables.js'
import { nutation } from './nutation.js'
import type { MoonPosition } from './types.js'

/** Fundamental lunar arguments of Meeus ch. 47, in degrees (unreduced). */
interface LunarArguments {
  /** Mean longitude $L'$, referred to the mean equinox of date (47.1). */
  readonly meanLongitude: number
  /** Mean elongation $D$ (47.2). */
  readonly elongation: number
  /** Sun's mean anomaly $M$ (47.3). */
  readonly sunMeanAnomaly: number
  /** Moon's mean anomaly $M'$ (47.4). */
  readonly moonMeanAnomaly: number
  /** Argument of latitude $F$ (47.5). */
  readonly argumentOfLatitude: number
}

/** Meeus 47.1–47.5 for Julian centuries `t`. */
function lunarArguments(t: number): LunarArguments {
  const t2 = t * t
  const t3 = t2 * t
  const t4 = t3 * t
  return {
    meanLongitude: 218.3164477 + 481267.88123421 * t - 0.0015786 * t2 + t3 / 538841 - t4 / 65194000,
    elongation: 297.8501921 + 445267.1114034 * t - 0.0018819 * t2 + t3 / 545868 - t4 / 113065000,
    sunMeanAnomaly: 357.5291092 + 35999.0502909 * t - 0.0001536 * t2 + t3 / 24490000,
    moonMeanAnomaly: 134.9633964 + 477198.8675055 * t + 0.0087414 * t2 + t3 / 69699 - t4 / 14712000,
    argumentOfLatitude:
      93.272095 + 483202.0175233 * t - 0.0036539 * t2 - t3 / 3526000 + t4 / 863310000,
  }
}

/**
 * Geocentric position of the Moon — Meeus ch. 47 with the complete Tables
 * 47.A (60 terms in longitude and distance) and 47.B (60 terms in latitude),
 * the additive Venus/Jupiter/flattening terms, the eccentricity factor
 * $E = 1 - 0.002516\,T - 0.0000074\,T^2$ on terms in $M$ ($E^2$ for $2M$),
 * and the apparent longitude $\lambda + \Delta\psi$ with the short
 * {@link nutation} series:
 *
 * $\lambda = L' + \Sigma l \cdot 10^{-6}$, $\beta = \Sigma b \cdot 10^{-6}$,
 * $\Delta = 385\,000.56 + \Sigma r \cdot 10^{-3}$ km.
 *
 * Accuracy, measured against JPL DE440s (geometric geocentric Moon) at 150
 * instants in 1900–2100: longitude within 10.5″ (RMS 2.9″), latitude within
 * 3.7″, distance within 7.1 km (test fixture). Meeus Example 47.a
 * (1992 April 12, 0h TD):
 * $\lambda = 133.162655°$, $\beta = -3.229126°$, $\Delta = 368\,409.7$ km,
 * $\alpha = 134.688470°$, $\delta = 13.768368°$.
 *
 * @param jde Julian Ephemeris Day (TT) — see {@link julianEphemerisDay}.
 * @throws {EphemerisError} `invalid_time` outside the Julian-day domain.
 */
export function moonPosition(jde: number): MoonPosition {
  assertJulianDay(jde, 'Julian Ephemeris Day')
  const t = centuries(jde)
  const args = lunarArguments(t)
  const lp = args.meanLongitude
  const d = args.elongation
  const m = args.sunMeanAnomaly
  const mp = args.moonMeanAnomaly
  const f = args.argumentOfLatitude
  const a1 = 119.75 + 131.849 * t
  const a2 = 53.09 + 479264.29 * t
  const a3 = 313.45 + 481266.484 * t
  const e = 1 - 0.002516 * t - 0.0000074 * t * t
  const e2 = e * e

  let sumL = 0
  let sumR = 0
  for (const [cd, cm, cmp, cf, coefL, coefR] of LONGITUDE_DISTANCE_TERMS) {
    const arg = (cd * d + cm * m + cmp * mp + cf * f) * RAD
    const factor = cm === 0 ? 1 : cm === 1 || cm === -1 ? e : e2
    sumL += coefL * factor * Math.sin(arg)
    sumR += coefR * factor * Math.cos(arg)
  }
  let sumB = 0
  for (const [cd, cm, cmp, cf, coefB] of LATITUDE_TERMS) {
    const arg = (cd * d + cm * m + cmp * mp + cf * f) * RAD
    const factor = cm === 0 ? 1 : cm === 1 || cm === -1 ? e : e2
    sumB += coefB * factor * Math.sin(arg)
  }
  sumL += 3958 * sind(a1) + 1962 * sind(lp - f) + 318 * sind(a2)
  sumB +=
    -2235 * sind(lp) +
    382 * sind(a3) +
    175 * sind(a1 - f) +
    175 * sind(a1 + f) +
    127 * sind(lp - mp) -
    115 * sind(lp + mp)

  const meanEquinoxLongitude = mod(lp + sumL / 1e6, 360)
  const latitude = sumB / 1e6
  const distanceKm = 385000.56 + sumR / 1000
  const nut = nutation(jde)
  const longitude = mod(meanEquinoxLongitude + nut.longitude, 360)
  const { rightAscension, declination } = eclipticToEquatorial(
    longitude,
    latitude,
    nut.trueObliquity,
  )
  return {
    longitude,
    latitude,
    meanEquinoxLongitude,
    distanceKm,
    horizontalParallax: Math.asin(6378.14 / distanceKm) / RAD,
    rightAscension,
    declination,
  }
}
