/** Machine-readable failure categories for every throw site in the package. */
export type OracleErrorCode =
  | 'insufficient_entropy' // a finite input ran out of bytes before the cast completed
  | 'invalid_spread' // unknown spread name, or a malformed/empty/oversized spread object
  | 'invalid_input' // caller error: bad n/count/weights/options, non-byte values, unrecognized input shape, reader already in use
  | 'aborted' // the caller's AbortSignal fired
  | 'source_error' // the underlying input (stream, ByteSource, foreign reader) failed; the original error is `cause`
  | 'closed' // a read on a ByteReader after close() was called (or a pending read cut short by close())

export interface OracleErrorOptions {
  /** Name of the entropy source involved, when one exists. */
  source?: string
  /** The underlying error — always set for `'source_error'`. */
  cause?: unknown
}

/**
 * The only error type this package throws. `code` is stable API; `message`
 * is human-readable and free to change between versions.
 *
 * Errors raised by the input itself (a provider's network failure, a
 * generator that throws, a foreign `ByteReader` that rejects) are wrapped as
 * `'source_error'` with the original error in `cause`; an error that already
 * is an `OracleError` passes through unchanged.
 */
export class OracleError extends Error {
  readonly code: OracleErrorCode
  readonly source?: string
  declare readonly cause?: unknown

  constructor(code: OracleErrorCode, message: string, opts: OracleErrorOptions = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined)
    this.name = 'OracleError'
    this.code = code
    this.source = opts.source
  }
}
