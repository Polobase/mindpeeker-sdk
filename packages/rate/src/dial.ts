import { assertBase, digitToAngle } from './angle.js'
import { RateError } from './errors.js'
import { DEFAULT_BASE, type DialConversion, type Rate } from './types.js'

/** Shortest signed angular distance $b - a$, wrapped to $(-\pi, \pi]$. */
function angleDelta(a: number, b: number): number {
  const d = b - a
  return Math.atan2(Math.sin(d), Math.cos(d))
}

/**
 * Re-express a rate in a different base by nearest-angle projection.
 *
 * Each digit's exact angle $\theta = d\,\tfrac{2\pi}{b_\text{src}}$ is snapped
 * to the closest target step:
 *
 * $$d' = \Big\lfloor d \cdot \frac{b_\text{tgt}}{b_\text{src}} + \tfrac12
 *        \Big\rfloor \bmod b_\text{tgt}$$
 *
 * The reported `maxErrorRad` is the largest $\big|\theta' - \theta\big|$ over
 * all digits (wrapped to $(-\pi,\pi]$). Because each digit rounds to the
 * nearest of $b_\text{tgt}$ equally-spaced steps, this is bounded by half a
 * target step, $\tfrac{\pi}{b_\text{tgt}}$. Converting to a *coarser* base
 * (e.g. base 44 → base 10) therefore loses angular resolution and reports a
 * larger error than the reverse.
 *
 * @throws {RateError} `invalid_base` if `targetBase` is not an integer $\geq 2$.
 */
export function convertBase(rate: Rate, targetBase: number): DialConversion {
  assertBase(targetBase)
  const digits: number[] = []
  let maxErrorRad = 0
  for (let i = 0; i < rate.digits.length; i++) {
    const d = rate.digits[i] as number
    const sourceAngle = digitToAngle(d, rate.base)
    const targetDigit = Math.round((d * targetBase) / rate.base) % targetBase
    const targetAngle = digitToAngle(targetDigit, targetBase)
    digits.push(targetDigit)
    const err = Math.abs(angleDelta(sourceAngle, targetAngle))
    if (err > maxErrorRad) maxErrorRad = err
  }
  return { rate: { digits, base: targetBase }, maxErrorRad }
}

export interface DialToBase44Options {
  /** Base of the incoming dial digits (default 10, De La Warr / Copen dials). */
  fromBase?: number
  /** Target base (default 44). */
  toBase?: number
}

/**
 * Convert a base-10 dial rate (De La Warr / Copen "0..9 per dial" sequences)
 * to Rae's base-44, reporting the rounding error.
 *
 * Historically Rae built the base-44 system to "increase the
 * selectivity/accuracy of the Base 10 system"; this function makes that
 * refinement explicit — it projects each dial position onto the finer 44-step
 * ring and tells you exactly how far each moved.
 *
 * @example
 * dialToBase44([1, 1, 1, 4, 8]) // De La Warr-style base-10 rate → base 44
 *
 * @throws {RateError} `invalid_rate` if a digit is out of range for `fromBase`.
 */
export function dialToBase44(
  dial: ArrayLike<number>,
  opts: DialToBase44Options = {},
): DialConversion {
  const fromBase = opts.fromBase ?? 10
  const toBase = opts.toBase ?? DEFAULT_BASE
  assertBase(fromBase)
  const digits: number[] = []
  for (let i = 0; i < dial.length; i++) {
    const d = dial[i] as number
    if (!Number.isInteger(d) || d < 0 || d >= fromBase) {
      throw new RateError('invalid_rate', `dial digit ${d} out of range [0, ${fromBase})`)
    }
    digits.push(d)
  }
  return convertBase({ digits, base: fromBase }, toBase)
}
