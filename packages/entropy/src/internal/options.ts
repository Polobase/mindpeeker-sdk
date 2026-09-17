import { EntropyError } from '../errors.js'

/**
 * Largest accepted `timeoutMs`: timers above 2³¹ − 1 ms overflow in Node
 * (`setTimeout` fires after 1 ms), so larger budgets are rejected rather than
 * silently collapsing to an immediate timeout.
 */
export const MAX_TIMEOUT_MS = 2 ** 31 - 1

function invalid(message: string, provider?: string): EntropyError {
  return new EntropyError('invalid_request', message, { provider })
}

/** Require a safe integer ≥ `min`; throws `EntropyError('invalid_request')`. */
export function requireInteger(
  value: unknown,
  name: string,
  min: number,
  provider?: string,
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
    throw invalid(`${name} must be an integer >= ${min}, got ${String(value)}`, provider)
  }
  return value
}

/** Require a finite number within [min, max] (both inclusive). */
export function requireFinite(
  value: unknown,
  name: string,
  range: { min?: number; max?: number; minExclusive?: boolean },
  provider?: string,
): number {
  const {
    min = Number.NEGATIVE_INFINITY,
    max = Number.POSITIVE_INFINITY,
    minExclusive = false,
  } = range
  const aboveMin = typeof value === 'number' && (minExclusive ? value > min : value >= min)
  if (typeof value !== 'number' || !Number.isFinite(value) || !aboveMin || value > max) {
    const lower = minExclusive ? `> ${min}` : `>= ${min}`
    const upper = Number.isFinite(max) ? ` and <= ${max}` : ''
    throw invalid(
      `${name} must be a finite number ${lower}${upper}, got ${String(value)}`,
      provider,
    )
  }
  return value
}

/** Require a timeout budget: finite, 0 < ms ≤ 2³¹ − 1. */
export function requireTimeoutMs(value: unknown, name: string, provider?: string): number {
  return requireFinite(value, name, { min: 0, minExclusive: true, max: MAX_TIMEOUT_MS }, provider)
}

/** Require one of a fixed set of string literals. */
export function requireOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string,
  provider?: string,
): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw invalid(
      `${name} must be one of ${allowed.map((a) => `'${a}'`).join(' | ')}, got ${String(value)}`,
      provider,
    )
  }
  return value as T
}

/**
 * Require a min-entropy credit in bits per raw sample byte: finite,
 * 0 < H ≤ 8 (a byte cannot carry more than 8 bits of min-entropy).
 */
export function requireEntropyPerByte(value: unknown, name: string, provider?: string): number {
  return requireFinite(value, name, { min: 0, minExclusive: true, max: 8 }, provider)
}

/** Require a non-empty string (API keys, tokens, ids). */
export function requireNonEmptyString(value: unknown, name: string, provider?: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid(`${name} must be a non-empty string`, provider)
  }
  return value
}
