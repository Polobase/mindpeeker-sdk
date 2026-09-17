/** Boundary validation helpers: every failure is a {@link JudgingError}. */
import { JudgingError } from '../errors.js'

export function invalidInput(argument: string, message: string): never {
  throw new JudgingError('invalid_input', message, { argument })
}

export function invalidOptions(argument: string, message: string): never {
  throw new JudgingError('invalid_options', message, { argument })
}

export function tooLarge(argument: string, message: string): never {
  throw new JudgingError('too_large', message, { argument })
}

/** An options bag: `undefined` becomes `{}`; anything but a plain object throws. */
export function optionsObject<T extends object>(value: T | undefined, argument = 'options'): T {
  if (value === undefined) return {} as T
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalidOptions(argument, `${argument} must be an object`)
  }
  return value
}

/** A safe integer ≥ `min`. */
export function integerAtLeast(argument: string, value: unknown, min: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
    invalidInput(argument, `${argument} must be a safe integer ≥ ${min}, got ${String(value)}`)
  }
  return value
}

/** An option that must be an integer ≥ `min` (throws `invalid_options`). */
export function optionInteger(argument: string, value: unknown, min: number, max?: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    (max !== undefined && value > max)
  ) {
    const range = max === undefined ? `≥ ${min}` : `in [${min}, ${max}]`
    invalidOptions(argument, `${argument} must be an integer ${range}, got ${String(value)}`)
  }
  return value
}

/** An option in the open interval (0, 1). */
export function openUnit(argument: string, value: unknown): number {
  if (typeof value !== 'number' || !(value > 0 && value < 1)) {
    invalidOptions(argument, `${argument} must be a number in (0, 1), got ${String(value)}`)
  }
  return value
}

/** An option that must be one of the listed string labels. */
export function oneOf<T extends string>(
  argument: string,
  value: unknown,
  allowed: readonly T[],
): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    invalidOptions(
      argument,
      `${argument} must be one of ${allowed.map((a) => `'${a}'`).join(', ')}, got ${String(value)}`,
    )
  }
  return value as T
}

/** A dense array (or typed array) of numbers; returns a plain copy. */
export function numberArray(argument: string, value: unknown, minLength = 1): number[] {
  const isTyped = ArrayBuffer.isView(value) && !(value instanceof DataView)
  if (!Array.isArray(value) && !isTyped) {
    invalidInput(argument, `${argument} must be an array of numbers`)
  }
  const source = value as ArrayLike<unknown>
  if (source.length < minLength) {
    invalidInput(
      argument,
      `${argument} must hold at least ${minLength} value(s), got ${source.length}`,
    )
  }
  const out = new Array<number>(source.length)
  for (let i = 0; i < source.length; i++) {
    const item = source[i]
    if (typeof item !== 'number' || !Number.isFinite(item)) {
      invalidInput(
        `${argument}[${i}]`,
        `${argument}[${i}] must be a finite number, got ${String(item)}`,
      )
    }
    out[i] = item
  }
  return out
}

/** A rectangular numeric matrix with `rows ≥ minRows` rows; returns plain copies. */
export function numberMatrix(argument: string, value: unknown, minRows = 1): number[][] {
  if (!Array.isArray(value) || value.length < minRows) {
    invalidInput(argument, `${argument} must be an array of at least ${minRows} row(s)`)
  }
  const rows = (value as unknown[]).map((row, i) => numberArray(`${argument}[${i}]`, row))
  const width = (rows[0] as number[]).length
  rows.forEach((row, i) => {
    if (row.length !== width) {
      invalidInput(
        `${argument}[${i}]`,
        `${argument} must be rectangular: row ${i} has ${row.length} values, row 0 has ${width}`,
      )
    }
  })
  return rows
}
