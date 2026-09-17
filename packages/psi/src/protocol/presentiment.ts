import { normalP, theoreticalCalibration, zScores } from '@mindpeeker/negentropy'
import { KahanSum } from '@mindpeeker/negentropy/numerics'
import { PsiError } from '../errors.js'
import type { Seed } from '../internal/prng.js'
import { assertSeries } from '../internal/validate.js'
import {
  describeLabelShuffle,
  type LabelShuffleDescription,
  type LabelShuffleOptions,
  labelShuffleSurrogates,
  permutationP,
} from '../resample/surrogates.js'
import type { Stimulus, TrialSeries } from '../types.js'
import { assertStimulus, type PresentimentEpoch } from './presentiment-epochs.js'

export type {
  PresentimentEpoch,
  PresentimentEpochs,
  PresentimentEvent,
  PresentimentPlan,
} from './presentiment-epochs.js'
export { presentimentEpochs } from './presentiment-epochs.js'

/** A pre- or post-window summary: pooled Stouffer z of the target−control difference. */
export interface WindowEffect {
  /** Standard-normal statistic $(Z_{\text{target}} - Z_{\text{control}})/\sqrt2$ under H0. */
  readonly deltaZ: number
  /** One-sided p (H1: target deviates upward more than control). */
  readonly pValue: number
  readonly targetTrials: number
  readonly controlTrials: number
}

/** Options for {@link analyzePresentiment}: the label-shuffle null. */
export interface AnalyzePresentimentOptions {
  /** Relabelings to draw (permutation method). Default 100 — p resolution 1/101. */
  surrogates?: number
  /** PRNG seed of the relabelings — part of the pre-registration. Default `0`. */
  seed?: Seed
  /** `'permutation'` (default) or the opt-in cyclic `'rotation'` group. */
  method?: 'permutation' | 'rotation'
}

/** The result of {@link analyzePresentiment}. */
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
  /** The null ensemble behind `permutationP`: method, $m$, distinct labelings, resolution. */
  readonly shuffle: LabelShuffleDescription
}

/** Per-epoch Σz and trial count of one window — computed once, reused by every relabeling. */
interface WindowSums {
  readonly sums: Float64Array
  readonly counts: Float64Array
}

function windowSums(
  epochs: readonly PresentimentEpoch[],
  pick: (e: PresentimentEpoch) => TrialSeries,
  source: string,
  bitsPerTrial: number,
): WindowSums {
  const cal = theoreticalCalibration(source, bitsPerTrial)
  const sums = new Float64Array(epochs.length)
  const counts = new Float64Array(epochs.length)
  epochs.forEach((epoch, i) => {
    const zs = zScores(pick(epoch), cal)
    const acc = new KahanSum()
    for (const z of zs) acc.add(z)
    sums[i] = acc.value
    counts[i] = zs.length
  })
  return { sums, counts }
}

function windowEffect(w: WindowSums, labels: readonly Stimulus[]): WindowEffect {
  const target = new KahanSum()
  const control = new KahanSum()
  let targetTrials = 0
  let controlTrials = 0
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === 'target') {
      target.add(w.sums[i] as number)
      targetTrials += w.counts[i] as number
    } else {
      control.add(w.sums[i] as number)
      controlTrials += w.counts[i] as number
    }
  }
  // pooled Stouffer z per group: N(0,1) under H0, independent → difference is N(0,2)
  const deltaZ =
    (target.value / Math.sqrt(targetTrials) - control.value / Math.sqrt(controlTrials)) / Math.SQRT2
  return { deltaZ, pValue: normalP(deltaZ, 'upper'), targetTrials, controlTrials }
}

/**
 * Analyze presentiment epochs. For the pre-stimulus window the primary
 * statistic is the common-mode-cancelling difference
 * $$\Delta z = \frac{Z_{\text{target}} - Z_{\text{control}}}{\sqrt2} \sim N(0,1)$$
 * of the pooled Stouffer z-scores of target vs control epochs. Each pooled
 * z is standard normal under H0 and the two are independent *provided the
 * epochs are disjoint* (as `presentimentEpochs` enforces by default), so the
 * difference is exact for any epoch counts, and drift shared by nearby
 * target/control epochs cancels. `permutationP` additionally tests it against
 * label-shuffle surrogates (seeded count-preserving permutations, or exact
 * enumeration when few relabelings exist — see `labelShuffleSurrogates`),
 * the honest null for whether the target/control assignment itself explains
 * the pre-stimulus deviation; `shuffle` reports that ensemble. `post` repeats
 * the analysis on the post-stimulus window as the ordinary-causality control.
 *
 * This is the *RNG analogue* of the physiological presentiment protocols
 * (skin conductance, heart rate, EEG): a directional mean-shift test on trial
 * sums. A variance/netvar variant and physiological-signal epoching are not
 * computed here.
 *
 * Per-epoch window sums are computed once, so each relabeling costs
 * O(epochs).
 *
 * @throws {PsiError} `insufficient_data` (no epochs; no target or no control
 *   epoch; an empty window), `invalid_plan` (unknown stimulus label, malformed
 *   window series, bad shuffle options), `source_mismatch` (mixed sources or
 *   `bitsPerTrial`).
 */
export function analyzePresentiment(
  epochs: readonly PresentimentEpoch[],
  opts: AnalyzePresentimentOptions = {},
): PresentimentAnalysis {
  if (!Array.isArray(epochs as unknown) || epochs.length === 0) {
    throw new PsiError('insufficient_data', 'analyzePresentiment needs at least one epoch')
  }
  if (opts === null || typeof opts !== 'object') {
    throw new PsiError('invalid_plan', 'analyzePresentiment options must be an object')
  }
  let source = ''
  let bitsPerTrial = 0
  let targetEpochs = 0
  let controlEpochs = 0
  epochs.forEach((epoch, index) => {
    const what = `epoch ${index}`
    if (epoch === null || typeof epoch !== 'object') {
      throw new PsiError('invalid_plan', `${what} must be an object`)
    }
    const stimulus = assertStimulus(epoch.stimulus, what)
    for (const [series, window] of [
      [epoch.pre, 'pre'],
      [epoch.post, 'post'],
    ] as const) {
      assertSeries(series, `${what} ${window}`)
      if (index === 0 && window === 'pre') {
        source = series.source
        bitsPerTrial = series.bitsPerTrial
      }
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
    if (stimulus === 'target') targetEpochs++
    else controlEpochs++
  })
  if (targetEpochs === 0 || controlEpochs === 0) {
    throw new PsiError(
      'insufficient_data',
      'analyzePresentiment needs at least one target and one control epoch',
      { source },
    )
  }
  const shuffleOptions: LabelShuffleOptions = {
    ...(opts.method !== undefined && { method: opts.method }),
    ...(opts.surrogates !== undefined && { surrogates: opts.surrogates }),
    ...(opts.seed !== undefined && { seed: opts.seed }),
  }
  const stimuli = epochs.map((e) => e.stimulus)
  const shuffle = describeLabelShuffle(stimuli, shuffleOptions)
  const preSums = windowSums(epochs, (e) => e.pre, source, bitsPerTrial)
  const postSums = windowSums(epochs, (e) => e.post, source, bitsPerTrial)
  const pre = windowEffect(preSums, stimuli)
  const post = windowEffect(postSums, stimuli)
  const surrogateDeltas: number[] = []
  for (const relabel of labelShuffleSurrogates(stimuli, shuffleOptions)) {
    surrogateDeltas.push(windowEffect(preSums, relabel).deltaZ)
  }
  return Object.freeze({
    source,
    bitsPerTrial,
    targetEpochs,
    controlEpochs,
    pre: Object.freeze(pre),
    post: Object.freeze(post),
    permutationP: permutationP(pre.deltaZ, surrogateDeltas),
    shuffle,
  })
}
