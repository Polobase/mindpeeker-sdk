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
  /**
   * Epoch ms (from the stream's clock) at which the source chunk that
   * completed this trial arrived — set in live mode, absent in batch. Every
   * trial completed from the same chunk shares one timestamp, so it is chunk
   * arrival time, not a per-trial completion time.
   */
  at?: number
}

/** A source's recorded trial data — the archival unit every analysis consumes. */
export interface TrialSeries {
  readonly source: string
  readonly bitsPerTrial: number
  /**
   * One trial sum per step. In a step-aligned experiment archive recorded
   * under missing:'skip', NaN marks a step at which this source was absent
   * (only the experiment layer accepts NaN; the stats functions reject it).
   */
  readonly sums: Float64Array
  /** Epoch ms per step (same length as `sums`); a session archive stamps every source with the tick time. */
  readonly timestamps?: Float64Array
  /** Trailing bits that did not fill a whole trial (batch extraction only). */
  readonly leftoverBits?: number
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
