import { assertJulianDay, centuries, cosd, horner, sind } from './internal/math.js'
import type { Nutation } from './types.js'

/**
 * Mean obliquity of the ecliptic $\varepsilon_0$ in degrees — the IAU 1980
 * polynomial (Meeus 22.2):
 * $\varepsilon_0 = 23°26'21.448'' - 46.8150''\,T - 0.00059''\,T^2 + 0.001813''\,T^3$.
 * Accurate to 1″ over AD 1000–3000 and 10″ over AD 0–4000 (Meeus).
 *
 * @param jde Julian Ephemeris Day (TT).
 * @throws {EphemerisError} `invalid_time` outside the Julian-day domain.
 */
export function meanObliquity(jde: number): number {
  assertJulianDay(jde, 'Julian Ephemeris Day')
  const seconds = horner(centuries(jde), [21.448, -46.815, -0.00059, 0.001813])
  return 23 + 26 / 60 + seconds / 3600
}

/**
 * Nutation in longitude and obliquity from the four largest terms (Meeus
 * ch. 22, "if an accuracy of 0.5″ in Δψ and 0.1″ in Δε is sufficient"):
 *
 * $\Delta\psi = -17.20''\sin\Omega - 1.32''\sin 2L - 0.23''\sin 2L' + 0.21''\sin 2\Omega$
 *
 * $\Delta\varepsilon = +9.20''\cos\Omega + 0.57''\cos 2L + 0.10''\cos 2L' - 0.09''\cos 2\Omega$
 *
 * with $\Omega = 125.04452° - 1934.136261°\,T$, $L = 280.4665° + 36000.7698°\,T$,
 * $L' = 218.3165° + 481267.8813°\,T$.
 *
 * @param jde Julian Ephemeris Day (TT).
 * @throws {EphemerisError} `invalid_time` outside the Julian-day domain.
 */
export function nutation(jde: number): Nutation {
  const epsilon0 = meanObliquity(jde)
  const t = centuries(jde)
  const omega = 125.04452 - 1934.136261 * t
  const l = 280.4665 + 36000.7698 * t
  const lPrime = 218.3165 + 481267.8813 * t
  const dPsi =
    -17.2 * sind(omega) - 1.32 * sind(2 * l) - 0.23 * sind(2 * lPrime) + 0.21 * sind(2 * omega)
  const dEps =
    9.2 * cosd(omega) + 0.57 * cosd(2 * l) + 0.1 * cosd(2 * lPrime) - 0.09 * cosd(2 * omega)
  const obliquity = dEps / 3600
  return {
    longitude: dPsi / 3600,
    obliquity,
    meanObliquity: epsilon0,
    trueObliquity: epsilon0 + obliquity,
  }
}
