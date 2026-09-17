import type { Seed } from './internal/prng.js'

/**
 * Which calendar a {@link CalendarDate} is written in.
 *
 * - `'auto'` — the historical switch: Julian calendar up to 1582 October 4,
 *   Gregorian from 1582 October 15 (the ten days between do not exist).
 * - `'gregorian'` — proleptic Gregorian for every year (what `Date` uses).
 * - `'julian'` — proleptic Julian for every year.
 */
export type CalendarSystem = 'auto' | 'gregorian' | 'julian'

/**
 * A calendar date and time of day. Years are astronomical: year 0 = 1 BC,
 * year −1 = 2 BC. `day` may carry a fraction (Meeus writes 1957 October 4.81);
 * the time fields are added on top of it.
 */
export interface CalendarDate {
  readonly year: number
  /** 1–12. */
  readonly month: number
  /** 1–31, may be fractional. */
  readonly day: number
  /** 0–24, default 0. */
  readonly hour?: number
  /** 0–60, default 0. */
  readonly minute?: number
  /** 0–61 (a leap second is accepted, not represented), default 0. */
  readonly second?: number
}

/** Options shared by the calendar conversions. */
export interface CalendarOptions {
  /** Default `'auto'` (Julian before 1582 October 15, Gregorian from then on). */
  readonly calendar?: CalendarSystem
}

/** A calendar date with an integer day, as returned by {@link dateFromJulianDay}. */
export interface CalendarDateTime {
  readonly year: number
  readonly month: number
  /** Integer day of the month. */
  readonly day: number
  readonly hour: number
  readonly minute: number
  /** Seconds, rounded to 0.1 ms. */
  readonly second: number
  /** The calendar the fields are written in. */
  readonly calendar: 'gregorian' | 'julian'
}

/** An hour angle or time split into sexagesimal parts; `sign` is −1 for negative input. */
export interface Sexagesimal {
  readonly sign: 1 | -1
  readonly whole: number
  readonly minutes: number
  readonly seconds: number
}

/** Nutation and obliquity of the ecliptic, all in degrees. */
export interface Nutation {
  /** Nutation in longitude $\Delta\psi$. */
  readonly longitude: number
  /** Nutation in obliquity $\Delta\varepsilon$. */
  readonly obliquity: number
  /** Mean obliquity $\varepsilon_0$ (Meeus 22.2). */
  readonly meanObliquity: number
  /** True obliquity $\varepsilon = \varepsilon_0 + \Delta\varepsilon$. */
  readonly trueObliquity: number
}

/** Geocentric position of the Sun (Meeus ch. 25, low accuracy). Angles in degrees. */
export interface SunPosition {
  /** Apparent ecliptic longitude $\lambda$ (true equinox of date, with aberration). */
  readonly longitude: number
  /** True geometric longitude $\odot$ (mean equinox of date). */
  readonly trueLongitude: number
  /** Geometric mean longitude $L_0$ (Meeus 25.2). */
  readonly meanLongitude: number
  /** Mean anomaly $M$ in $[0, 360)$. */
  readonly meanAnomaly: number
  /** Earth–Sun distance $R$ in astronomical units. */
  readonly distanceAu: number
  /** Apparent right ascension $\alpha$ in $[0, 360)$. */
  readonly rightAscension: number
  /** Apparent declination $\delta$. */
  readonly declination: number
  /** Obliquity used for $\alpha, \delta$: $\varepsilon_0 + 0.00256° \cos\Omega$. */
  readonly obliquity: number
}

/** Geocentric position of the Moon (Meeus ch. 47). Angles in degrees. */
export interface MoonPosition {
  /** Apparent ecliptic longitude $\lambda + \Delta\psi$ (true equinox of date). */
  readonly longitude: number
  /** Ecliptic latitude $\beta$. */
  readonly latitude: number
  /** Geometric longitude $\lambda$ referred to the mean equinox of date. */
  readonly meanEquinoxLongitude: number
  /** Distance between the centres of Earth and Moon in km. */
  readonly distanceKm: number
  /** Equatorial horizontal parallax $\pi = \arcsin(6378.14 / \Delta)$. */
  readonly horizontalParallax: number
  /** Apparent right ascension in $[0, 360)$. */
  readonly rightAscension: number
  /** Apparent declination. */
  readonly declination: number
}

/** Illumination of the Moon's disk (Meeus ch. 48). Angles in degrees. */
export interface MoonIllumination {
  /** Selenocentric elongation of the Earth from the Sun, the phase angle $i$ in $[0, 180]$. */
  readonly phaseAngle: number
  /** Illuminated fraction $k = (1 + \cos i)/2$. */
  readonly illuminatedFraction: number
  /** Geocentric elongation $\psi$ of the Moon from the Sun in $[0, 180]$. */
  readonly elongation: number
  /**
   * Apparent longitude of the Moon minus that of the Sun in $[0, 360)$:
   * 0 new, 90 first quarter, 180 full, 270 last quarter (the quantity
   * {@link moonPhaseTime} solves for).
   */
  readonly longitudeFromSun: number
  /** Position angle $\chi$ of the bright limb, measured from north through east, in $[0, 360)$. */
  readonly brightLimbAngle: number
  /** `true` while `longitudeFromSun` is below 180 (between new and full moon). */
  readonly waxing: boolean
}

/** The four principal phases of the Moon. */
export type MoonPhaseName = 'new' | 'firstQuarter' | 'full' | 'lastQuarter'

/** One principal phase: its lunation number `k` and the instant in TT. */
export interface MoonPhaseEvent {
  readonly phase: MoonPhaseName
  /** Meeus' $k$: integer for new moons (k = 0 is 2000 January 6), +0.25 / +0.5 / +0.75 for the others. */
  readonly k: number
  /** Julian Ephemeris Day (TT) of the phase. */
  readonly jde: number
}

/** A trial stamped with a time and place; its LST is computed with {@link lst}. */
export interface LstTimedTrial {
  /** A `Date`, or a Julian day (UT) as a number. */
  readonly time: Date | number
  /** Longitude of the receiver in degrees, east positive. */
  readonly longitudeEastDeg: number
  /** Per-trial effect size (any finite real; larger = better). */
  readonly effect: number
  /**
   * Optional permutation stratum (study, laboratory, clock-hour bin, season):
   * effects are only exchanged between trials of the same stratum. Give it on
   * every trial or on none.
   */
  readonly stratum?: string | number
}

/** A trial whose local sidereal time is already known (e.g. from another ephemeris). */
export interface LstLabelledTrial {
  /** Local sidereal time in hours, $[0, 24)$. */
  readonly lstHours: number
  /** Per-trial effect size. */
  readonly effect: number
  /** Optional permutation stratum (see {@link LstTimedTrial.stratum}). */
  readonly stratum?: string | number
}

/** One trial for the LST analyses: either timed or already LST-labelled. */
export type LstTrial = LstTimedTrial | LstLabelledTrial

/** Options of {@link lstWindowScan}. */
export interface LstScanOptions {
  /** Full width of the boxcar window in hours, $(0, 24]$. Default 2 (Spottiswoode 1997). */
  readonly windowHours?: number
  /** Spacing of window centres in hours; must divide 24. Default 0.1 (240 windows). */
  readonly stepHours?: number
  /**
   * Pad the data with copies shifted by ±24 h so windows wrap around the
   * sidereal day (Spottiswoode's procedure). Default `true`; `false` truncates
   * windows at 0 h and 24 h.
   */
  readonly pad?: boolean
  /** Windows with fewer trials are reported but never chosen as the peak. Default 1. */
  readonly minTrials?: number
  /** LST from GMST (`'mean'`, default) or GAST (`'apparent'`) for timed trials. */
  readonly sidereal?: 'mean' | 'apparent'
}

/** One boxcar window of the scan. */
export interface LstWindow {
  /** Window centre in hours; the window is $[c - w/2,\ c + w/2)$. */
  readonly centerHours: number
  /** Trials inside the window (padded copies included). */
  readonly n: number
  /** Mean effect inside the window, `null` when empty. */
  readonly mean: number | null
  /** Sample standard deviation of the effects inside ($n - 1$ denominator), `null` for n < 2. */
  readonly sd: number | null
  /** `sd / √n`, `null` for n < 2. */
  readonly standardError: number | null
}

/** The window with the largest mean effect, and the shape of the peak around it. */
export interface LstPeak {
  readonly centerHours: number
  readonly mean: number
  readonly n: number
  /** `mean / overallMean` (Spottiswoode's "gain"), `null` unless the overall mean is positive. */
  readonly gain: number | null
  /**
   * Centroid of the contiguous run of windows around the peak whose mean is
   * at least halfway between the overall mean and the peak mean, weighted by
   * the excess over that half level. Equal to `centerHours` when the peak does
   * not rise above the overall mean. An operationalisation: the 1997 paper
   * names a centroid of "the upper half of the peak" without a formula.
   */
  readonly centroidHours: number
  /** Half the width of that run in hours (`run windows × step / 2`); 12 if it covers the whole day. */
  readonly halfWidthHours: number
}

/** Result of {@link lstWindowScan}. */
export interface LstScanResult {
  /** Number of trials (without padding copies). */
  readonly n: number
  /** Mean effect of all trials. */
  readonly overallMean: number
  /** One entry per window centre, in centre order. */
  readonly windows: readonly LstWindow[]
  readonly peak: LstPeak
  /** The resolved options. */
  readonly options: Required<LstScanOptions>
}

/** Options of {@link lstPermutationTest}. */
export interface LstPermutationOptions extends LstScanOptions {
  /** Number of random relabelings $m$. Default 9999; integer in $[1, 10^7]$. */
  readonly permutations?: number
  /** PRNG seed — state it in the pre-registration. Default 0. */
  readonly seed?: Seed
}

/** Result of {@link lstPermutationTest}. */
export interface LstPermutationResult {
  /** The scan of the observed data. */
  readonly scan: LstScanResult
  /** Observed statistic: the largest window mean over all admissible windows (`scan.peak.mean`). */
  readonly statistic: number
  readonly permutations: number
  /** Relabelings whose largest window mean was ≥ the observed one ($b$). */
  readonly exceedances: number
  /** Add-one Monte Carlo p-value $(1 + b)/(1 + m)$, valid for any $m$. */
  readonly pValue: number
  /** `true` when effects were exchanged only within strata. */
  readonly stratified: boolean
  /** Number of strata (1 when unstratified). */
  readonly strata: number
}

/** Options of {@link lstWindowTest}. */
export interface LstWindowTestOptions {
  /** Pre-registered window centre in hours, $[0, 24)$. */
  readonly centerHours: number
  /** Pre-registered half width in hours, $(0, 12)$; the window is $[c - h,\ c + h)$ on the circle. */
  readonly halfWidthHours: number
  /** Number of random relabelings. Default 9999. */
  readonly permutations?: number
  /** PRNG seed. Default 0. */
  readonly seed?: Seed
  /** LST from GMST (`'mean'`, default) or GAST (`'apparent'`) for timed trials. */
  readonly sidereal?: 'mean' | 'apparent'
}

/** Mean effect of a group of trials. */
export interface LstGroup {
  readonly n: number
  readonly mean: number
}

/** Result of {@link lstWindowTest}. */
export interface LstWindowTestResult {
  readonly centerHours: number
  readonly halfWidthHours: number
  readonly inside: LstGroup
  readonly outside: LstGroup
  readonly overallMean: number
  /** `inside.mean − outside.mean`, the test statistic. */
  readonly difference: number
  /** `inside.mean / overallMean`, `null` unless the overall mean is positive. */
  readonly gain: number | null
  readonly permutations: number
  /** Relabelings with a difference ≥ the observed one. */
  readonly exceedances: number
  /** One-sided add-one p-value $(1 + b)/(1 + m)$ for "the window is higher". */
  readonly pValue: number
  readonly stratified: boolean
  readonly strata: number
}
