import { NegentropyError } from '../errors.js'

/**
 * Boundary validation shared by the numerics, stats, and estimator layers.
 * Every helper throws `NegentropyError('invalid_config')` — never a
 * RangeError/TypeError — so callers can rely on the typed `code` union.
 */

/** Throw unless `value` is a finite number (rejects NaN, ±Infinity, non-numbers). */
export function assertFinite(value: number, name: string, source?: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new NegentropyError('invalid_config', `${name} must be a finite number, got ${value}`, {
      source,
    })
  }
}

/**
 * Throw unless `value` is a number other than NaN. ±Infinity passes — for the
 * special functions whose limits at infinity are exact (e.g. Q(a, ∞) = 0).
 */
export function assertNotNaN(value: number, name: string): void {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new NegentropyError('invalid_config', `${name} must be a number (not NaN), got ${value}`)
  }
}

/** Throw at the first non-finite element, naming its index. */
export function assertFiniteArray(values: ArrayLike<number>, name: string, source?: string): void {
  for (let i = 0; i < values.length; i++) {
    const value = values[i] as number
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new NegentropyError(
        'invalid_config',
        `${name}[${i}] must be a finite number, got ${value}`,
        { source },
      )
    }
  }
}

/**
 * Throw unless every element is exactly 0 or 1 — the bit-oriented estimators
 * take unpacked bits (see `toBits`), and packed bytes are the natural mistake.
 */
export function assertBits(bits: ArrayLike<number>, name: string): void {
  for (let i = 0; i < bits.length; i++) {
    const bit = bits[i]
    if (bit !== 0 && bit !== 1) {
      throw new NegentropyError(
        'invalid_config',
        `${name} expects 0/1 bits (unpack bytes with toBits), got ${bit} at index ${i}`,
      )
    }
  }
}
