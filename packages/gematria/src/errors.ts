/** Machine-readable failure categories for every throw site in the package. */
export type GematriaErrorCode =
  | 'invalid_input' // caller error: non-string text, bad lexicon/options, out-of-range number, unrecognized entropy input
  | 'unknown_cipher' // a cipher id not present in the CIPHERS registry
  | 'unsupported_script' // a script with no ciphers, or an unrecognized forced script
  | 'no_match' // a lexicon filtered to zero admissible words / candidates (commonness, ./oracle draws)
  | 'aborted' // ./oracle: the caller's AbortSignal fired (also when it was aborted before the draw)
  | 'insufficient_entropy' // ./oracle: a finite entropy input ran out of bytes before the draw completed
  | 'source_error' // ./oracle: the entropy input failed or its reader was closed; the OracleError is `cause`

export interface GematriaErrorOptions {
  /** The cipher id involved, when one exists. */
  cipher?: string
  cause?: unknown
}

/**
 * The only error type this package throws. `code` is stable API; `message`
 * is human-readable and free to change between versions. The `./oracle`
 * bridge maps every `OracleError` of the composed `@mindpeeker/oracle` reader
 * onto this class — `aborted`, `insufficient_entropy` and `invalid_input` keep
 * their code; `source_error` and `closed` become `source_error` — with the
 * original `OracleError` as `cause`.
 */
export class GematriaError extends Error {
  readonly code: GematriaErrorCode
  readonly cipher?: string
  declare readonly cause?: unknown

  constructor(code: GematriaErrorCode, message: string, opts: GematriaErrorOptions = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined)
    this.name = 'GematriaError'
    this.code = code
    this.cipher = opts.cipher
  }
}
