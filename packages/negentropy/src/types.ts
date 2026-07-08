/**
 * Minimal structural view of a live byte source. Any `@mindpeeker/entropy`
 * EntropyProvider satisfies this — no import required.
 */
export interface TrialSource {
  readonly name: string
  stream(opts?: TrialStreamOptions): AsyncIterable<Uint8Array>
}

export interface TrialStreamOptions {
  signal?: AbortSignal
  /** Desired chunk size in bytes. Passed through to the source. */
  chunkBytes?: number
}

/** How raw bits are grouped into trials. */
export type TrialClock =
  | { mode: 'count' } // a trial completes as soon as bitsPerTrial bits arrive (default)
  | { mode: 'interval'; intervalMs: number } // GCP-style: one trial per wall-clock bucket

export interface TrialConfig {
  /** Bits summed per trial. Default 200 (GCP convention → Binomial(200, ½)). Minimum 8. */
  bitsPerTrial?: number
  clock?: TrialClock
}

/** One trial: the number of one-bits among bitsPerTrial raw bits. */
export interface Trial {
  sum: number
  index: number
  /** Epoch ms of trial completion — set in live mode, absent in batch. */
  at?: number
}

/** A source's recorded trial data — the archival unit every analysis consumes. */
export interface TrialSeries {
  readonly source: string
  readonly bitsPerTrial: number
  readonly sums: Float64Array
  readonly timestamps?: Float64Array
}

/** Normalization parameters mapping one source's trial sums to z-scores. */
export interface Calibration {
  readonly source: string
  readonly bitsPerTrial: number
  /** Trials the calibration was fit on (0 for theoretical). */
  readonly trials: number
  readonly mean: number
  readonly sd: number
  readonly basis: 'empirical' | 'theoretical'
}

/** A test statistic with honest attribution of what went into it. */
export interface StatResult {
  statistic: number
  df: number
  pValue: number
  /** Trials (or steps) that entered the statistic. */
  n: number
  sources: readonly string[]
}
