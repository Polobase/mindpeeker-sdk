/**
 * Error codes raised anywhere in `@mindpeeker/rate`.
 *
 * - `invalid_rate` — a rate string was malformed, or a {@link Rate} carried
 *   non-integer digits, negative digits, or digits $\geq$ its base.
 * - `invalid_base` — a base was not an integer $\geq 2$ (the smallest base for
 *   which the angular map $\theta_d = d\,\tfrac{2\pi}{b}$ is non-degenerate).
 * - `aborted` — a caller's {@link AbortSignal} fired mid-stream.
 */
export type RateErrorCode = 'invalid_rate' | 'invalid_base' | 'aborted'

export interface RateErrorOptions {
  /** The offending rate string or fragment, when relevant. */
  input?: string
  cause?: unknown
}

/**
 * The single error type thrown by this package. Mirrors the
 * `NegentropyError`/`EntropyError` pattern used SDK-wide: a stable
 * `code` string-union plus an optional `cause` chain.
 */
export class RateError extends Error {
  readonly code: RateErrorCode
  readonly input?: string
  declare readonly cause?: unknown

  constructor(code: RateErrorCode, message: string, opts: RateErrorOptions = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined)
    this.name = 'RateError'
    this.code = code
    this.input = opts.input
  }
}
