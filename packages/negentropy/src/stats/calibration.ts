import { NegentropyError } from '../errors.js'
import { Welford } from '../internal/welford.js'
import type { Calibration, TrialSeries } from '../types.js'
import { DEFAULT_BITS_PER_TRIAL } from './trials.js'

/** Binomial(k, ½) null: mean k/2, sd √(k/4). The default when a source is trusted unbiased. */
export function theoreticalCalibration(
  source: string,
  bitsPerTrial: number = DEFAULT_BITS_PER_TRIAL,
): Calibration {
  return {
    source,
    bitsPerTrial,
    trials: 0,
    mean: bitsPerTrial / 2,
    sd: Math.sqrt(bitsPerTrial / 4),
    basis: 'theoretical',
  }
}

export interface CalibrateOptions {
  /** Minimum trials the fit demands. Default 500 — a noisy sd biases every downstream χ². */
  minTrials?: number
}

/**
 * Fit empirical mean/sd on a recorded resting-state series. The calibration
 * window must be disjoint from any window later analyzed — normalizing data
 * with parameters fit on itself deflates every statistic.
 */
export function calibrate(series: TrialSeries, opts: CalibrateOptions = {}): Calibration {
  const minTrials = opts.minTrials ?? 500
  if (series.sums.length < minTrials) {
    throw new NegentropyError(
      'insufficient_data',
      `calibration needs ≥ ${minTrials} trials, got ${series.sums.length}`,
      { source: series.source },
    )
  }
  const acc = new Welford()
  for (const sum of series.sums) acc.push(sum)
  const sd = acc.sd
  if (!(sd > 0)) {
    throw new NegentropyError(
      'insufficient_data',
      'calibration series is constant — the source produced no variation to normalize against',
      { source: series.source },
    )
  }
  return {
    source: series.source,
    bitsPerTrial: series.bitsPerTrial,
    trials: acc.n,
    mean: acc.mean,
    sd,
    basis: 'empirical',
  }
}
