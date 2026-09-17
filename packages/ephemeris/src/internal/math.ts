import { EphemerisError } from '../errors.js'

/** Degrees → radians. */
export const RAD = Math.PI / 180

/** Julian day of the standard epoch J2000.0 (2000 January 1, 12h TT). */
export const J2000 = 2451545.0

/** Days per Julian century. */
export const DAYS_PER_CENTURY = 36525

/** Smallest Julian day accepted anywhere: JD 0 = −4712 January 1, 12h (Julian calendar). */
export const JD_MIN = 0

/** Largest Julian day accepted anywhere: JD 10⁷ ≈ AD 22 666 — far beyond every formula's accuracy. */
export const JD_MAX = 1e7

/** Floored modulo into $[0, m)$ (never returns `m` itself). */
export function mod(x: number, m: number): number {
  const r = ((x % m) + m) % m
  return r === m ? 0 : r
}

/** Horner evaluation of $c_0 + c_1 x + c_2 x^2 + \dots$. */
export function horner(x: number, coefficients: readonly number[]): number {
  let acc = 0
  for (let i = coefficients.length - 1; i >= 0; i--) acc = acc * x + (coefficients[i] as number)
  return acc
}

/** Sine of an angle in degrees. */
export function sind(deg: number): number {
  return Math.sin(deg * RAD)
}

/** Cosine of an angle in degrees. */
export function cosd(deg: number): number {
  return Math.cos(deg * RAD)
}

/** Throw `invalid_input` unless `value` is a finite number. */
export function assertFinite(value: unknown, what: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new EphemerisError(
      'invalid_input',
      `${what} must be a finite number, got ${String(value)}`,
    )
  }
}

/**
 * Throw `invalid_time` unless `jd` is a finite Julian day in
 * $[0, 10^7]$. The bound also catches the common slip of passing Unix
 * milliseconds or seconds where a Julian day is expected.
 */
export function assertJulianDay(jd: unknown, what = 'Julian day'): asserts jd is number {
  if (typeof jd !== 'number' || !Number.isFinite(jd) || jd < JD_MIN || jd > JD_MAX) {
    const hint =
      typeof jd === 'number' && jd > JD_MAX
        ? ' (numbers are Julian days; pass a Date for Unix time)'
        : ''
    throw new EphemerisError(
      'invalid_time',
      `${what} must be a finite number in [${JD_MIN}, ${JD_MAX}], got ${String(jd)}${hint}`,
    )
  }
}

/** Julian centuries of TT (or UT, as the caller documents) since J2000.0. */
export function centuries(jd: number): number {
  return (jd - J2000) / DAYS_PER_CENTURY
}
