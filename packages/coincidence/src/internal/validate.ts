/**
 * Boundary validation. Every public function checks its arguments here before
 * computing anything and throws `CoincidenceError('invalid_input')` naming the
 * argument.
 */
import { CoincidenceError } from '../errors.js'

function describe(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value)
  }
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return typeof value
}

function fail(argument: string, expectation: string, value: unknown): never {
  throw new CoincidenceError(
    'invalid_input',
    `${argument} must be ${expectation}, got ${describe(value)}`,
    { argument },
  )
}

/** A non-negative safe integer (counts of draws, people, distances). */
export function nonNegativeInteger(argument: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return fail(argument, 'a non-negative safe integer', value)
  }
  return value
}

/** A positive safe integer (category counts, fold sizes). */
export function positiveInteger(argument: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    return fail(argument, 'a positive safe integer', value)
  }
  return value
}

/** A finite number > 0. */
export function positiveFinite(argument: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !(value > 0)) {
    return fail(argument, 'a finite number > 0', value)
  }
  return value
}

/** A finite number ≥ 0. */
export function nonNegativeFinite(argument: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !(value >= 0)) {
    return fail(argument, 'a finite number ≥ 0', value)
  }
  return value
}

/** A finite number. */
export function finiteNumber(argument: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail(argument, 'a finite number', value)
  }
  return value
}

/** A probability in [0, 1]. */
export function probability(argument: string, value: unknown): number {
  if (typeof value !== 'number' || !(value >= 0 && value <= 1)) {
    return fail(argument, 'a probability in [0, 1]', value)
  }
  return value
}

/** A target probability in (0, 1] — the domain of every `peopleFor…` inversion. */
export function targetProbability(argument: string, value: unknown): number {
  if (typeof value !== 'number' || !(value > 0 && value <= 1)) {
    return fail(argument, 'a probability in (0, 1]', value)
  }
  return value
}

/** `undefined` or a plain options object. */
export function optionsObject<T extends object>(argument: string, value: unknown): Partial<T> {
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail(argument, 'an options object', value)
  }
  return value as Partial<T>
}

/** Relative tolerance on Σp = 1 for probability vectors. */
export const PROBABILITY_SUM_TOLERANCE = 1e-9

/**
 * A non-empty vector of finite non-negative probabilities summing to 1
 * within {@link PROBABILITY_SUM_TOLERANCE}. Returns a fresh copy.
 */
export function probabilityVector(argument: string, value: unknown): number[] {
  if (!Array.isArray(value) && !(value instanceof Float64Array)) {
    return fail(argument, 'an array of probabilities', value)
  }
  const out: number[] = []
  let sum = 0
  for (let i = 0; i < value.length; i++) {
    const p: unknown = value[i]
    if (typeof p !== 'number' || !(p >= 0 && p <= 1)) {
      return fail(`${argument}[${i}]`, 'a probability in [0, 1]', p)
    }
    out.push(p)
    sum += p
  }
  if (out.length === 0) return fail(argument, 'a non-empty array of probabilities', value)
  if (!(Math.abs(sum - 1) <= PROBABILITY_SUM_TOLERANCE)) {
    throw new CoincidenceError(
      'invalid_input',
      `${argument} must sum to 1 (within ${PROBABILITY_SUM_TOLERANCE}), got ${sum}; ` +
        'use probabilitiesFromCounts() for a histogram',
      { argument },
    )
  }
  return out
}

/** A non-empty array of positive safe integers (category counts per attribute). */
export function categoryList(argument: string, value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    return fail(argument, 'a non-empty array of category counts', value)
  }
  return value.map((c, i) => positiveInteger(`${argument}[${i}]`, c))
}
