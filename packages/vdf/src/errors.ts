/** Machine-readable failure category for every error thrown by `@mindpeeker/vdf`. */
export type VdfErrorCode =
  | 'invalid_input' // malformed arguments: bad T, bad bytes, structurally broken proof objects
  | 'invalid_modulus' // modulus is not `{ n: bigint }` with n odd and of workable size
  | 'aborted' // the caller's AbortSignal fired during a sequential-squaring loop

export interface VdfErrorOptions {
  cause?: unknown
}

/**
 * Error type for the whole package. Every throw carries a {@link VdfErrorCode}
 * so callers can branch without string-matching messages.
 *
 * Note the deliberate asymmetry in `pietrzakVerify`/`verifySeal`: a proof that
 * is *wrong* (tampered bytes, forged midpoints, mismatched $T$) makes the
 * verifier return `false`; only arguments that are *malformed* (not the
 * documented types at all) throw `VdfError('invalid_input')`.
 */
export class VdfError extends Error {
  readonly code: VdfErrorCode
  declare readonly cause?: unknown

  constructor(code: VdfErrorCode, message: string, opts: VdfErrorOptions = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined)
    this.name = 'VdfError'
    this.code = code
  }
}
