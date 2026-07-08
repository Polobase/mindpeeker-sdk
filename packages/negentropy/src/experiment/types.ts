import type { Calibration, TrialConfig, TrialSeries } from '../types.js'

export type EventStatistic = 'netvar' | 'devvar' | 'correlation'

/**
 * A pre-registered event window. Registering the statistic and window BEFORE
 * looking at the data is what gives the resulting p-value its stated meaning
 * — see `registerExperiment` and the pointwise-envelope caveat in cumdev.
 */
export interface EventSpec {
  id: string
  /** Hypothesis label, recorded verbatim in the result. */
  label?: string
  statistic: EventStatistic
  /** Step index (number) or wall-clock Date (needs trial timestamps). Inclusive. */
  start: number | Date
  /** Step index or Date. Exclusive. */
  end: number | Date
}

export interface ExperimentConfig {
  trial?: TrialConfig
  /**
   * 'theoretical' (default): Binomial(k, ½) normalization.
   * Calibration[]: pre-fit calibrations, one per source.
   * { trials: n }: burn the first n trials per source as a calibration
   * window, disjoint from analysis by construction (recommend n ≥ 500).
   * Event windows then index the post-calibration remainder.
   */
  calibration?: 'theoretical' | readonly Calibration[] | { trials: number }
  /** May be empty for pure live monitoring — the composite is then NaN. */
  events?: readonly EventSpec[]
  /**
   * A source with no trial for a step: 'error' (default, fail-closed) or
   * 'skip' — batch truncates to the shortest series; live combines over the
   * sources that answered each round.
   */
  missing?: 'error' | 'skip'
}

export interface EventResult {
  id: string
  label?: string
  statistic: EventStatistic
  value: number
  df: number
  pValue: number
  /** Normal-equivalent z of the one-sided pValue — the composite input. */
  z: number
  steps: number
  /** cumsum(Z_s² − 1) inside the window — plot alongside significanceEnvelope(steps). */
  cumulative: Float64Array
  sources: readonly string[]
}

export interface ExperimentComposite {
  /** Stouffer across event z's. NaN when there were no events. */
  z: number
  pValue: number
  events: number
}

export interface ExperimentResult {
  events: readonly EventResult[]
  composite: ExperimentComposite
  calibration: readonly Calibration[]
  /** Full archival trial data (post-calibration split) — reanalysis without re-running. */
  series: readonly TrialSeries[]
  /** SHA-256 hash of the pre-registered config, when one was used. */
  registration?: string
}
