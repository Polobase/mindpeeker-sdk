/**
 * Machine-readable failure categories of `@mindpeeker/ledger`.
 *
 * - `invalid_json` — a value is not representable as RFC 8785 canonical JSON
 *   (NaN/±Infinity, `undefined`, BigInt, a Map/Set/Date or other non-plain
 *   object, a lone surrogate or noncharacter, a cycle, excessive nesting).
 * - `invalid_input` — a malformed argument: bytes, hex, a hash of the wrong
 *   length, an index or tree size that is not a safe integer, a bad option.
 * - `invalid_entry` — a line that is not a canonical ledger chain entry.
 * - `invalid_registration` — a registration record fails its schema.
 * - `invalid_bracket` — a time-bracket record fails its schema.
 * - `invalid_note` — signed-note, checkpoint or verifier-key text does not parse.
 * - `crypto_unavailable` — no WebCrypto `crypto.subtle` in this runtime.
 *
 * Verification functions (`verifyChain`, `verifyInclusion`,
 * `verifyConsistency`, `verifyCheckpoint`, `verifyTimeBracket`) report
 * content problems in their result instead of throwing; they throw only for
 * caller errors such as a non-integer tree size.
 */
export type LedgerErrorCode =
  | 'invalid_json'
  | 'invalid_input'
  | 'invalid_entry'
  | 'invalid_registration'
  | 'invalid_bracket'
  | 'invalid_note'
  | 'crypto_unavailable'

export interface LedgerErrorOptions {
  cause?: unknown
}

/**
 * The one error class every throwing path in this package uses. `code` is the
 * stable machine-readable contract; `message` is for humans and may change.
 */
export class LedgerError extends Error {
  readonly code: LedgerErrorCode
  declare readonly cause?: unknown

  constructor(code: LedgerErrorCode, message: string, opts: LedgerErrorOptions = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined)
    this.name = 'LedgerError'
    this.code = code
  }
}
