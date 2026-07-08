/**
 * Error codes raised by `@mindpeeker/visualizer`:
 *
 * - `invalid_channel` — caller error: duplicate channel name, empty name, or a
 *   channel id outside the wire format's `u16` range.
 * - `protocol` — a binary frame violated the wire format (bad version, unknown
 *   kind, truncated header, payload size not matching its declared shape).
 * - `server` — the dashboard cannot serve: invalid options, an attach after
 *   `stop()`, or an underlying failure of the runtime's HTTP server.
 * - `aborted` — the caller's `AbortSignal` fired.
 */
export type VisualizerErrorCode = 'invalid_channel' | 'protocol' | 'server' | 'aborted'

/** Optional context attached to a {@link VisualizerError}. */
export interface VisualizerErrorOptions {
  /** Channel name the failure relates to, when there is one. */
  channel?: string
  /** Underlying error, propagated via the standard `cause` chain. */
  cause?: unknown
}

/**
 * The package's only error class — mirror of `NegentropyError` in the sibling
 * package: a stable machine-readable `code` union plus optional `channel`
 * context, so callers can branch without string-matching messages.
 */
export class VisualizerError extends Error {
  readonly code: VisualizerErrorCode
  readonly channel?: string
  declare readonly cause?: unknown

  constructor(code: VisualizerErrorCode, message: string, opts: VisualizerErrorOptions = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined)
    this.name = 'VisualizerError'
    this.code = code
    this.channel = opts.channel
  }
}
