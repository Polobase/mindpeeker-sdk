// Everything the "Now" and "Any date" sections show for one observer, in one
// call, plus the sexagesimal formatting the page uses everywhere.
//
// CLIENT ONLY: it imports @mindpeeker/ephemeris, so only `*.client.vue`
// components (or modules they import) may import it.

import {
  dateFromJulianDay,
  decimalYear,
  deltaT,
  equationOfTime,
  equationOfTheEquinoxes,
  gast,
  gmst,
  julianDay,
  julianDayToDate,
  julianEphemerisDay,
  localMeanSolarTime,
  lst,
  type MoonIllumination,
  type MoonPhaseName,
  type MoonPosition,
  moonIllumination,
  moonPosition,
  nextMoonPhase,
  normalizeHours,
  nutation,
  type Nutation,
  type SunPosition,
  sunPosition,
  toSexagesimal,
  universalJulianDay,
} from '@mindpeeker/ephemeris'

const DEG = Math.PI / 180

/** `13h 10m 46.37s` — the package's own sexagesimal split, not a locale format. */
export function hms(hours: number | null | undefined, digits = 2): string {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) return '—'
  const s = toSexagesimal(hours)
  const sign = s.sign < 0 ? '−' : ''
  return `${sign}${s.whole}h ${String(s.minutes).padStart(2, '0')}m ${s.seconds.toFixed(digits).padStart(digits > 0 ? digits + 3 : 2, '0')}s`
}

/** `+13° 46′ 08.4″`. */
export function dms(degrees: number | null | undefined, digits = 1): string {
  if (degrees === null || degrees === undefined || !Number.isFinite(degrees)) return '—'
  const s = toSexagesimal(degrees)
  const sign = s.sign < 0 ? '−' : '+'
  return `${sign}${s.whole}° ${String(s.minutes).padStart(2, '0')}′ ${s.seconds.toFixed(digits).padStart(digits > 0 ? digits + 3 : 2, '0')}″`
}

/** Right ascension in degrees shown as hours: `13h 13m 31.4s`. */
export function raHms(degrees: number, digits = 1): string {
  return hms(degrees / 15, digits)
}

/** A `Date` in UTC, to the second: `1987-04-10 19:21:00 UT`. */
export function utc(date: Date | null | undefined): string {
  if (!date || Number.isNaN(date.getTime())) return '—'
  return `${date.toISOString().slice(0, 19).replace('T', ' ')} UT`
}

/** Horizontal coordinates of one equatorial position. */
export interface Horizontal {
  /** Hour angle H = LST − α, in hours, wrapped to (−12, +12]. */
  readonly hourAngleHours: number
  /** Geometric altitude in degrees (no refraction, no parallax). */
  readonly altitude: number
  /** Azimuth in degrees, north = 0, increasing through east. */
  readonly azimuth: number
}

/**
 * Altitude and azimuth from the package's α, δ and apparent sidereal time.
 * The package ships no horizontal-coordinate export: this is the textbook
 * rotation, geometric only — no refraction, no parallax, no semidiameter, so
 * it is not a rise/set time.
 */
export function horizontal(
  rightAscensionDeg: number,
  declinationDeg: number,
  lstApparentHours: number,
  latitudeDeg: number,
): Horizontal {
  const h = ((((lstApparentHours - rightAscensionDeg / 15) % 24) + 36) % 24) - 12
  const hRad = h * 15 * DEG
  const dec = declinationDeg * DEG
  const lat = latitudeDeg * DEG
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hRad)
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt))) / DEG
  const y = Math.sin(hRad)
  const x = Math.cos(hRad) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)
  const azimuth = (Math.atan2(y, x) / DEG + 180 + 360) % 360
  return { hourAngleHours: h, altitude, azimuth }
}

/** One principal phase, with the TT instant the package returns and its UT `Date`. */
export interface PhaseRow {
  readonly phase: MoonPhaseName
  readonly label: string
  readonly k: number
  readonly jde: number
  readonly date: Date
  readonly daysAway: number
}

export const PHASE_LABELS: Record<MoonPhaseName, string> = {
  new: 'New moon',
  firstQuarter: 'First quarter',
  full: 'Full moon',
  lastQuarter: 'Last quarter',
}

export const PHASE_ORDER: readonly MoonPhaseName[] = ['new', 'firstQuarter', 'full', 'lastQuarter']

/** Everything one instant and one place produce. */
export interface ObserverSnapshot {
  readonly date: Date
  readonly longitudeEastDeg: number
  readonly latitudeDeg: number
  /** UT Julian day. */
  readonly jd: number
  readonly deltaTSeconds: number
  /** TT Julian day (JDE) — what the Sun, Moon and phase functions take. */
  readonly jde: number
  readonly decimalYear: number
  readonly calendar: ReturnType<typeof dateFromJulianDay>
  readonly gmstHours: number
  readonly gastHours: number
  /** Equation of the equinoxes in seconds of time. */
  readonly equationOfEquinoxesSeconds: number
  readonly lstMeanHours: number
  readonly lstApparentHours: number
  readonly localMeanSolarHours: number
  readonly nutation: Nutation
  readonly sun: SunPosition
  readonly equationOfTimeMinutes: number
  readonly sunHorizontal: Horizontal
  readonly moon: MoonPosition
  readonly illumination: MoonIllumination
  readonly moonHorizontal: Horizontal
  readonly phases: readonly PhaseRow[]
}

/**
 * One instant, one observer: UT → JD → ΔT → TT, sidereal time, the Sun, the
 * Moon and the next four principal phases.
 *
 * Every SDK call here is exact to the accuracy table in the package README;
 * `horizontal` is the only quantity computed on this page.
 */
export function observe(date: Date, longitudeEastDeg: number, latitudeDeg: number): ObserverSnapshot {
  const jd = julianDay(date)
  const year = decimalYear(jd)
  const deltaTSeconds = deltaT(year)
  const jde = julianEphemerisDay(jd, deltaTSeconds)
  const gmstHours = gmst(jd)
  const gastHours = gast(jd)
  const lstMeanHours = lst(jd, longitudeEastDeg)
  const lstApparentHours = lst(jd, longitudeEastDeg, { sidereal: 'apparent' })
  const sun = sunPosition(jde)
  const moon = moonPosition(jde)
  const illumination = moonIllumination(jde)
  const phases = PHASE_ORDER.map((phase) => {
    const event = nextMoonPhase(jde, phase)
    const ut = universalJulianDay(event.jde, deltaTSeconds)
    return {
      phase,
      label: PHASE_LABELS[phase],
      k: event.k,
      jde: event.jde,
      date: julianDayToDate(ut),
      daysAway: ut - jd,
    }
  })
  return {
    date,
    longitudeEastDeg,
    latitudeDeg,
    jd,
    deltaTSeconds,
    jde,
    decimalYear: year,
    calendar: dateFromJulianDay(jd),
    gmstHours,
    gastHours,
    equationOfEquinoxesSeconds: equationOfTheEquinoxes(jd) * 3600,
    lstMeanHours,
    lstApparentHours,
    localMeanSolarHours: normalizeHours(localMeanSolarTime(jd, longitudeEastDeg)),
    nutation: nutation(jde),
    sun,
    equationOfTimeMinutes: equationOfTime(jde),
    sunHorizontal: horizontal(sun.rightAscension, sun.declination, lstApparentHours, latitudeDeg),
    moon,
    illumination,
    moonHorizontal: horizontal(moon.rightAscension, moon.declination, lstApparentHours, latitudeDeg),
    phases,
  }
}

/** A few observatories and labs, so the inputs start somewhere real. */
export const PLACES = [
  { label: 'Greenwich (the meridian)', lon: 0, lat: 51.4779 },
  { label: 'Edinburgh (KPU)', lon: -3.19, lat: 55.95 },
  { label: 'Princeton (PEAR)', lon: -74.66, lat: 40.35 },
  { label: 'Menlo Park (SRI)', lon: -122.18, lat: 37.45 },
  { label: 'Zurich', lon: 8.54, lat: 47.37 },
  { label: 'Tokyo', lon: 139.69, lat: 35.69 },
  { label: 'Cape Town', lon: 18.42, lat: -33.93 },
] as const
