import { NegentropyError } from '../errors.js'
import { negentropyExp, negentropyKurtosis, negentropyLogcosh } from './negentropy.js'
import { negentropyVasicek } from './vasicek.js'

export type WindowedEstimator = 'kurtosis' | 'logcosh' | 'exp' | 'vasicek'

export interface WindowedNegentropyOptions {
  /** Samples per window (≥ 8). */
  windowSize: number
  /** Samples between emissions. Default windowSize (non-overlapping). */
  hopSize?: number
  /** Default 'logcosh'. 'vasicek' needs continuous input — dither lattice data first. */
  estimator?: WindowedEstimator
  signal?: AbortSignal
}

export interface WindowedNegentropyPoint {
  /** Emission counter, from 0. */
  index: number
  /** Input-sample index at which this window starts. */
  startSample: number
  /** The window's negentropy. NaN for a degenerate (constant) window. */
  j: number
}

/**
 * Rolling negentropy over a sample stream — the "when did order appear?"
 * view. Lazy and pull-based; every emission recomputes the batch estimator
 * on the current window, so streamed values are EXACTLY the batch values on
 * the corresponding slices. Accepts numbers or byte chunks (bytes enter as
 * their numeric values — estimators standardize internally).
 */
export async function* windowedNegentropy(
  input: AsyncIterable<number | Uint8Array> | Iterable<number | Uint8Array>,
  opts: WindowedNegentropyOptions,
): AsyncGenerator<WindowedNegentropyPoint> {
  const { windowSize } = opts
  if (!Number.isInteger(windowSize) || windowSize < 8) {
    throw new NegentropyError(
      'invalid_config',
      `windowSize must be an integer ≥ 8, got ${windowSize}`,
    )
  }
  const hop = opts.hopSize ?? windowSize
  if (!Number.isInteger(hop) || hop < 1) {
    throw new NegentropyError('invalid_config', `hopSize must be a positive integer, got ${hop}`)
  }
  const estimator = opts.estimator ?? 'logcosh'
  const estimate = (window: Float64Array): number => {
    switch (estimator) {
      case 'kurtosis':
        return negentropyKurtosis(window).j
      case 'logcosh':
        return negentropyLogcosh(window).j
      case 'exp':
        return negentropyExp(window).j
      case 'vasicek':
        return negentropyVasicek(window)
    }
  }
  const ring = new Float64Array(windowSize)
  let pushed = 0
  let nextEmitAt = windowSize
  let index = 0

  function* push(value: number): Generator<WindowedNegentropyPoint> {
    ring[pushed % windowSize] = value
    pushed++
    if (pushed >= nextEmitAt) {
      // unroll the ring into window order (oldest first)
      const window = new Float64Array(windowSize)
      const head = pushed % windowSize
      for (let i = 0; i < windowSize; i++) window[i] = ring[(head + i) % windowSize] as number
      yield { index: index++, startSample: pushed - windowSize, j: estimate(window) }
      nextEmitAt += hop
    }
  }

  if (opts.signal?.aborted) {
    throw new NegentropyError('aborted', 'windowed negentropy aborted before start')
  }
  for await (const item of input) {
    if (opts.signal?.aborted) {
      throw new NegentropyError('aborted', 'windowed negentropy aborted')
    }
    if (typeof item === 'number') {
      yield* push(item)
    } else {
      for (let i = 0; i < item.length; i++) yield* push(item[i] as number)
    }
  }
}
