export type FlowErrorCode =
  | 'invalid_input' // caller error: non-integer symbols, mismatched lengths, bad k/l/lag/bins
  | 'insufficient_data' // fewer samples than the estimator's embedding requires
  | 'alphabet_overflow' // symbol space too large to represent (alphabet or m! beyond 2^31 − 1)
  | 'aborted' // caller's AbortSignal fired

export interface FlowErrorOptions {
  cause?: unknown
}

/**
 * Typed error for every failure mode in `@mindpeeker/flow`. The `code` union
 * is stable API — match on it, not on the message text.
 */
export class FlowError extends Error {
  readonly code: FlowErrorCode
  declare readonly cause?: unknown

  constructor(code: FlowErrorCode, message: string, opts: FlowErrorOptions = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined)
    this.name = 'FlowError'
    this.code = code
  }
}
