/** Machine-readable failure categories of `@mindpeeker/ephemeris`. */
export type EphemerisErrorCode =
  | 'invalid_time' // not a valid Date, calendar date, or Julian day inside the supported domain
  | 'invalid_input' // malformed argument or trial: non-finite angle, longitude, effect, stratum
  | 'invalid_options' // bad option: window/step hours, permutations, seed, phase name, range
  | 'insufficient_data' // no trials, or no window/group with enough trials for the statistic

export interface EphemerisErrorOptions {
  cause?: unknown
}

/**
 * The one error class every throwing path in this package uses. `code` is the
 * stable machine-readable contract; `message` is for humans and may change.
 */
export class EphemerisError extends Error {
  readonly code: EphemerisErrorCode
  declare readonly cause?: unknown

  constructor(code: EphemerisErrorCode, message: string, opts: EphemerisErrorOptions = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined)
    this.name = 'EphemerisError'
    this.code = code
  }
}
