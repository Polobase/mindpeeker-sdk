import { assertFinite, mod } from './internal/math.js'
import type { Sexagesimal } from './types.js'

/**
 * Reduce an angle to $[0, 360)$ degrees.
 *
 * @throws {EphemerisError} `invalid_input` for a non-finite angle.
 */
export function normalizeDegrees(degrees: number): number {
  assertFinite(degrees, 'angle')
  return mod(degrees, 360)
}

/**
 * Reduce a time of day or hour angle to $[0, 24)$ hours.
 *
 * @throws {EphemerisError} `invalid_input` for a non-finite value.
 */
export function normalizeHours(hours: number): number {
  assertFinite(hours, 'hours')
  return mod(hours, 24)
}

/**
 * Split hours (or degrees) into whole units, minutes and seconds by
 * truncation: `toSexagesimal(13.1796)` → `{ sign: 1, whole: 13, minutes: 10,
 * seconds: 46.56 }`. Seconds keep their fraction; nothing is rounded, so
 * `seconds < 60` always holds.
 *
 * @throws {EphemerisError} `invalid_input` for a non-finite value.
 */
export function toSexagesimal(value: number): Sexagesimal {
  assertFinite(value, 'value')
  const sign = value < 0 ? -1 : 1
  const abs = Math.abs(value)
  const whole = Math.floor(abs)
  const totalSeconds = (abs - whole) * 3600
  const minutes = Math.min(59, Math.floor(totalSeconds / 60))
  // (abs − whole) < 1, but its product with 3600 can round up to 3600 exactly: stay below 60.
  const seconds = Math.min(totalSeconds - minutes * 60, 60 - 60 * Number.EPSILON)
  return { sign, whole, minutes, seconds }
}
