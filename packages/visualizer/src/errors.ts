/**
 * Error codes raised by `@mindpeeker/visualizer`:
 *
 * - `invalid_channel` — caller error at attach time: duplicate, empty or
 *   non-string channel name, a channel id outside the wire format's `u16`
 *   range, a source that is not (async) iterable, or a static document that
 *   is not JSON-serializable (BigInt, cycles, a throwing `toJSON`, `undefined`);
 *   or `setNote` on an unknown channel or with a non-string note.
 * - `protocol` — a frame or producer emission violated the wire format (bad
 *   version, unknown kind, truncated header, payload size not matching its
 *   declared shape, a malformed JSON text frame, non-string matrix labels, a
 *   matrix `range` that is not a finite `[lo, hi]` with `lo < hi`, or series
 *   `bands` that are not 1–8 numeric `{lo, hi}` pairs or come with `band`).
 * - `server` — the dashboard cannot serve: invalid `DashboardOptions` (port,
 *   host, ringCapacity, allowedOrigins, onChannelError), an attach after
 *   `stop()`, or an underlying failure of the runtime's HTTP server.
 * - `invalid_options` — a demo CLI argument or source selection is invalid:
 *   unknown flag or source name, a flag missing its value, an out-of-range
 *   `--port`/`--baud`, `--replay` combined with live flags, a malformed
 *   `SourceOptions` field, a `--record` file that exists or cannot be
 *   written, or a `--replay` file that cannot be read, is not a psi schema-v2
 *   recording, or whose hash chain is broken.
 * - `aborted` — the caller's `AbortSignal` fired.
 */
export type VisualizerErrorCode =
  | 'invalid_channel'
  | 'protocol'
  | 'server'
  | 'invalid_options'
  | 'aborted'

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
