import { type Calibration, calibrate, theoreticalCalibration } from '@mindpeeker/negentropy'
import { PsiError } from '../errors.js'
import type { TrialSeries } from '../types.js'

/** A wall-clock event window over recorded trial timestamps: `[startMs, endMs)`. */
export interface EventWindow {
  startMs: number
  endMs: number
}

/**
 * An index-based window `[startStep, endStep)` over step-aligned series. For
 * lock-step recordings (`recordSession`) a series index *is* the round, so
 * this selects identical rounds from every source by construction.
 */
export interface StepWindow {
  startStep: number
  endStep: number
}

/** Either window form accepted by the GCP analyses. */
export type AnalysisWindow = EventWindow | StepWindow

/**
 * How trials are normalized to z-scores:
 * - `'theoretical'` (default) — Binomial(k, ½): $z = (x - k/2)/\sqrt{k/4}$.
 * - `Calibration[]` — one pre-fit calibration per source (matched by name),
 *   e.g. from negentropy's `calibrate` on a disjoint resting window.
 * - `{ history }` — fit an empirical mean/sd per source on these series
 *   (negentropy `calibrate`, at least `minTrials`, default 500) — the GCP
 *   formal-series convention of per-device empirical normalization (Nelson &
 *   Bancel 2011) or GCP 2.0's previous-24-h fit. The history must be disjoint
 *   from the analyzed window: normalizing data with parameters fit on itself
 *   deflates every statistic.
 */
export type CalibrationOption =
  | 'theoretical'
  | readonly Calibration[]
  | { readonly history: readonly TrialSeries[]; readonly minTrials?: number }

export function isStepWindow(window: AnalysisWindow): window is StepWindow {
  return typeof window === 'object' && window !== null && 'startStep' in window
}

/** Validate a step window against the shortest series; returns the kept indices. */
export function stepRange(window: StepWindow, available: number): { start: number; end: number } {
  const { startStep, endStep } = window
  if (
    !Number.isInteger(startStep) ||
    !Number.isInteger(endStep) ||
    startStep < 0 ||
    startStep >= endStep
  ) {
    throw new PsiError(
      'invalid_plan',
      `step window [${startStep}, ${endStep}) must be non-negative integers with startStep < endStep`,
    )
  }
  if (endStep > available) {
    throw new PsiError(
      'insufficient_data',
      `step window [${startStep}, ${endStep}) extends past the ${available} recorded steps`,
    )
  }
  return { start: startStep, end: endStep }
}

/** Validate an ms window. */
export function assertEventWindow(window: EventWindow): void {
  if (
    typeof window !== 'object' ||
    window === null ||
    !Number.isFinite(window.startMs) ||
    !Number.isFinite(window.endMs) ||
    window.startMs >= window.endMs
  ) {
    throw new PsiError(
      'invalid_plan',
      `event window [${window?.startMs}, ${window?.endMs}) is empty, inverted, or not finite`,
    )
  }
}

/**
 * One canonical timestamp per lock-step round: the latest per-source stamp at
 * that index (the moment the round completed). Requires equal-length series
 * with finite timestamps.
 */
export function roundTimestamps(seriesBySource: readonly TrialSeries[]): Float64Array {
  const steps = (seriesBySource[0] as TrialSeries).sums.length
  const rounds = new Float64Array(steps).fill(Number.NEGATIVE_INFINITY)
  for (const s of seriesBySource) {
    const ts = s.timestamps
    if (!ts || ts.length !== s.sums.length || s.sums.length !== steps) {
      throw new PsiError(
        'bad_record',
        `${s.source} needs one timestamp per trial and ${steps} trials for round alignment`,
        { source: s.source },
      )
    }
    for (let i = 0; i < steps; i++) {
      const t = ts[i] as number
      if (!Number.isFinite(t)) {
        throw new PsiError('bad_record', `${s.source} trial ${i} has a non-finite timestamp`, {
          source: s.source,
        })
      }
      if (t > (rounds[i] as number)) rounds[i] = t
    }
  }
  return rounds
}

/** Resolve the calibration option into one calibration per source (aligned with the input). */
export function resolveCalibrations(
  seriesBySource: readonly TrialSeries[],
  option: CalibrationOption | undefined,
  eventWindow?: EventWindow,
): Calibration[] {
  const bitsPerTrial = (seriesBySource[0] as TrialSeries).bitsPerTrial
  if (option === undefined || option === 'theoretical') {
    return seriesBySource.map((s) => theoreticalCalibration(s.source, bitsPerTrial))
  }
  if (Array.isArray(option as unknown)) {
    return seriesBySource.map((s) => {
      const matches = (option as readonly Calibration[]).filter((c) => c?.source === s.source)
      if (matches.length !== 1) {
        throw new PsiError(
          'invalid_plan',
          `expected exactly one calibration for ${s.source}, got ${matches.length}`,
          { source: s.source },
        )
      }
      const cal = matches[0] as Calibration
      if (
        cal.bitsPerTrial !== s.bitsPerTrial ||
        !Number.isFinite(cal.mean) ||
        !Number.isFinite(cal.sd) ||
        !(cal.sd > 0)
      ) {
        throw new PsiError(
          'invalid_plan',
          `calibration for ${s.source} needs bitsPerTrial ${s.bitsPerTrial}, a finite mean, and sd > 0`,
          { source: s.source },
        )
      }
      return cal
    })
  }
  if (typeof option === 'object' && option !== null && 'history' in option) {
    const history = option.history
    if (!Array.isArray(history as unknown)) {
      throw new PsiError('invalid_plan', 'calibration history must be an array of TrialSeries')
    }
    return seriesBySource.map((s) => {
      const fit = history.filter((h) => h?.source === s.source)
      if (fit.length !== 1) {
        throw new PsiError(
          'invalid_plan',
          `expected exactly one calibration history series for ${s.source}, got ${fit.length}`,
          { source: s.source },
        )
      }
      const h = fit[0] as TrialSeries
      if (h === s) {
        throw new PsiError(
          'invalid_plan',
          `calibration history for ${s.source} is the analyzed series itself — fit on a disjoint window`,
          { source: s.source },
        )
      }
      if (h.bitsPerTrial !== s.bitsPerTrial) {
        throw new PsiError(
          'invalid_plan',
          `calibration history for ${s.source} has ${h.bitsPerTrial}-bit trials, the series ${s.bitsPerTrial}`,
          { source: s.source },
        )
      }
      if (eventWindow && h.timestamps) {
        for (const t of h.timestamps) {
          if (t >= eventWindow.startMs && t < eventWindow.endMs) {
            throw new PsiError(
              'invalid_plan',
              `calibration history for ${s.source} overlaps the event window`,
              { source: s.source },
            )
          }
        }
      }
      try {
        return calibrate(h, option.minTrials !== undefined ? { minTrials: option.minTrials } : {})
      } catch (error) {
        const code = (error as { code?: string }).code
        throw new PsiError(
          code === 'insufficient_data' ? 'insufficient_data' : 'invalid_plan',
          `cannot calibrate ${s.source} from its history: ${(error as Error).message}`,
          { source: s.source, cause: error },
        )
      }
    })
  }
  throw new PsiError(
    'invalid_plan',
    "calibration must be 'theoretical', a Calibration[], or { history }",
  )
}
