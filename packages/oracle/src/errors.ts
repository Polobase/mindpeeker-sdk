/** Machine-readable failure categories for every throw site in the package. */
export type OracleErrorCode =
  | 'insufficient_entropy' // a finite input ran out of bytes before the cast completed
  | 'invalid_spread' // unknown spread name, or a spread object with no positions
  | 'invalid_input' // caller error: bad n/count/weights, non-byte values, unrecognized input shape
  | 'aborted' // the caller's AbortSignal fired

export interface OracleErrorOptions {
  /** Name of the entropy source involved, when one exists. */
  source?: string
  cause?: unknown
}

/**
 * The only error type this package throws. `code` is stable API; `message`
 * is human-readable and free to change between versions.
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
