/** Machine-readable failure categories of `@mindpeeker/field`. */
export type FieldErrorCode =
  | 'invalid_config' // caller error: bad count, region, radius, or radii
  | 'insufficient_data' // fewer points/entropy than the statistic requires
  | 'aborted' // caller's AbortSignal fired (re-thrown from the oracle byte reader)

export interface FieldErrorOptions {
  cause?: unknown
}

/**
 * The one error class every throwing path in this package uses. `code` is the
 * stable machine-readable contract; `message` is for humans and may change.
 */
export class FieldError extends Error {
  readonly code: FieldErrorCode
  declare readonly cause?: unknown

  constructor(code: FieldErrorCode, message: string, opts: FieldErrorOptions = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined)
    this.name = 'FieldError'
    this.code = code
  }
}

/** Re-map an oracle error onto this package's codes (the sampling seam). */
export function rethrowOracle(error: unknown): never {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code
    if (code === 'aborted') {
      throw new FieldError('aborted', 'field sampling aborted', { cause: error })
    }
    if (code === 'insufficient_entropy') {
      throw new FieldError(
        'insufficient_data',
        'entropy source ended before the field was filled',
        {
          cause: error,
        },
      )
    }
  }
  throw error
}
