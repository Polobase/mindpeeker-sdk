export type NegentropyErrorCode =
  | 'insufficient_data' // fewer trials/samples than the statistic requires; too little min-entropy for any extractor output
  | 'calibration_required' // z-normalization requested with a missing or mismatched calibration
  | 'invalid_window' // malformed event window: empty, inverted, negative, mixed Date/step bounds, invalid Date, or Date bounds without timestamps (a window past the data is an 'incomplete' event, not an error)
  | 'invalid_config' // caller error: bad option or argument — bitsPerTrial < 8, no/duplicate sources or event ids, bad calibrations, stepTimeoutMs, NaN/non-finite statistics, non-bit input, bad extractor params, non-canonical registration values
  | 'numerical' // a special-function iteration failed to converge (a bug report, never expected on valid input)
  | 'source_ended' // a live source's stream completed before the experiment did (missing: 'error')
  | 'source_failed' // a live source's (or stream extractor's upstream) stream threw — cause carries the original error
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
