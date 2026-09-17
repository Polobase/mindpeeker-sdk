/**
 * @mindpeeker/ephemeris — exact time and low-precision sky coordinates
 * (Meeus 1998, USNO) plus Spottiswoode's local-sidereal-time window scan
 * with honest permutation nulls. Zero dependencies, browser-safe.
 */

export { normalizeDegrees, normalizeHours, toSexagesimal } from './angles.js'
export { EphemerisError, type EphemerisErrorCode, type EphemerisErrorOptions } from './errors.js'
export type { Seed } from './internal/prng.js'
export { lstPermutationTest, lstWindowScan } from './lst-scan.js'
export { lstWindowTest } from './lst-window.js'
export { moonPosition } from './moon.js'
export { meanObliquity, nutation } from './nutation.js'
export { moonIllumination, moonPhases, moonPhaseTime, nextMoonPhase } from './phase.js'
export {
  equationOfTheEquinoxes,
  gast,
  gmst,
  type LstOptions,
  localMeanSolarTime,
  lst,
} from './sidereal.js'
export { equationOfTime, sunPosition } from './sun.js'
export {
  dateFromJulianDay,
  decimalYear,
  deltaT,
  julianCenturies,
  julianDay,
  julianDayToDate,
  julianEphemerisDay,
  UNIX_EPOCH_JD,
  universalJulianDay,
} from './time.js'
export type {
  CalendarDate,
  CalendarDateTime,
  CalendarOptions,
  CalendarSystem,
  LstGroup,
  LstLabelledTrial,
  LstPeak,
  LstPermutationOptions,
  LstPermutationResult,
  LstScanOptions,
  LstScanResult,
  LstTimedTrial,
  LstTrial,
  LstWindow,
  LstWindowTestOptions,
  LstWindowTestResult,
  MoonIllumination,
  MoonPhaseEvent,
  MoonPhaseName,
  MoonPosition,
  Nutation,
  Sexagesimal,
  SunPosition,
} from './types.js'
