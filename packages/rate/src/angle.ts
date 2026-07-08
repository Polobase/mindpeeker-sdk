import { RateError } from './errors.js'
import { type Rate, TAU } from './types.js'

/** Radians → degrees. */
export function radiansToDegrees(rad: number): number {
  return (rad * 180) / Math.PI
}

/** Degrees → radians. */
export function degreesToRadians(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * Validate that `base` is a usable radionic base: an integer $\geq 2$.
 *
 * @throws {RateError} `invalid_base` otherwise.
 */
export function assertBase(base: number): void {
  if (!Number.isInteger(base) || base < 2) {
    throw new RateError('invalid_base', `base must be an integer >= 2, got ${base}`)
  }
}

/**
 * Map a rate digit to its angular position on the ring.
 *
 * $$\theta_d = d \cdot \frac{2\pi}{b}, \qquad d \in \{0, 1, \dots, b-1\}$$
 *
 * This is the group homomorphism $\mathbb{Z}_b \to S^1$ Rae's cards realise
 * as radial lines around a circle. For the canonical base $b = 44$ the step is
 * $\tfrac{2\pi}{44} = \tfrac{\pi}{22}$ (≈ 8.18°), and e.g. digit 11 lands at
 * $\theta_{11} = \tfrac{\pi}{2}$ in real arithmetic (to within 1 ulp as a
 * float — compare with a tolerance, not `===`). That is three o'clock under
 * the card convention {@link cardSvg} uses ($\theta = 0$ up, increasing
 * clockwise) and twelve o'clock under the mathematical convention (CCW from
 * the +x axis).
 *
 * @param digit integer in $[0, \mathrm{base})$
 * @param base radionic base (default 44)
 * @returns angle in radians, in $[0, 2\pi)$
 * @throws {RateError} `invalid_base` or `invalid_rate`
 */
export function digitToAngle(digit: number, base = 44): number {
  assertBase(base)
  if (!Number.isInteger(digit) || digit < 0 || digit >= base) {
    throw new RateError('invalid_rate', `digit ${digit} out of range [0, ${base})`)
  }
  return (digit * TAU) / base
}

/**
 * Same as {@link digitToAngle} but in degrees: $\theta_d = d \cdot
 * \tfrac{360}{b}$. For base 44 the step is exactly $\tfrac{360}{44} =
 * \tfrac{90}{11} \approx 8.1818°$.
 */
export function digitToDegrees(digit: number, base = 44): number {
  return radiansToDegrees(digitToAngle(digit, base))
}

/**
 * The per-ring phase vector of a whole rate: $\theta_j = \mathrm{digit}_j
 * \cdot \tfrac{2\pi}{b}$ for each digit $j$, one entry per ring.
 *
 * @returns a `Float64Array` of radians, length = `rate.digits.length`
 * @throws {RateError} if any digit is out of range
 */
export function ratePhases(rate: Rate): Float64Array {
  const out = new Float64Array(rate.digits.length)
  for (let i = 0; i < rate.digits.length; i++) {
    out[i] = digitToAngle(rate.digits[i] as number, rate.base)
  }
  return out
}
