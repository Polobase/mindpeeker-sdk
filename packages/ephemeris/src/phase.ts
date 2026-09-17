import { EphemerisError } from './errors.js'
import {
  assertFinite,
  assertJulianDay,
  cosd,
  JD_MAX,
  JD_MIN,
  mod,
  RAD,
  sind,
} from './internal/math.js'
import { moonPosition } from './moon.js'
import { sunPosition } from './sun.js'
import type { MoonIllumination, MoonPhaseEvent, MoonPhaseName } from './types.js'

const AU_KM = 149597870.7
const SYNODIC_MONTH = 29.530588861
const PHASE_EPOCH = 2451550.09766
const PHASES: readonly MoonPhaseName[] = ['new', 'firstQuarter', 'full', 'lastQuarter']
/** Largest range {@link moonPhases} enumerates: 10 000 Julian years (≈ 495 000 events). */
const MAX_RANGE_DAYS = 3652500

/**
 * Illumination of the Moon from the positions of Sun and Moon — Meeus ch. 48,
 * eqs. 48.2, 48.3 and 48.5, with {@link sunPosition} and
 * {@link moonPosition}:
 *
 * $\cos\psi = \cos\beta\cos(\lambda - \lambda_0)$,
 * $\tan i = R\sin\psi / (\Delta - R\cos\psi)$, $k = (1 + \cos i)/2$,
 *
 * $\tan\chi = \cos\delta_0\sin(\alpha_0 - \alpha) / (\sin\delta_0\cos\delta - \cos\delta_0\sin\delta\cos(\alpha_0 - \alpha))$.
 *
 * Meeus Example 48.a (1992 April 12, 0h TD): $i = 69.0756°$, $k = 0.6786$,
 * $\chi = 285.0°$.
 * Against the phase angle from JPL DE440s geometric vectors at 150 instants
 * in 1900–2100: within 0.011°, illuminated fraction within 0.0001.
 *
 * @param jde Julian Ephemeris Day (TT).
 * @throws {EphemerisError} `invalid_time` outside the Julian-day domain.
 */
export function moonIllumination(jde: number): MoonIllumination {
  const sun = sunPosition(jde)
  const moon = moonPosition(jde)
  const r = sun.distanceAu * AU_KM
  const cosPsi = Math.max(
    -1,
    Math.min(1, cosd(moon.latitude) * cosd(moon.longitude - sun.longitude)),
  )
  const psi = Math.acos(cosPsi)
  const i = Math.atan2(r * Math.sin(psi), moon.distanceKm - r * cosPsi)
  const dAlpha = (sun.rightAscension - moon.rightAscension) * RAD
  const chi = Math.atan2(
    cosd(sun.declination) * Math.sin(dAlpha),
    sind(sun.declination) * cosd(moon.declination) -
      cosd(sun.declination) * sind(moon.declination) * Math.cos(dAlpha),
  )
  const longitudeFromSun = mod(moon.longitude - sun.longitude, 360)
  return {
    phaseAngle: i / RAD,
    illuminatedFraction: (1 + Math.cos(i)) / 2,
    elongation: psi / RAD,
    longitudeFromSun,
    brightLimbAngle: mod(chi / RAD, 360),
    waxing: longitudeFromSun < 180,
  }
}

function phaseOfK(k: number): MoonPhaseName {
  return PHASES[mod(Math.round(k * 4), 4)] as MoonPhaseName
}

/**
 * Instant (JDE, TT) of a principal lunar phase — Meeus ch. 49. `k` is an
 * integer for a new moon (k = 0 is the new moon of 2000 January 6), and
 * k + 0.25, + 0.5, + 0.75 for first quarter, full moon and last quarter:
 *
 * $\mathrm{JDE} = 2451550.09766 + 29.530588861\,k + 0.00015437\,T^2 - 0.000000150\,T^3 + 0.00000000073\,T^4$,
 * $T = k/1236.85$,
 *
 * plus the periodic terms in $M, M', F, \Omega$ for the phase, the quarter
 * correction $\pm W$, and the fourteen planetary arguments $A_1 \dots A_{14}$.
 * Against the instants where the JPL DE440s Moon minus the apparent Sun
 * reaches 0/90/180/270° the largest difference over 33 phases in 1950–2050
 * is 12.6 s (test fixture). Examples 49.a (new moon 1977 February,
 * k = −283: JDE 2443192.65118) and 49.b (last quarter 2044 January,
 * k = 544.75: JDE 2467636.49186).
 *
 * @throws {EphemerisError} `invalid_input` unless `4k` is a finite integer;
 *   `invalid_time` if the result leaves the Julian-day domain.
 */
export function moonPhaseTime(k: number): number {
  assertFinite(k, 'k')
  if (!Number.isInteger(k * 4) || Math.abs(k) > 1e6) {
    throw new EphemerisError(
      'invalid_input',
      `k must be a multiple of 0.25 with |k| ≤ 10^6, got ${k}`,
    )
  }
  const phase = phaseOfK(k)
  const t = k / 1236.85
  const t2 = t * t
  const t3 = t2 * t
  const t4 = t3 * t
  const jdeMean =
    PHASE_EPOCH + SYNODIC_MONTH * k + 0.00015437 * t2 - 0.00000015 * t3 + 0.00000000073 * t4
  const e = 1 - 0.002516 * t - 0.0000074 * t2
  const e2 = e * e
  const m = (2.5534 + 29.1053567 * k - 0.0000014 * t2 - 0.00000011 * t3) * RAD
  const mp =
    (201.5643 + 385.81693528 * k + 0.0107582 * t2 + 0.00001238 * t3 - 0.000000058 * t4) * RAD
  const f =
    (160.7108 + 390.67050284 * k - 0.0016118 * t2 - 0.00000227 * t3 + 0.000000011 * t4) * RAD
  const omega = (124.7746 - 1.56375588 * k + 0.0020672 * t2 + 0.00000215 * t3) * RAD
  const sin = Math.sin

  let correction: number
  if (phase === 'new' || phase === 'full') {
    const c = phase === 'new' ? NEW_MOON : FULL_MOON
    correction =
      c[0] * sin(mp) +
      c[1] * e * sin(m) +
      c[2] * sin(2 * mp) +
      c[3] * sin(2 * f) +
      c[4] * e * sin(mp - m) +
      c[5] * e * sin(mp + m) +
      c[6] * e2 * sin(2 * m) +
      c[7] * sin(mp - 2 * f) +
      c[8] * sin(mp + 2 * f) +
      c[9] * e * sin(2 * mp + m) +
      c[10] * sin(3 * mp) +
      c[11] * e * sin(m + 2 * f) +
      c[12] * e * sin(m - 2 * f) +
      c[13] * e * sin(2 * mp - m) +
      c[14] * sin(omega) +
      c[15] * sin(mp + 2 * m) +
      c[16] * sin(2 * mp - 2 * f) +
      c[17] * sin(3 * m) +
      c[18] * sin(mp + m - 2 * f) +
      c[19] * sin(2 * mp + 2 * f) +
      c[20] * sin(mp + m + 2 * f) +
      c[21] * sin(mp - m + 2 * f) +
      c[22] * sin(mp - m - 2 * f) +
      c[23] * sin(3 * mp + m) +
      c[24] * sin(4 * mp)
  } else {
    correction =
      -0.62801 * sin(mp) +
      0.17172 * e * sin(m) -
      0.01183 * e * sin(mp + m) +
      0.00862 * sin(2 * mp) +
      0.00804 * sin(2 * f) +
      0.00454 * e * sin(mp - m) +
      0.00204 * e2 * sin(2 * m) -
      0.0018 * sin(mp - 2 * f) -
      0.0007 * sin(mp + 2 * f) -
      0.0004 * sin(3 * mp) -
      0.00034 * e * sin(2 * mp - m) +
      0.00032 * e * sin(m + 2 * f) +
      0.00032 * e * sin(m - 2 * f) -
      0.00028 * e2 * sin(mp + 2 * m) +
      0.00027 * e * sin(2 * mp + m) -
      0.00017 * sin(omega) -
      0.00005 * sin(mp - m - 2 * f) +
      0.00004 * sin(2 * mp + 2 * f) -
      0.00004 * sin(mp + m + 2 * f) +
      0.00004 * sin(mp - 2 * m) +
      0.00003 * sin(mp + m - 2 * f) +
      0.00003 * sin(3 * m) +
      0.00002 * sin(2 * mp - 2 * f) +
      0.00002 * sin(mp - m + 2 * f) -
      0.00002 * sin(3 * mp + m)
    const w =
      0.00306 -
      0.00038 * e * Math.cos(m) +
      0.00026 * Math.cos(mp) -
      0.00002 * Math.cos(mp - m) +
      0.00002 * Math.cos(mp + m) +
      0.00002 * Math.cos(2 * f)
    correction += phase === 'firstQuarter' ? w : -w
  }

  // A1 carries an extra −0.009173° T²; A2…A14 are linear in k (Meeus 49).
  let planetary = 0.000325 * sind(299.77 + 0.107408 * k - 0.009173 * t2)
  for (const [amplitude, a0, a1] of PLANETARY_ARGUMENTS) {
    planetary += amplitude * sind(a0 + a1 * k)
  }

  const jde = jdeMean + correction + planetary
  if (jde < JD_MIN || jde > JD_MAX) {
    throw new EphemerisError('invalid_time', `phase k = ${k} falls outside the Julian-day domain`)
  }
  return jde
}

/** Meeus 49, new-moon periodic terms (days), in the order of {@link moonPhaseTime}. */
const NEW_MOON = [
  -0.4072, 0.17241, 0.01608, 0.01039, 0.00739, -0.00514, 0.00208, -0.00111, -0.00057, 0.00056,
  -0.00042, 0.00042, 0.00038, -0.00024, -0.00017, -0.00007, 0.00004, 0.00004, 0.00003, 0.00003,
  -0.00003, 0.00003, -0.00002, -0.00002, 0.00002,
] as const

/** Meeus 49, full-moon periodic terms (days). */
const FULL_MOON = [
  -0.40614, 0.17302, 0.01614, 0.01043, 0.00734, -0.00515, 0.00209, -0.00111, -0.00057, 0.00056,
  -0.00042, 0.00042, 0.00038, -0.00024, -0.00017, -0.00007, 0.00004, 0.00004, 0.00003, 0.00003,
  -0.00003, 0.00003, -0.00002, -0.00002, 0.00002,
] as const

/** Meeus 49 additional corrections: `[amplitude (days), A₀ (deg), dA/dk (deg)]` for A₂…A₁₄. */
const PLANETARY_ARGUMENTS: readonly (readonly [number, number, number])[] = [
  [0.000165, 251.88, 0.016321],
  [0.000164, 251.83, 26.651886],
  [0.000126, 349.42, 36.412478],
  [0.00011, 84.66, 18.206239],
  [0.000062, 141.74, 53.303771],
  [0.00006, 207.14, 2.453732],
  [0.000056, 154.84, 7.30686],
  [0.000047, 34.52, 27.261239],
  [0.000042, 207.19, 0.121824],
  [0.00004, 291.34, 1.844379],
  [0.000037, 161.72, 24.198154],
  [0.000035, 239.56, 25.513099],
  [0.000023, 331.55, 3.592518],
]

function assertPhase(phase: unknown): asserts phase is MoonPhaseName | undefined {
  if (phase !== undefined && !PHASES.includes(phase as MoonPhaseName)) {
    throw new EphemerisError(
      'invalid_options',
      `phase must be one of ${PHASES.join(', ')}, got ${String(phase)}`,
    )
  }
}

/**
 * The first principal phase at or after `jde` (optionally only phases named
 * `phase`), via {@link moonPhaseTime}.
 *
 * @param jde Julian Ephemeris Day (TT) to search from.
 * @throws {EphemerisError} `invalid_time` outside the Julian-day domain;
 *   `invalid_options` for an unknown phase name.
 */
export function nextMoonPhase(jde: number, phase?: MoonPhaseName): MoonPhaseEvent {
  assertJulianDay(jde, 'Julian Ephemeris Day')
  assertPhase(phase)
  const offset = phase === undefined ? 0 : PHASES.indexOf(phase) / 4
  const step = phase === undefined ? 0.25 : 1
  // Corrections never exceed a day, so one lunation before the mean estimate is a safe start.
  let k = Math.floor((jde - PHASE_EPOCH) / SYNODIC_MONTH) - 1 + offset
  for (;;) {
    const time = moonPhaseTime(k)
    if (time >= jde) return { phase: phaseOfK(k), k, jde: time }
    k += step
  }
}

/**
 * Every principal phase with $\mathrm{start} \le \mathrm{JDE} < \mathrm{end}$,
 * in time order.
 *
 * @throws {EphemerisError} `invalid_time` outside the Julian-day domain;
 *   `invalid_options` if `end < start`, the range exceeds 10 000 years, or
 *   the phase name is unknown.
 */
export function moonPhases(
  startJde: number,
  endJde: number,
  phase?: MoonPhaseName,
): MoonPhaseEvent[] {
  assertJulianDay(startJde, 'start Julian Ephemeris Day')
  assertJulianDay(endJde, 'end Julian Ephemeris Day')
  assertPhase(phase)
  if (endJde < startJde || endJde - startJde > MAX_RANGE_DAYS) {
    throw new EphemerisError(
      'invalid_options',
      `need start ≤ end and a range of at most ${MAX_RANGE_DAYS} days, got [${startJde}, ${endJde})`,
    )
  }
  const events: MoonPhaseEvent[] = []
  if (endJde === startJde) return events
  const first = nextMoonPhase(startJde, phase)
  const step = phase === undefined ? 0.25 : 1
  for (let k = first.k; ; k += step) {
    const time = k === first.k ? first.jde : moonPhaseTime(k)
    if (time >= endJde) break
    events.push({ phase: phaseOfK(k), k, jde: time })
  }
  return events
}
