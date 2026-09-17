import type { Calibration, TrialClock, TrialConfig, TrialSeries } from '../types.js'
import type { RegisteredExperiment } from './registration.js'

/**
 * The event statistic: 'netvar' (Σ Stouffer Z², χ²), 'devvar' (Σ z², χ²),
 * 'correlation' (Σ pairwise products zᵢzⱼ, normal) or 'covar' (Σ pairwise
 * products of (zᵢ² − 1), GCP's correlation of variances C2, normal). The
 * two pairwise statistics need ≥ 2 sources.
 */
export type EventStatistic = 'netvar' | 'devvar' | 'correlation' | 'covar'

/**
 * A pre-registered event window. Registering the statistic and window BEFORE
 * looking at the data is what gives the resulting p-value its stated meaning
 * — see `registerExperiment` and the pointwise-envelope caveat in cumdev.
 * Index bounds must be safe integers with 0 ≤ start < end; Date bounds must be
 * valid Dates with start < end; mixing the two throws `invalid_window`.
 */
export interface EventSpec {
  /** Unique within the experiment (`invalid_config` on duplicates). */
  id: string
  /** Hypothesis label, recorded verbatim in the result. */
  label?: string
  statistic: EventStatistic
  /** Step index (number) or wall-clock Date (needs trial timestamps). Inclusive. */
  start: number | Date
  /** Step index or Date. Exclusive. */
  end: number | Date
}

/**
 * A public randomness-beacon pulse committed inside a registration. Hashing a
 * pulse that could not be known before its publication time gives the
 * registration a verifiable no-earlier-than bound (research.md §7–8).
 */
export interface BeaconAnchor {
  /** Beacon family, e.g. 'drand', 'nist', 'curby' or 'other'. Non-empty. */
  source: string
  /** Chain identifier as published (drand chain hash, NIST chain index, …). Non-empty. */
  chainId: string
  /** Round / pulse index: a safe integer ≥ 0. */
  round: number
  /** Publication timestamp as published — any string `Date.parse` accepts; hashed verbatim. */
  timestamp: string
  /** Pulse output, even-length hex (hashed lower-cased). */
  valueHex: string
  /** Pulse signature, even-length hex (hashed lower-cased). */
  signatureHex?: string
}

/** Anchors committed in a registration hash. */
export interface RegistrationAnchors {
  beacons: readonly BeaconAnchor[]
}

export interface ExperimentConfig {
  trial?: TrialConfig
  /**
   * 'theoretical' (default): Binomial(k, ½) normalization.
   * Calibration[]: pre-fit calibrations, one per source (unique source names,
   * finite mean, finite sd > 0).
   * { trials: n }: burn the first n trials per source (the first n steps of a
   * step-aligned batch archive) as a calibration window, disjoint from
   * analysis by construction (integer n ≥ 2; recommend n ≥ 500). Event
   * windows then index the post-calibration remainder.
   */
  calibration?: 'theoretical' | readonly Calibration[] | { trials: number }
  /** May be empty for pure live monitoring — the composite is then NaN. */
  events?: readonly EventSpec[]
  /**
   * A source with no trial for a step: 'error' (default, fail-closed) or
   * 'skip' — a NaN trial sum marks the source absent at that step (and a
   * series shorter than the longest is absent past its end); statistics
   * combine over the sources present at each step, exactly as the live
   * session does per round.
   */
  missing?: 'error' | 'skip'
  /** Optional public anchors committed in the registration hash; ignored by the analysis. */
  anchors?: RegistrationAnchors
}

/**
 * An ExperimentConfig with every default filled in — what `registerExperiment`
 * hashes and freezes, so a later change of a library default can never change
 * what an existing hash certifies.
 */
export interface ResolvedExperimentConfig extends ExperimentConfig {
  readonly trial: { readonly bitsPerTrial: number; readonly clock: TrialClock }
  readonly calibration: 'theoretical' | readonly Calibration[] | { readonly trials: number }
  readonly events: readonly EventSpec[]
  readonly missing: 'error' | 'skip'
  readonly anchors: RegistrationAnchors
}

/**
 * Re-analysis of an archived run under its registration WITHOUT re-burning a
 * calibration window: pass the result's own calibrations. They must match
 * the registered calibration spec (`invalid_config` otherwise), and the
 * result embeds the registration hash. The exact reproducing call is
 * `analyzeTrials(result.series, { registration, calibration: result.calibration })`.
 */
export interface Reanalysis {
  readonly registration: RegisteredExperiment
  readonly calibration: readonly Calibration[]
}

/**
 * 'complete': the whole window was recorded and the statistic is defined.
 * 'incomplete': the window extends past the recorded data (or a Date window
 * has not closed), or no usable data lies inside it — value, df, pValue and z
 * are NaN and the event is excluded from the composite.
 */
export type EventStatus = 'complete' | 'incomplete'

export interface EventResult {
  id: string
  label?: string
  statistic: EventStatistic
  status: EventStatus
  /** Why the event is incomplete (absent for complete events). */
  reason?: string
  /** The statistic (NaN when incomplete). */
  value: number
  /** Degrees of freedom — for netvar steps with ≥ 1 present source, for devvar present cells, for correlation and covar present pairs (NaN when incomplete). */
  df: number
  /** One-sided p-value (NaN when incomplete). */
  pValue: number
  /** Normal-equivalent z of the one-sided pValue — the composite input (NaN when incomplete). */
  z: number
  /** Steps of the window covered by the recorded data (the full window length when complete). */
  steps: number
  /**
   * cumsum(Z_s² − 1) over the covered steps, Z_s the Stouffer Z over the
   * sources present at each step (a step with none present adds 0) — plot
   * alongside significanceEnvelope(steps).
   */
  cumulative: Float64Array
  sources: readonly string[]
}

export interface ExperimentComposite {
  /** Composite z across the complete events. NaN when there were none. */
  z: number
  /** One-sided p-value of `z` (NaN when there were no complete events). */
  pValue: number
  /** Complete events combined. */
  events: number
  /** True when no two combined events share an analysed step. */
  independent: boolean
  /**
   * 'stouffer': Σzₑ/√E (independent events). 'brown': Brown's (1975)
   * covariance correction in its Stouffer form, Σzₑ/√(Σᵢⱼ ρᵢⱼ) (Strube 1985),
   * with ρ the H0 correlation of the event statistics from their shared steps.
   */
  method: 'stouffer' | 'brown'
  /** Var(Σzₑ) under H0: E when independent, Σᵢⱼ ρᵢⱼ under Brown. 0 without events. */
  variance: number
  /** Why the composite is NaN or dependent. */
  reason?: string
}

export interface ExperimentResult {
  /** One result per configured event, in configuration order. */
  events: readonly EventResult[]
  composite: ExperimentComposite
  /** One calibration per archived series, in series order. */
  calibration: readonly Calibration[]
  /**
   * Full archival trial data (post-calibration split), never truncated —
   * under missing:'skip' a NaN sum marks an absent trial. Re-analysis without
   * re-running: pass it back with `calibration: result.calibration`.
   */
  series: readonly TrialSeries[]
  /** Step-aligned rows the event windows index into (the longest post-burn series). */
  analysedSteps: number
  /** SHA-256 hash of the pre-registered config, when one was used. */
  registration?: string
}
