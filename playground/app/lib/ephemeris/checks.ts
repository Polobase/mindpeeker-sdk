// The worked examples of Meeus, *Astronomical Algorithms* (2nd ed., 1998),
// recomputed in the browser by the same functions the rest of the page calls.
// Every expected value is the one printed in the book; every tolerance is the
// one the package's own test suite asserts.
//
// CLIENT ONLY: imports @mindpeeker/ephemeris.

import {
  dateFromJulianDay,
  EphemerisError,
  equationOfTheEquinoxes,
  equationOfTime,
  gast,
  gmst,
  julianDay,
  meanObliquity,
  moonIllumination,
  moonPhaseTime,
  moonPosition,
  nutation,
  sunPosition,
  toSexagesimal,
} from '@mindpeeker/ephemeris'

export interface CheckRow {
  /** What is being compared. */
  readonly quantity: string
  /** Meeus' printed value, formatted. */
  readonly expected: string
  /** What this build computed, formatted. */
  readonly got: string
  /** |got − expected| with its unit, or `—` for an exact-equality row. */
  readonly difference: string
  /** The bound the package's tests assert. */
  readonly tolerance: string
  readonly ok: boolean
}

export interface CheckGroup {
  readonly id: string
  readonly title: string
  readonly source: string
  readonly api: readonly string[]
  readonly note?: string
  readonly rows: readonly CheckRow[]
  readonly ok: boolean
}

function sec(hours: number): number {
  return hours * 3600
}

/** Compare with an absolute tolerance and format both sides with `fmt`. */
function row(
  quantity: string,
  expected: number,
  got: number,
  tolerance: number,
  unit: string,
  fmt: (v: number) => string,
  scale = 1,
): CheckRow {
  const diff = Math.abs(got - expected) * scale
  return {
    quantity,
    expected: fmt(expected),
    got: fmt(got),
    difference: `${diff < 1e-9 ? '0' : diff.toPrecision(2)} ${unit}`,
    tolerance: `< ${tolerance} ${unit}`,
    ok: diff <= tolerance,
  }
}

function exact(quantity: string, expected: string, got: string): CheckRow {
  return {
    quantity,
    expected,
    got,
    difference: got === expected ? 'identical' : 'differs',
    tolerance: 'exact',
    ok: got === expected,
  }
}

const hmsFixed = (hours: number): string => {
  const s = toSexagesimal(hours)
  return `${s.sign < 0 ? '−' : ''}${s.whole}h ${String(s.minutes).padStart(2, '0')}m ${s.seconds.toFixed(4)}s`
}
const deg = (v: number): string => `${v.toFixed(6)}°`
const arcsec = (v: number): string => `${v.toFixed(3)}″`

/** Run every worked example and report each comparison. */
export function runChecks(): CheckGroup[] {
  const groups: CheckGroup[] = []

  // ── Chapter 7: the Julian day ────────────────────────────────────────────
  const jdRows: CheckRow[] = [
    row(
      'Example 7.a — 1957 October 4.81 (Sputnik 1)',
      2436116.31,
      julianDay({ year: 1957, month: 10, day: 4.81 }),
      1e-8,
      'd',
      (v) => v.toFixed(5),
    ),
    row(
      'Example 7.b — 333 January 27.5 (Julian calendar)',
      1842713.0,
      julianDay({ year: 333, month: 1, day: 27.5 }),
      1e-8,
      'd',
      (v) => v.toFixed(5),
    ),
    row(
      'Table p. 62 — −4712 January 1.5 (the epoch)',
      0,
      julianDay({ year: -4712, month: 1, day: 1.5 }),
      1e-8,
      'd',
      (v) => v.toFixed(5),
    ),
    row(
      'Table p. 62 — −1000 February 29 (a Julian leap year)',
      1355866.5,
      julianDay({ year: -1000, month: 2, day: 29 }),
      1e-8,
      'd',
      (v) => v.toFixed(5),
    ),
  ]
  const back = dateFromJulianDay(2436116.31)
  jdRows.push(
    exact(
      'Example 7.c — JD 2436116.31 back to a calendar date',
      '1957-10-04 19:26:24.0 (gregorian)',
      `${String(back.year).padStart(4, '0')}-${String(back.month).padStart(2, '0')}-${String(back.day).padStart(2, '0')} ${String(back.hour).padStart(2, '0')}:${String(back.minute).padStart(2, '0')}:${back.second.toFixed(1).padStart(4, '0')} (${back.calendar})`,
    ),
  )
  jdRows.push(
    exact(
      'The Gregorian reform — 1582 Oct 4 → JD, 1582 Oct 15 → JD',
      '2299159.5 / 2299160.5',
      `${julianDay({ year: 1582, month: 10, day: 4 })} / ${julianDay({ year: 1582, month: 10, day: 15 })}`,
    ),
  )
  jdRows.push(
    exact(
      'The ten days that never existed — julianDay(1582 Oct 10)',
      "throws EphemerisError 'invalid_time'",
      thrown(() => julianDay({ year: 1582, month: 10, day: 10 })),
    ),
  )
  jdRows.push(
    exact(
      'A date that is not a date — julianDay(2023 Feb 29)',
      "throws EphemerisError 'invalid_time'",
      thrown(() => julianDay({ year: 2023, month: 2, day: 29 })),
    ),
  )
  groups.push(group('jd', 'Julian day — Meeus ch. 7', 'Examples 7.a–7.c and the table on p. 62', ['julianDay', 'dateFromJulianDay'], jdRows))

  // ── Chapter 12: sidereal time ────────────────────────────────────────────
  const jd12b = julianDay({ year: 1987, month: 4, day: 10, hour: 19, minute: 21 })
  const siderealRows: CheckRow[] = [
    row(
      'Example 12.a — GMST at 1987 April 10, 0h UT',
      sec(13 + 10 / 60 + 46.3668 / 3600),
      sec(gmst(2446895.5)),
      1e-4,
      's',
      (v) => hmsFixed(v / 3600),
    ),
    row(
      'Example 12.a — GAST at the same instant',
      sec(13 + 10 / 60 + 46.1351 / 3600),
      sec(gast(2446895.5)),
      0.05,
      's',
      (v) => hmsFixed(v / 3600),
    ),
    row(
      'Example 12.b — GMST at 1987 April 10, 19h21m00s UT',
      sec(8 + 34 / 60 + 57.0896 / 3600),
      sec(gmst(jd12b)),
      1e-3,
      's',
      (v) => hmsFixed(v / 3600),
    ),
    row(
      'Example 12.b — that instant as a Julian day',
      2446896.30625,
      jd12b,
      1e-9,
      'd',
      (v) => v.toFixed(8),
    ),
    row(
      'A mean sidereal day is 23h56m04.0905s of UT',
      0,
      (gmst(2460000.3 + 1 / 1.00273790935) - gmst(2460000.3)) * 3600,
      0.01,
      's',
      (v) => `${v.toFixed(4)} s of drift`,
    ),
  ]
  groups.push(
    group(
      'sidereal',
      'Sidereal time — Meeus ch. 12, USNO',
      'Examples 12.a and 12.b',
      ['gmst', 'gast', 'equationOfTheEquinoxes'],
      siderealRows,
      `Meeus prints 13h10m46.1351s for GAST using the full IAU 1980 nutation series; this package uses the USNO short series, which lands ${Math.abs(sec(gast(2446895.5)) - sec(13 + 10 / 60 + 46.1351 / 3600)).toFixed(3)} s away — inside the 0.04 s bound the tests assert against ERFA's gst94.`,
    ),
  )

  // ── Chapter 22: nutation and obliquity ───────────────────────────────────
  const nut = nutation(2446895.5)
  const nutationRows: CheckRow[] = [
    row('Example 22.a — Δψ (nutation in longitude)', -3.788, nut.longitude * 3600, 0.5, '″', arcsec),
    row('Example 22.a — Δε (nutation in obliquity)', 9.443, nut.obliquity * 3600, 0.1, '″', arcsec),
    row(
      'Example 22.a — ε₀ (mean obliquity)',
      23 + 26 / 60 + 27.407 / 3600,
      nut.meanObliquity,
      0.005,
      '″',
      deg,
      3600,
    ),
    row(
      'Example 22.a — ε (true obliquity)',
      23 + 26 / 60 + 36.85 / 3600,
      nut.trueObliquity,
      0.2,
      '″',
      deg,
      3600,
    ),
    row(
      'ε₀ at J2000.0 is exactly 23°26′21.448″',
      23 + 26 / 60 + 21.448 / 3600,
      meanObliquity(2451545),
      1e-6,
      '″',
      deg,
      3600,
    ),
  ]
  groups.push(
    group('nutation', 'Nutation and obliquity — Meeus ch. 22', 'Example 22.a, 1987 April 10, 0h TD', ['nutation', 'meanObliquity'], nutationRows),
  )

  // ── Chapter 25 and 28: the Sun ───────────────────────────────────────────
  const sun = sunPosition(2448908.5)
  const sunRows: CheckRow[] = [
    row('Example 25.a — geometric mean longitude L₀', 201.80720, sun.meanLongitude, 0.0001, '°', deg),
    row('Example 25.a — mean anomaly M', 278.99397, sun.meanAnomaly, 0.0001, '°', deg),
    row('Example 25.a — true longitude ☉', 199.90988, sun.trueLongitude, 0.0001, '°', deg),
    row('Example 25.a — apparent longitude λ', 199.90895, sun.longitude, 0.0001, '°', deg),
    row('Example 25.a — radius vector R', 0.99766, sun.distanceAu, 1e-5, 'AU', (v) => `${v.toFixed(6)} AU`),
    row(
      'Example 25.a — apparent α (13h13m31.4s)',
      sec(13 + 13 / 60 + 31.4 / 3600),
      sec(sun.rightAscension / 15),
      0.1,
      's',
      (v) => hmsFixed(v / 3600),
    ),
    row(
      'Example 25.a — apparent δ (−7°47′06″)',
      -(7 + 47 / 60 + 6 / 3600),
      sun.declination,
      1,
      '″',
      (v) => `${v.toFixed(6)}°`,
      3600,
    ),
    row(
      'Example 28.b — equation of time, +13m42.7s',
      13 * 60 + 42.7,
      equationOfTime(2448908.5) * 60,
      0.1,
      's',
      (v) => `${v < 0 ? '−' : '+'}${Math.floor(Math.abs(v) / 60)}m ${(Math.abs(v) % 60).toFixed(2)}s`,
    ),
  ]
  groups.push(
    group(
      'sun',
      'The Sun — Meeus ch. 25 and 28',
      'Examples 25.a and 28.b, 1992 October 13.0 TD',
      ['sunPosition', 'equationOfTime'],
      sunRows,
    ),
  )

  // ── Chapters 47–49: the Moon ─────────────────────────────────────────────
  const moon = moonPosition(2448724.5)
  const illum = moonIllumination(2448724.5)
  const moonRows: CheckRow[] = [
    row('Example 47.a — λ (mean equinox of date)', 133.162655, moon.meanEquinoxLongitude, 0.05, '″', deg, 3600),
    row('Example 47.a — β (ecliptic latitude)', -3.229126, moon.latitude, 0.05, '″', deg, 3600),
    row('Example 47.a — Δ (distance)', 368409.7, moon.distanceKm, 0.2, 'km', (v) => `${v.toFixed(1)} km`),
    row('Example 47.a — π (horizontal parallax)', 0.991990, moon.horizontalParallax, 0.05, '″', deg, 3600),
    row('Example 47.a — apparent α', 134.688470, moon.rightAscension, 0.5, '″', deg, 3600),
    row('Example 47.a — apparent δ', 13.768368, moon.declination, 0.5, '″', deg, 3600),
    row('Example 48.a — phase angle i', 69.0756, illum.phaseAngle, 0.001, '°', (v) => `${v.toFixed(4)}°`),
    row(
      'Example 48.a — illuminated fraction k',
      0.6786,
      illum.illuminatedFraction,
      1e-4,
      '',
      (v) => v.toFixed(5),
    ),
    row(
      'Example 48.a — bright limb position angle χ',
      285.0,
      illum.brightLimbAngle,
      0.1,
      '°',
      (v) => `${v.toFixed(3)}°`,
    ),
    row(
      'Example 49.a — new moon of 1977 February, k = −283',
      2443192.65118,
      moonPhaseTime(-283),
      1e-5,
      'd',
      (v) => v.toFixed(6),
    ),
    row(
      'Example 49.b — last quarter of 2044 January, k = 544.75',
      2467636.49186,
      moonPhaseTime(544.75),
      1e-5,
      'd',
      (v) => v.toFixed(6),
    ),
  ]
  groups.push(
    group(
      'moon',
      'The Moon — Meeus ch. 47, 48 and 49',
      'Examples 47.a and 48.a (1992 April 12, 0h TD), 49.a and 49.b',
      ['moonPosition', 'moonIllumination', 'moonPhaseTime'],
      moonRows,
      'Meeus adds the complete IAU 1980 nutation to the apparent longitude (Δψ = +0.004610°); the four-term series used here is within 0.5″, which is why the apparent α, δ rows carry a 0.5″ bound while λ, β and Δ are checked at 0.05″.',
    ),
  )

  // ── The equation of the equinoxes stays small ────────────────────────────
  let worst = 0
  for (let jd = 2415020.5; jd < 2488069.5; jd += 97.3) {
    worst = Math.max(worst, Math.abs(equationOfTheEquinoxes(jd) * 3600))
  }
  groups.push(
    group(
      'eqeq',
      'The equation of the equinoxes over 1900–2100',
      'GAST − GMST never leaves ±1.2 s',
      ['equationOfTheEquinoxes'],
      [row('largest |Δψ cos ε| over 750 sampled instants', 0, worst, 1.2, 's', (v) => `${v.toFixed(4)} s`)],
    ),
  )

  return groups
}

function group(
  id: string,
  title: string,
  source: string,
  api: readonly string[],
  rows: readonly CheckRow[],
  note?: string,
): CheckGroup {
  return { id, title, source, api, rows, ok: rows.every((r) => r.ok), ...(note ? { note } : {}) }
}

function thrown(fn: () => unknown): string {
  try {
    const value = fn()
    return `returned ${String(value)}`
  } catch (error) {
    if (error instanceof EphemerisError) return `throws EphemerisError '${error.code}'`
    return `threw ${(error as Error).name}`
  }
}
