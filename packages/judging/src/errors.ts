/**
 * Machine-readable failure categories of `@mindpeeker/judging`.
 *
 * - `invalid_input` — caller data that cannot be scored: non-integer or
 *   out-of-range counts, ranks outside `1…k`, ragged or non-square matrices,
 *   symbols outside the alphabet, decks whose call and target totals differ
 * - `invalid_options` — a bad option value: `choices < 2`, `p0` outside
 *   $(0,1)$, a non-positive prior shape, `confidence` outside $(0,1)$, an
 *   unknown enum label, a malformed seed
 * - `too_large` — an exact computation would exceed its documented work limit
 *   (the message names the limit); use a smaller design or the Monte Carlo
 *   method where one is offered
 * - `numerical` — a special-function evaluation in
 *   `@mindpeeker/negentropy/numerics` failed; `cause` carries the original
 *   error (never expected on validated input — please report it)
 */
export type JudgingErrorCode = 'invalid_input' | 'invalid_options' | 'too_large' | 'numerical'

/** Optional context attached to a {@link JudgingError}. */
export interface JudgingErrorOptions {
  /** The argument or option path that failed validation, e.g. `ranks[3]`. */
  argument?: string
  cause?: unknown
}

/**
 * The one error class every throwing path in this package uses. `code` is the
 * stable machine-readable contract; `message` is for humans and may change.
 * Errors from the composed negentropy numerics are wrapped as
 * `code: 'numerical'` with the original as `cause`.
 */
export class JudgingError extends Error {
  readonly code: JudgingErrorCode
  readonly argument?: string
  declare readonly cause?: unknown

  constructor(code: JudgingErrorCode, message: string, opts: JudgingErrorOptions = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined)
    this.name = 'JudgingError'
    this.code = code
    if (opts.argument !== undefined) this.argument = opts.argument
  }
}
