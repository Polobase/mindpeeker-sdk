import { PsiError } from '../errors.js'
import { assertInteger, assertSeries } from '../internal/validate.js'
import type { Stimulus, TrialSeries } from '../types.js'

/**
 * One presentiment epoch: the trials `pre` a stimulus and the trials `post` it,
 * tagged by whether the stimulus was a `target` or a `control`. The pre-window
 * is where the presentiment (time-reversed) effect is claimed; the post-window
 * is the ordinary-causality sanity control.
 */
export interface PresentimentEpoch {
  readonly stimulus: Stimulus
  readonly pre: TrialSeries
  readonly post: TrialSeries
}

/** A stimulus event in a continuous recording. */
export interface PresentimentEvent {
  /** Trial index of the stimulus: the first post-window trial. Integer. */
  readonly at: number
  readonly stimulus: Stimulus
  /**
   * Epoch ms at which the stimulus label was drawn (e.g. the timestamp of the
   * random draw that chose target vs control). When given, the epoch is kept
   * only if the label was drawn strictly after the pre-window closed — after
   * the completion stamp `timestamps[at − 1]` of its last pre-stimulus trial.
   */
  readonly labelDrawnAt?: number
}

/** Window sizes and overlap policy for segmenting a recording into epochs. */
export interface PresentimentPlan {
  /** Trials taken before each stimulus. Integer ≥ 1. */
  preWindow: number
  /** Trials taken at/after each stimulus. Integer ≥ 1. */
  postWindow: number
  /**
   * Keep epochs whose windows overlap (reported via `overlapping` and a
   * warning) instead of throwing. Default `false`: overlapping epochs share
   * trials, so the pooled z-scores are neither independent nor $N(0,1)$.
   */
  allowOverlap?: boolean
}

/** The result of {@link presentimentEpochs}. */
export interface PresentimentEpochs {
  /** Kept epochs, in event order. */
  readonly epochs: PresentimentEpoch[]
  /** Events dropped for any reason: `droppedOutOfRange + droppedProvenance`. */
  readonly dropped: number
  /** Events whose pre or post window falls outside the recording. */
  readonly droppedOutOfRange: number
  /** Events whose label was drawn before the pre-window closed (or at an unknown time). */
  readonly droppedProvenance: number
  /** Kept epochs whose window intersects another kept epoch's (only non-zero with `allowOverlap`). */
  readonly overlapping: number
  /** Human-readable caveats (e.g. overlap); empty for a clean design. */
  readonly warnings: readonly string[]
}

const STIMULI: readonly Stimulus[] = ['target', 'control']

/** Throw `invalid_plan` unless the label is a known {@link Stimulus}. */
export function assertStimulus(stimulus: unknown, what: string): Stimulus {
  if (!STIMULI.includes(stimulus as Stimulus)) {
    throw new PsiError(
      'invalid_plan',
      `${what} stimulus must be 'target' or 'control', got ${String(stimulus)}`,
    )
  }
  return stimulus as Stimulus
}

/**
 * Segment one continuous recording into presentiment epochs around stimulus
 * events: `pre` is `series[at − preWindow, at)` and `post` is
 * `series[at, at + postWindow)`. Deterministic and pure.
 *
 * - **Range.** Events whose windows fall outside the recording are dropped
 *   (`droppedOutOfRange`), never truncated.
 * - **Label provenance.** An event with `labelDrawnAt` is dropped
 *   (`droppedProvenance`) unless the label was drawn strictly after
 *   `series.timestamps[at − 1]`, the moment the pre-window's data were
 *   fixed; a non-finite stamp there cannot vouch for the order and also drops
 *   the epoch. In the physiological protocols the picture was "selected at
 *   random by the computer only a millisecond in advance" of display — the
 *   claim collapses if the label can be known while the pre-window is open.
 * - **Overlap.** Kept epochs must satisfy $at_{i+1} - at_i \ge$
 *   `preWindow + postWindow` (sorted by `at`), so no trial is pooled twice;
 *   otherwise `invalid_plan` — or, with `allowOverlap`, the epochs are kept,
 *   counted in `overlapping`, and a warning is returned.
 *
 * @throws {PsiError} `invalid_plan` for a malformed series or plan, a
 *   non-integer `at`, an unknown stimulus label, a non-finite `labelDrawnAt`,
 *   `labelDrawnAt` without series timestamps, or overlapping epochs.
 */
export function presentimentEpochs(
  series: TrialSeries,
  events: readonly PresentimentEvent[],
  plan: PresentimentPlan,
): PresentimentEpochs {
  assertSeries(series)
  if (plan === null || typeof plan !== 'object') {
    throw new PsiError('invalid_plan', 'presentiment plan must be an object')
  }
  const preWindow = assertInteger(plan.preWindow, 1, 'preWindow')
  const postWindow = assertInteger(plan.postWindow, 1, 'postWindow')
  const allowOverlap = plan.allowOverlap ?? false
  if (typeof allowOverlap !== 'boolean') {
    throw new PsiError(
      'invalid_plan',
      `allowOverlap must be a boolean, got ${String(allowOverlap)}`,
    )
  }
  if (!Array.isArray(events as unknown)) {
    throw new PsiError('invalid_plan', 'events must be an array')
  }
  const n = series.sums.length
  const timestamps = series.timestamps
  const slice = (from: number, to: number): TrialSeries =>
    Object.freeze({
      source: series.source,
      bitsPerTrial: series.bitsPerTrial,
      sums: series.sums.slice(from, to),
      ...(timestamps && { timestamps: timestamps.slice(from, to) }),
    })
  const kept: { at: number; index: number; epoch: PresentimentEpoch }[] = []
  let droppedOutOfRange = 0
  let droppedProvenance = 0
  events.forEach((event, index) => {
    const what = `event ${index}`
    if (event === null || typeof event !== 'object') {
      throw new PsiError('invalid_plan', `${what} must be an object`)
    }
    if (typeof event.at !== 'number' || !Number.isInteger(event.at)) {
      throw new PsiError('invalid_plan', `${what} at must be an integer, got ${String(event.at)}`)
    }
    const stimulus = assertStimulus(event.stimulus, what)
    const drawnAt = event.labelDrawnAt
    if (drawnAt !== undefined) {
      if (typeof drawnAt !== 'number' || !Number.isFinite(drawnAt)) {
        throw new PsiError(
          'invalid_plan',
          `${what} labelDrawnAt must be a finite epoch-ms number, got ${String(drawnAt)}`,
        )
      }
      if (!timestamps || timestamps.length !== n) {
        throw new PsiError(
          'invalid_plan',
          `${what} has labelDrawnAt, but the series has no per-trial timestamps to check it against`,
          { source: series.source },
        )
      }
    }
    if (event.at - preWindow < 0 || event.at + postWindow > n) {
      droppedOutOfRange++
      return
    }
    if (drawnAt !== undefined) {
      const closed = (timestamps as ArrayLike<number>)[event.at - 1] as number
      if (!(Number.isFinite(closed) && drawnAt > closed)) {
        droppedProvenance++
        return
      }
    }
    kept.push({
      at: event.at,
      index,
      epoch: Object.freeze({
        stimulus,
        pre: slice(event.at - preWindow, event.at),
        post: slice(event.at, event.at + postWindow),
      }),
    })
  })
  const span = preWindow + postWindow
  const sorted = [...kept].sort((a, b) => a.at - b.at || a.index - b.index)
  const overlaps = new Set<number>()
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1] as (typeof sorted)[number]
    const next = sorted[i] as (typeof sorted)[number]
    if (next.at - prev.at < span) {
      if (!allowOverlap) {
        throw new PsiError(
          'invalid_plan',
          `events ${prev.index} (at ${prev.at}) and ${next.index} (at ${next.at}) overlap: consecutive stimuli need at least preWindow + postWindow = ${span} trials between them (or allowOverlap)`,
          { source: series.source },
        )
      }
      overlaps.add(prev.index)
      overlaps.add(next.index)
    }
  }
  const warnings =
    overlaps.size > 0
      ? [
          `${overlaps.size} of ${kept.length} epochs overlap: pooled windows share trials, so deltaZ is not N(0,1) and its p-values are not valid`,
        ]
      : []
  return Object.freeze({
    epochs: kept.map((k) => k.epoch),
    dropped: droppedOutOfRange + droppedProvenance,
    droppedOutOfRange,
    droppedProvenance,
    overlapping: overlaps.size,
    warnings: Object.freeze(warnings),
  })
}
