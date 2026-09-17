import { cosd, mod, RAD, sind } from './math.js'

/**
 * Right ascension and declination (degrees) of ecliptic coordinates —
 * Meeus 13.3 and 13.4:
 * $\tan\alpha = (\sin\lambda\cos\varepsilon - \tan\beta\sin\varepsilon)/\cos\lambda$,
 * $\sin\delta = \sin\beta\cos\varepsilon + \cos\beta\sin\varepsilon\sin\lambda$.
 */
export function eclipticToEquatorial(
  longitude: number,
  latitude: number,
  obliquity: number,
): { rightAscension: number; declination: number } {
  const sinEps = sind(obliquity)
  const cosEps = cosd(obliquity)
  const sinLon = sind(longitude)
  const alpha = Math.atan2(sinLon * cosEps - Math.tan(latitude * RAD) * sinEps, cosd(longitude))
  const sinDelta = sind(latitude) * cosEps + cosd(latitude) * sinEps * sinLon
  return {
    rightAscension: mod(alpha / RAD, 360),
    declination: Math.asin(Math.max(-1, Math.min(1, sinDelta))) / RAD,
  }
}
