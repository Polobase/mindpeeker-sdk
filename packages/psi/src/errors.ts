/** Machine-readable failure categories of `@mindpeeker/psi`. */
export type PsiErrorCode =
  | 'invalid_plan' // caller error: bad plan, window, offsets, seed, labels, prior, or monitor options
  | 'insufficient_data' // fewer runs/trials/surrogates/distinct relabelings than the analysis requires
  | 'source_mismatch' // series disagree on source name, bitsPerTrial, or step alignment
  | 'plan_mismatch' // recorded runs diverge from the registered (pre-committed) plan
  | 'aborted' // caller's AbortSignal fired
  | 'bad_record' // a JSONL session record failed validation on read

/** Optional context attached to a {@link PsiError}. */
export interface PsiErrorOptions {
  source?: string
  cause?: unknown
}

/**
 * The one error class every throwing path in this package uses. `code` is the
 * stable machine-readable contract; `message` is for humans and may change.
 * Errors raised inside composed `@mindpeeker/negentropy` calls propagate
 * unchanged except for aborts, which are re-thrown as `code: 'aborted'` here;
 * caller input is validated up front, so malformed plans, series, and labels
 * surface as `PsiError` before any negentropy call sees them.
 */
export class PsiError extends Error {
  readonly code: PsiErrorCode
  readonly source?: string
  declare readonly cause?: unknown

  constructor(code: PsiErrorCode, message: string, opts: PsiErrorOptions = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined)
    this.name = 'PsiError'
    this.code = code
    this.source = opts.source
  }
}
