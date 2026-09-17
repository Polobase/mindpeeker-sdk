import { assertBase, type Rate, ratePhases } from '@mindpeeker/rate'
import { ScanError, type ScanErrorCode } from '../errors.js'

/** Structural test for a {@link Rate}-shaped object (validity is checked by {@link frozenRate}). */
export function isRateLike(x: unknown): x is Rate {
  return (
    typeof x === 'object' &&
    x !== null &&
    Array.isArray((x as Rate).digits) &&
    typeof (x as Rate).base === 'number'
  )
}

/**
 * Validate a rate with `@mindpeeker/rate`'s own checks — base an integer ≥ 2,
 * at least one digit, every digit an integer in `[0, base)` — and return a
 * deeply frozen defensive copy (the caller's object is never frozen or kept).
 *
 * @throws {ScanError} with `code`, the `RateError` as `cause`
 */
export function frozenRate(rate: unknown, code: ScanErrorCode, what: string): Rate {
  if (!isRateLike(rate)) {
    throw new ScanError(code, `${what} must be a Rate { digits, base }`)
  }
  if (rate.digits.length === 0) {
    throw new ScanError(code, `${what} has no digits`)
  }
  try {
    assertBase(rate.base)
    ratePhases(rate)
  } catch (cause) {
    const detail = cause instanceof Error ? `: ${cause.message}` : ''
    throw new ScanError(code, `${what} is not a valid rate${detail}`, { cause })
  }
  return Object.freeze({ digits: Object.freeze([...rate.digits]), base: rate.base })
}
