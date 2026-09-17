/** Machine-readable failure category for every error thrown by `@mindpeeker/vdf`. */
export type VdfErrorCode =
  | 'invalid_input' // malformed arguments: bad T, bad bytes, structurally broken proofs/seals/checkpoints
  | 'invalid_modulus' // modulus is not `{ n: bigint }` with n odd and of workable size
  | 'aborted' // the caller's AbortSignal fired during a long computation
  | 'unsupported_version' // wire bytes carry a format version this release cannot read (e.g. 0.1.0 proofs)
  | 'modulus_mismatch' // wire bytes were produced under a different modulus (fingerprint differs)

export interface VdfErrorOptions {
  cause?: unknown
}

/**
 * Error type for the whole package. Every throw carries a {@link VdfErrorCode}
 * so callers can branch without string-matching messages.
 *
 * Note the deliberate asymmetry in the verifiers (`pietrzakVerify`,
 * `wesolowskiVerify`, `verifySeal`): a proof that is *wrong* (tampered bytes,
 * forged or non-canonical elements, mismatched $T$) makes the verifier return
 * `false`; only arguments that are *malformed* (not the documented types at all)
 * throw `VdfError('invalid_input')`. Byte parsers throw on any structural defect,
 * with `unsupported_version` / `modulus_mismatch` for well-formed bytes this
 * release or this modulus cannot accept.
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
