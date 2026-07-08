import { assertBase } from './angle.js'
import { RateError } from './errors.js'
import { DEFAULT_BASE, type Rate } from './types.js'

export interface ParseRateOptions {
  /** Base to validate digits against (default 44). */
  base?: number
  /**
   * Treat the parsed digits as one-based labels (Rae's rate books use 1..44)
   * and subtract one so they land in the canonical $[0, \mathrm{base})$ range.
   * Default `false`.
   */
  oneBased?: boolean
}

export interface FormatRateOptions {
  /** Separator between digits (default `'-'`). */
  separator?: string
  /**
   * Zero-pad each digit to the width of the largest digit `base - 1`
   * (e.g. base 44 → 2 chars, `7` → `'07'`). Default `false`.
   */
  pad?: boolean
  /** Emit one-based labels (add one to every digit). Default `false`. */
  oneBased?: boolean
}

const DIGIT = /^\d+$/

/**
 * Parse a radionic rate string into a {@link Rate}.
 *
 * Accepts dash- or dot-separated digit groups — `'12-33-7'` and `'12.33.7'`
 * are equivalent — plus a single bare digit (`'7'`). Validation is strict:
 * every group must be a non-negative integer literal, and every digit must lie
 * in $[0, \mathrm{base})$ (or $[1, \mathrm{base}]$ with `oneBased`). Mixed
 * separators, empty groups, signs, decimals, and out-of-range digits all raise
 * `RateError('invalid_rate')`.
 *
 * @example
 * parseRate('12-33-7')                    // digits [12, 33, 7], base 44
 * parseRate('12.33.7', { base: 44 })      // same rate, dot form
 * parseRate('01-44', { oneBased: true })  // Rae book labels → digits [0, 43]
 *
 * @throws {RateError} `invalid_rate` on any malformed input; `invalid_base`
 *   if `opts.base` is not an integer $\geq 2$.
 */
export function parseRate(input: string, opts: ParseRateOptions = {}): Rate {
  const base = opts.base ?? DEFAULT_BASE
  assertBase(base)
  if (typeof input !== 'string' || input.length === 0) {
    throw new RateError('invalid_rate', 'rate string is empty', { input: String(input) })
  }
  const hasDash = input.includes('-')
  const hasDot = input.includes('.')
  if (hasDash && hasDot) {
    throw new RateError('invalid_rate', `mixed separators in "${input}"`, { input })
  }
  const sep = hasDash ? '-' : hasDot ? '.' : ''
  const groups = sep === '' ? [input] : input.split(sep)
  const digits: number[] = []
  for (const group of groups) {
    if (!DIGIT.test(group)) {
      throw new RateError('invalid_rate', `"${group}" is not a digit group in "${input}"`, {
        input,
      })
    }
    let d = Number.parseInt(group, 10)
    if (opts.oneBased) d -= 1
    if (d < 0 || d >= base) {
      throw new RateError('invalid_rate', `digit ${group} out of range for base ${base}`, {
        input,
      })
    }
    digits.push(d)
  }
  return { digits, base }
}

/**
 * Render a {@link Rate} back to a string. Inverse of {@link parseRate} under
 * matching options.
 *
 * @example
 * formatRate({ digits: [12, 33, 7], base: 44 })                 // '12-33-7'
 * formatRate({ digits: [0, 42], base: 44 }, { pad: true, separator: ' ' })
 *   // '00 42'
 * formatRate({ digits: [0, 43], base: 44 }, { oneBased: true }) // '1-44'
 */
export function formatRate(rate: Rate, opts: FormatRateOptions = {}): string {
  const sep = opts.separator ?? '-'
  // Pad to the width of the largest label actually emitted: base-1 for 0-based
  // output, base for oneBased (labels run 1..base, so base is the widest).
  const maxLabel = opts.oneBased ? rate.base : rate.base - 1
  const width = opts.pad ? String(maxLabel).length : 0
  return rate.digits
    .map((d) => {
      const value = opts.oneBased ? d + 1 : d
      const s = String(value)
      return width > 0 ? s.padStart(width, '0') : s
    })
    .join(sep)
}
