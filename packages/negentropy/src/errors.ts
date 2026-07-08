export type NegentropyErrorCode =
  | 'insufficient_data' // fewer trials/samples than the statistic requires
  | 'calibration_required' // z-normalization requested with a missing or mismatched calibration
  | 'invalid_window' // event window empty, inverted, or outside the data range
  | 'invalid_config' // caller error: bitsPerTrial < 8, no sources, no events, bad extractor params
  | 'source_ended' // a live source's stream completed before the experiment did
  | 'source_failed' // a live source's stream threw (cause carries the original error)
  | 'health_test' // continuous health test (RCT/APT) tripped in strict mode
  | 'timeout' // stepTimeoutMs exceeded waiting for a trial
  | 'aborted' // caller's AbortSignal fired

export interface NegentropyErrorOptions {
  source?: string
  cause?: unknown
}

export class NegentropyError extends Error {
  readonly code: NegentropyErrorCode
  readonly source?: string
  declare readonly cause?: unknown

  constructor(code: NegentropyErrorCode, message: string, opts: NegentropyErrorOptions = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined)
    this.name = 'NegentropyError'
    this.code = code
    this.source = opts.source
  }
}
