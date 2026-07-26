import { normalP, stoufferZ, theoreticalCalibration, zScores } from '@mindpeeker/negentropy'
import { PsiError } from '../errors.js'
import { labelShuffleSurrogates, permutationP } from '../resample/surrogates.js'
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

/** Window sizes for segmenting a continuous recording into epochs. */
export interface PresentimentPlan {
  /** Trials taken before each stimulus. Integer ≥ 1. */
  preWindow: number
  /** Trials taken at/after each stimulus. Integer ≥ 1. */
  postWindow: number
}

/** A pre- or post-window summary: pooled Stouffer z of the target−control difference. */
export interface WindowEffect {
  /** Standard-normal statistic $(Z_{\text{target}} - Z_{\text{control}})/\sqrt2$ under H0. */
  readonly deltaZ: number
  /** One-sided p (H1: target deviates upward more than control). */
  readonly pValue: number
  readonly targetTrials: number
  readonly controlTrials: number
}

export interface PresentimentAnalysis {
  readonly source: string
  readonly bitsPerTrial: number
  readonly targetEpochs: number
  readonly controlEpochs: number
  /** The presentiment claim: pre-stimulus target−control deviation. */
  readonly pre: WindowEffect
  /** Sanity control: a genuine stimulus response shows here, in ordinary time. */
  readonly post: WindowEffect
  /** Label-shuffle permutation p of the pre-window `deltaZ` — the honest null. */
  readonly permutationP: number
}

/** Pooled Stouffer z over one label group's trials in a chosen window. */
function pooledZ(
  epochs: readonly PresentimentEpoch[],
  pick: (e: PresentimentEpoch) => TrialSeries,
  source: string,
  bitsPerTrial: number,
): { z: number; trials: number } {
  const pool: number[] = []
  for (const epoch of epochs) {
    const series = pick(epoch)
    const cal = theoreticalCalibration(source, bitsPerTrial)
    for (const z of zScores(series, cal)) pool.push(z)
  }
  return { z: pool.length > 0 ? stoufferZ(pool) : Number.NaN, trials: pool.length }
}

function windowEffect(
  epochs: readonly PresentimentEpoch[],
  stimuli: readonly Stimulus[],
  pick: (e: PresentimentEpoch) => TrialSeries,
  source: string,
  bitsPerTrial: number,
): WindowEffect {
  const target = epochs.filter((_, i) => stimuli[i] === 'target')
  const control = epochs.filter((_, i) => stimuli[i] === 'control')
  const t = pooledZ(target, pick, source, bitsPerTrial)
  const c = pooledZ(control, pick, source, bitsPerTrial)
  // each pooled Stouffer z is N(0,1) under H0, independent → difference is N(0,2)
  const deltaZ = (t.z - c.z) / Math.SQRT2
  return {
    deltaZ,
    pValue: normalP(deltaZ, 'upper'),
    targetTrials: t.trials,
    controlTrials: c.trials,
  }
}

/**
 * Analyze presentiment epochs. For the pre-stimulus window the primary
 * statistic is the common-mode-cancelling difference
 * $$\Delta z = \frac{Z_{\text{target}} - Z_{\text{control}}}{\sqrt2} \sim N(0,1)$$
 * of the pooled Stouffer z-scores of target vs control epochs (each already
 * standard normal under H0, so the difference is exact for any epoch counts,
 * and any drift shared by nearby target/control epochs cancels). The
 * `permutationP` field additionally tests it against label-shuffle surrogates
 * — the honest null for whether the target/control assignment itself explains
 * the pre-stimulus deviation. `post` repeats the analysis on the
 * post-stimulus window as the ordinary-causality sanity control.
 *
 * Requires ≥ 1 target and ≥ 1 control epoch, all from one source at one
 * `bitsPerTrial`. This is a *directional mean-shift* presentiment test; a
 * variance/netvar-based variant is a documented alternative, not computed here.
 */
export function analyzePresentiment(epochs: readonly PresentimentEpoch[]): PresentimentAnalysis {
  if (epochs.length === 0) {
    throw new PsiError('insufficient_data', 'analyzePresentiment needs at least one epoch')
  }
  const first = epochs[0] as PresentimentEpoch
  const source = first.pre.source
  const bitsPerTrial = first.pre.bitsPerTrial
  let targetEpochs = 0
  let controlEpochs = 0
  for (const epoch of epochs) {
    for (const series of [epoch.pre, epoch.post]) {
      if (series.source !== source) {
        throw new PsiError(
          'source_mismatch',
          `epochs mix sources: '${series.source}' and '${source}'`,
        )
      }
      if (series.bitsPerTrial !== bitsPerTrial) {
        throw new PsiError(
          'source_mismatch',
          `epochs mix bitsPerTrial: ${series.bitsPerTrial} and ${bitsPerTrial}`,
          { source },
        )
      }
    }
    if (epoch.pre.sums.length === 0 || epoch.post.sums.length === 0) {
      throw new PsiError('insufficient_data', 'every epoch needs non-empty pre and post windows', {
        source,
      })
    }
    if (epoch.stimulus === 'target') targetEpochs++
    else controlEpochs++
  }
  if (targetEpochs === 0 || controlEpochs === 0) {
    throw new PsiError(
      'insufficient_data',
      'analyzePresentiment needs at least one target and one control epoch',
      { source },
    )
  }
  const stimuli = epochs.map((e) => e.stimulus)
  const pre = windowEffect(epochs, stimuli, (e) => e.pre, source, bitsPerTrial)
  const post = windowEffect(epochs, stimuli, (e) => e.post, source, bitsPerTrial)
  // label-shuffle null on the pre-window deltaZ
  const surrogateDeltas: number[] = []
  for (const relabel of labelShuffleSurrogates(stimuli)) {
    surrogateDeltas.push(windowEffect(epochs, relabel, (e) => e.pre, source, bitsPerTrial).deltaZ)
  }
  return Object.freeze({
    source,
    bitsPerTrial,
    targetEpochs,
    controlEpochs,
    pre: Object.freeze(pre),
    post: Object.freeze(post),
    permutationP:
      surrogateDeltas.length > 0 ? permutationP(pre.deltaZ, surrogateDeltas) : Number.NaN,
  })
}

/**
 * Segment one continuous recording into presentiment epochs around stimulus
 * events. Each event is a trial index into `series` with its stimulus label;
 * `pre` is `series[at − preWindow, at)` and `post` is `series[at, at + postWindow)`.
 * Events whose windows fall outside the recording are dropped (reported via
 * the returned `dropped` count) rather than truncated. Deterministic and pure.
 */
export function presentimentEpochs(
  series: TrialSeries,
  events: readonly { at: number; stimulus: Stimulus }[],
  plan: PresentimentPlan,
): { epochs: PresentimentEpoch[]; dropped: number } {
  if (!Number.isInteger(plan.preWindow) || plan.preWindow < 1) {
    throw new PsiError('invalid_plan', `preWindow must be an integer ≥ 1, got ${plan.preWindow}`)
  }
  if (!Number.isInteger(plan.postWindow) || plan.postWindow < 1) {
    throw new PsiError('invalid_plan', `postWindow must be an integer ≥ 1, got ${plan.postWindow}`)
  }
  const n = series.sums.length
  const slice = (from: number, to: number): TrialSeries =>
    Object.freeze({
      source: series.source,
      bitsPerTrial: series.bitsPerTrial,
      sums: series.sums.slice(from, to),
      ...(series.timestamps && { timestamps: series.timestamps.slice(from, to) }),
    })
  const epochs: PresentimentEpoch[] = []
  let dropped = 0
  for (const event of events) {
    if (
      !Number.isInteger(event.at) ||
      event.at - plan.preWindow < 0 ||
      event.at + plan.postWindow > n
    ) {
      dropped++
      continue
    }
    epochs.push(
      Object.freeze({
        stimulus: event.stimulus,
        pre: slice(event.at - plan.preWindow, event.at),
        post: slice(event.at, event.at + plan.postWindow),
      }),
    )
  }
  return { epochs, dropped }
}
