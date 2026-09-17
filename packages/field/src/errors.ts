/**
 * Machine-readable failure categories of `@mindpeeker/field`.
 *
 * - `invalid_config` — caller error: bad count, region, radius, radii, runs,
 *   points (non-finite or outside the region), options, or an input that is
 *   not a byte source (oracle `invalid_input` maps here)
 * - `insufficient_data` — fewer points than the statistic requires, or a
 *   degenerate pattern (e.g. a singular KDE covariance)
 * - `insufficient_entropy` — a finite entropy input ended before the draw
 *   completed (kept verbatim from the oracle byte reader; 0.1 relabelled it
 *   `insufficient_data`)
 * - `aborted` — the caller's AbortSignal fired
 * - `source_error` — the entropy source itself failed, or a reader was used
 *   after close; the original error is `cause`
 */
export type FieldErrorCode =
  | 'invalid_config'
  | 'insufficient_data'
  | 'insufficient_entropy'
  | 'aborted'
  | 'source_error'

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

function codeOf(error: unknown): unknown {
  return error !== null && typeof error === 'object' && 'code' in error
    ? (error as { code: unknown }).code
    : undefined
}

/**
 * Map any failure at the sampling seam onto a {@link FieldError}:
 *
 * | oracle code | field code |
 * | --- | --- |
 * | `aborted` | `aborted` |
 * | `insufficient_entropy` | `insufficient_entropy` |
 * | `invalid_input` | `invalid_config` |
 * | `source_error`, `closed` | `source_error` |
 *
 * A `FieldError` passes through unchanged; any other error becomes
 * `source_error` with the original as `cause`.
 */
export function toFieldError(error: unknown): FieldError {
  if (error instanceof FieldError) return error
  const isOracle = error instanceof Error && error.name === 'OracleError'
  const code = isOracle ? codeOf(error) : undefined
  if (code === 'aborted') {
    return new FieldError('aborted', 'field sampling aborted', { cause: error })
  }
  if (code === 'insufficient_entropy') {
    return new FieldError(
      'insufficient_entropy',
      'entropy source ended before the field was filled',
      { cause: error },
    )
  }
  if (code === 'invalid_input') {
    const detail = error instanceof Error ? `: ${error.message}` : ''
    return new FieldError('invalid_config', `entropy input is not a usable byte source${detail}`, {
      cause: error,
    })
  }
  const detail = error instanceof Error ? `: ${error.message}` : ''
  return new FieldError('source_error', `entropy source failed${detail}`, { cause: error })
}

/** Re-throw a sampling-seam failure as a {@link FieldError} (see {@link toFieldError}). */
export function rethrowOracle(error: unknown): never {
  throw toFieldError(error)
}
