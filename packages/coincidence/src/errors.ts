/**
 * Error codes raised anywhere in `@mindpeeker/coincidence`.
 *
 * - `invalid_input` — an argument or option is outside its documented domain:
 *   a non-integer or negative count, a category count $< 1$, a probability
 *   outside $[0, 1]$, a probability vector that does not sum to 1, an event
 *   time outside the observation span, an unknown grade label, an options
 *   value that is not an object, and so on. Nothing is computed first.
 * - `too_large` — the exact computation would exceed its documented work
 *   limit (for example a k-fold match with both a huge category count and a
 *   huge number of draws). The message names the approximation to use instead.
 */
export type CoincidenceErrorCode = 'invalid_input' | 'too_large'

export interface CoincidenceErrorOptions {
  /** Name of the offending argument or option (for example `'n'` or `'options.window'`). */
  argument?: string
  cause?: unknown
}

/**
 * The single error type thrown by this package. The `code` union is stable
 * API — match on it, not on the message text.
 */
export class CoincidenceError extends Error {
  readonly code: CoincidenceErrorCode
  declare readonly argument?: string
  declare readonly cause?: unknown

  constructor(code: CoincidenceErrorCode, message: string, opts: CoincidenceErrorOptions = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined)
    this.name = 'CoincidenceError'
    this.code = code
    if (opts.argument !== undefined) this.argument = opts.argument
  }
}
