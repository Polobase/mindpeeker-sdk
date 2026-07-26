/** Machine-readable failure categories for every throw site in the package. */
export type GematriaErrorCode =
  | 'invalid_input' // caller error: non-string text, bad lexicon, negative reduce input
  | 'unknown_cipher' // a cipher id not present in the CIPHERS registry
  | 'unsupported_script' // a script with no ciphers, or an unrecognized forced script
  | 'no_match' // an entropy draw filtered to zero candidates (./oracle bridge)

export interface GematriaErrorOptions {
  /** The cipher id involved, when one exists. */
  cipher?: string
  cause?: unknown
}

/**
 * The only error type this package throws. `code` is stable API; `message`
 * is human-readable and free to change between versions. Entropy/abort errors
 * raised inside the `./oracle` bridge's composed `@mindpeeker/oracle` calls
 * propagate unchanged as `OracleError`.
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
