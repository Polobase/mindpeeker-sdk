/** Machine-readable failure categories of `@mindpeeker/scan`. */
export type ScanErrorCode =
  | 'invalid_catalog' // caller error: empty catalog, no items, or a malformed catalog item
  | 'insufficient_entropy' // the byte source ended before the scan/broadcast had enough bytes
  | 'invalid_target' // a broadcast target that is neither a Rate, a parseable rate, nor a witness
  | 'aborted' // the caller's AbortSignal fired

/** Optional context attached to a {@link ScanError}. */
export interface ScanErrorOptions {
  source?: string
  cause?: unknown
}

/**
 * The one error class every throwing path in this package uses. `code` is the
 * stable machine-readable contract; `message` is for humans and may change.
 *
 * Errors raised inside the composed primitives (`@mindpeeker/oracle`,
 * `@mindpeeker/rate`, `@mindpeeker/psi`) propagate unchanged **except** that a
 * source running dry (`OracleError('insufficient_entropy')`) is re-thrown here
 * as `code: 'insufficient_entropy'` and any abort is re-thrown as
 * `code: 'aborted'`, so callers only need to switch on this package's codes.
 */
export class ScanError extends Error {
  readonly code: ScanErrorCode
  readonly source?: string
  declare readonly cause?: unknown

  constructor(code: ScanErrorCode, message: string, opts: ScanErrorOptions = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined)
    this.name = 'ScanError'
    this.code = code
    this.source = opts.source
  }
}
