/** Machine-readable failure categories of `@mindpeeker/scan`. */
export type ScanErrorCode =
  | 'invalid_catalog' // caller error: empty catalog, a malformed item, a duplicate id, or a duplicate name within a category
  | 'invalid_options' // caller error: a malformed option (rounds, maxValue, prior, roundBytes, …), source shape, or tripolar plan/registration
  | 'insufficient_entropy' // the byte source ended before the scan/broadcast had enough bytes
  | 'invalid_target' // a broadcast target that is neither a valid Rate, a parseable rate, nor a witness; or a malformed receipt line
  | 'source_error' // the byte source failed (health test, I/O, a non-byte chunk); `cause` holds the source's own error
  | 'aborted' // the caller's AbortSignal fired

/** Optional context attached to a {@link ScanError}. */
export interface ScanErrorOptions {
  source?: string
  cause?: unknown
}

/**
 * The one error class every entry point of this package throws. `code` is the
 * stable machine-readable contract; `message` is for humans and may change.
 *
 * Failures inside the composed primitives are mapped onto these codes by one
 * shared rule: aborts (`OracleError` `aborted`/`closed`, `PsiError`/
 * `NegentropyError` `aborted`) become `aborted`; a source that runs dry
 * (`OracleError('insufficient_entropy')`, `PsiError('insufficient_data')`)
 * becomes `insufficient_entropy`; a source that *fails*
 * (`OracleError('source_error')`, `NegentropyError('source_failed')`, a
 * non-byte chunk) becomes `source_error` with the provider's own error — e.g.
 * an `EntropyError('health_test')` — as `cause`; a rejected plan or
 * registration (`PsiError` `invalid_plan`/`plan_mismatch`) becomes
 * `invalid_options`. Errors thrown by caller-supplied callbacks (`broadcast`'s
 * `now`, `scanTripolar`'s `declare`) propagate unchanged; a `now` passed to
 * `scanTripolar` runs inside psi's trial stream, which reports its throw as a
 * source failure (`source_error`).
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
