export type EntropyErrorCode =
  | 'rate_limited' // provider throttled us (retryAfterMs may be set)
  | 'auth' // missing/invalid credentials
  | 'network' // fetch/WebSocket transport failure
  | 'bad_response' // 2xx but unparseable or contract-violating body
  | 'insufficient_entropy' // could not assemble the requested bytes (also: all strategy members failed)
  | 'timeout' // per-request timeoutMs exceeded
  | 'aborted' // caller's AbortSignal fired
  | 'invalid_request' // caller error: length <= 0, non-integer, over provider max

export interface EntropyErrorOptions {
  provider?: string
  retryAfterMs?: number
  cause?: unknown
}

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
