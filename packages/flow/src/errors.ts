export type FlowErrorCode =
  | 'invalid_input' // caller error: non-integer symbols, mismatched lengths, bad k/l/lag/bins/options, malformed stream items
  | 'insufficient_data' // fewer samples than the estimator's embedding requires
  | 'alphabet_overflow' // symbol space too large to represent (alphabet or m! beyond 2^31 − 1)
  | 'aborted' // caller's AbortSignal fired (also when the upstream then throws its own abort error or simply ends)
  | 'source_error' // an upstream stream/iterable failed (not an abort); the original error is `cause`

export interface FlowErrorOptions {
  /** The underlying error — always set for `'source_error'`. */
  cause?: unknown
  /** Name of the upstream stream involved (a `ByteSource`'s `name`, or `'first stream'` …). */
  source?: string
}

/**
 * Typed error for every failure mode in `@mindpeeker/flow`. The `code` union
 * is stable API — match on it, not on the message text.
 *
 * Errors raised by an upstream input (a provider's network failure, a
 * generator that throws) are wrapped as `'source_error'` with the original
 * error in `cause`; a `FlowError` thrown upstream passes through unchanged.
 * Any failure observed while the caller's signal is aborted is reported as
 * `'aborted'` (the upstream error, if any, is the `cause`).
 */
export class FlowError extends Error {
  readonly code: FlowErrorCode
  declare readonly source?: string
  declare readonly cause?: unknown

  constructor(code: FlowErrorCode, message: string, opts: FlowErrorOptions = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined)
    this.name = 'FlowError'
    this.code = code
    if (opts.source !== undefined) this.source = opts.source
  }
}
