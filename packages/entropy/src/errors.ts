/**
 * Stable error codes carried by every `EntropyError`:
 *
 * - `rate_limited` — the provider throttled us (`retryAfterMs` may be set).
 * - `auth` — missing or invalid credentials.
 * - `permission` — the user or platform denied access to a local device
 *   (camera, microphone, motion sensors).
 * - `network` — transport or device I/O failure (fetch, WebSocket, serial
 *   port, child process), or an unexpected failure inside a provider.
 * - `bad_response` — the source answered but the payload violates the
 *   contract (unparseable body, wrong byte count, degenerate composite).
 * - `insufficient_entropy` — the requested bytes could not be assembled (the
 *   source ended, or every strategy member failed).
 * - `timeout` — the call or stream-pull `timeoutMs` budget was exceeded.
 * - `aborted` — the caller's `AbortSignal` fired.
 * - `invalid_request` — caller error: invalid length, option or configuration.
 * - `health_test` — the SP 800-90B continuous or start-up health tests failed
 *   on raw samples (after the configured number of retests): the source is
 *   misbehaving.
 * - `verification` — a beacon round failed opt-in verification (`verify`
 *   option): recomputed output hash, certificate id, signature, chain linkage
 *   or structural round checks did not hold.
 */
export type EntropyErrorCode =
  | 'rate_limited'
  | 'auth'
  | 'permission'
  | 'network'
  | 'bad_response'
  | 'insufficient_entropy'
  | 'timeout'
  | 'aborted'
  | 'invalid_request'
  | 'health_test'
  | 'verification'

/** Optional context attached to an `EntropyError`. */
export interface EntropyErrorOptions {
  /** Name of the provider (or composite) that raised the error. */
  provider?: string
  /** Server-directed delay before retrying, for `rate_limited`. */
  retryAfterMs?: number
  /** The underlying error, when this one wraps another. */
  cause?: unknown
}

/** The single error class every `@mindpeeker/entropy` API throws, discriminated by `code`. */
export class EntropyError extends Error {
  readonly code: EntropyErrorCode
  readonly provider?: string
  readonly retryAfterMs?: number
  declare readonly cause?: unknown

  constructor(code: EntropyErrorCode, message: string, opts: EntropyErrorOptions = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined)
    this.name = 'EntropyError'
    this.code = code
    this.provider = opts.provider
    this.retryAfterMs = opts.retryAfterMs
  }
}
