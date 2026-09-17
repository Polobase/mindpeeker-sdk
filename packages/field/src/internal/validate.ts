import { FieldError } from '../errors.js'

/** Reject `null` / non-object option bags at the public boundary. */
export function checkOptions(opts: unknown, fn: string): void {
  if (opts === null || typeof opts !== 'object') {
    throw new FieldError('invalid_config', `${fn} options must be an object`)
  }
}

/** A finite number > 0. */
export function checkPositive(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new FieldError('invalid_config', `${name} must be finite and > 0, got ${String(value)}`)
  }
  return value
}

/** An integer in [min, max]. */
export function checkInteger(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new FieldError(
      'invalid_config',
      `${name} must be an integer in [${min}, ${max}], got ${String(value)}`,
    )
  }
  return value
}

/** Monte-Carlo run count: an integer in [1, 10⁶]. */
export function checkRuns(value: unknown): number {
  return checkInteger(value, 'runs', 1, 1_000_000)
}

/** A non-empty array of finite radii ≥ 0. */
export function checkRadii(radii: readonly number[]): Float64Array {
  if (!Array.isArray(radii) && !ArrayBuffer.isView(radii)) {
    throw new FieldError('invalid_config', 'radii must be an array of numbers')
  }
  if (radii.length === 0) {
    throw new FieldError('invalid_config', 'radii must not be empty')
  }
  const out = new Float64Array(radii.length)
  for (let k = 0; k < radii.length; k++) {
    const r = radii[k]
    if (typeof r !== 'number' || !Number.isFinite(r) || r < 0) {
      throw new FieldError('invalid_config', `radii must be finite and ≥ 0, got ${String(r)}`)
    }
    out[k] = r
  }
  return out
}

/** An optional AbortSignal. */
export function checkSignal(signal: unknown): AbortSignal | undefined {
  if (signal === undefined) return undefined
  if (
    signal === null ||
    typeof signal !== 'object' ||
    typeof (signal as AbortSignal).aborted !== 'boolean' ||
    typeof (signal as AbortSignal).addEventListener !== 'function'
  ) {
    throw new FieldError('invalid_config', 'signal must be an AbortSignal')
  }
  return signal as AbortSignal
}
