/**
 * Schreiber transfer entropy over discrete symbol streams (Schreiber 2000,
 * "Measuring Information Transfer", Phys. Rev. Lett. 85, 461), implemented
 * as plug-in conditional mutual information over embedded state counts.
 */

import { cmiEvaluate, finalize } from './internal/cmi.js'
import { setupTransferEntropy, sourceBlock } from './internal/embedding.js'

/** Embedding parameters shared by every transfer-entropy estimator. */
export interface LocalTransferEntropyOptions {
  /** Destination history length $k \ge 1$. Default 1. */
  k?: number
  /** Source history length $l \ge 1$. Default 1. */
  l?: number
  /**
   * Source→destination lag $u \ge 1$: the most recent source symbol used to
   * predict $y_{t+1}$ is $x_{t-u+1}$. Default 1 (Schreiber's convention —
   * the source value one step before the predicted sample).
   */
  lag?: number
  /**
   * Alphabet size $A$ over BOTH streams; symbols must lie in $[0, A)$.
   * Default: inferred per stream as `max(symbol) + 1`. Affects validation and
   * key packing only, never the estimate (the χ² test's degrees of freedom do
   * use it — see `chiSquareTest`).
   */
  alphabet?: number
}

export interface TransferEntropyOptions extends LocalTransferEntropyOptions {
  /**
   * Apply the Miller–Madow correction $\frac{K - 1}{2N\ln 2}$ to each of the
   * four entropy terms of the CMI decomposition; the net correction is
   * $\frac{K_{y^+y^k} + K_{y^k x^l} - K_{y^+ y^k x^l} - K_{y^k}}{2N\ln 2}$.
   * Corrected estimates are not clamped and may be negative. Default `false`.
   */
  millerMadow?: boolean
}

/** Pointwise (local) transfer entropy, aligned to the destination stream. */
export interface LocalTransferEntropyResult {
  /**
   * `values[t]` is the local TE for predicting `dest[t]` (Lizier's
   * $te(x \to y, t)$ attributed to the predicted sample); `NaN` through the
   * embedding warm-up prefix `[0, start)`.
   */
  readonly values: Float64Array
  /** Index of the first finite local value: $\max(k - 1,\; u + l - 2) + 1$. */
  readonly start: number
  /** Arithmetic mean of the locals — exactly the plug-in transfer entropy. */
  readonly mean: number
  /** Number of embedded tuples that entered the estimate. */
  readonly count: number
}

/**
 * Schreiber (2000) transfer entropy from `source` $X$ to `dest` $Y$, in bits:
 * $$TE_{X \to Y} = \sum p(y_{t+1}, y_t^{(k)}, x^{(l)})
 *   \log_2 \frac{p(y_{t+1} \mid y_t^{(k)}, x^{(l)})}{p(y_{t+1} \mid y_t^{(k)})}$$
 * where $y_t^{(k)} = (y_t, \dots, y_{t-k+1})$ and
 * $x^{(l)} = (x_{t-u+1}, \dots, x_{t-u-l+2})$ with lag $u \ge 1$. Estimated
 * by plug-in counts over embedded states — equivalently the plug-in
 * conditional mutual information $\hat I(Y_{t+1}; X^{(l)} \mid Y_t^{(k)})$.
 * Mathematically non-negative; floating-point dust below zero is clamped to
 * 0 unless `millerMadow` is set.
 */
export function transferEntropy(
  source: ArrayLike<number>,
  dest: ArrayLike<number>,
  opts: TransferEntropyOptions = {},
): number {
  const setup = setupTransferEntropy('transferEntropy', source, dest, opts)
  return finalize(cmiEvaluate(setup.base, sourceBlock(setup)), opts.millerMadow === true)
}

/**
 * Local (pointwise) transfer entropy (Lizier, Prokopenko & Zomaya 2008,
 * "Local information transfer as a spatiotemporal filter"): for each
 * predicted sample $y_{t+1}$,
 * $$te(x \to y, t+1) = \log_2 \frac{\hat p(y_{t+1} \mid y_t^{(k)}, x^{(l)})}
 *   {\hat p(y_{t+1} \mid y_t^{(k)})}$$
 * Locals can be negative (the source *misinforms* about that step); their
 * mean is exactly the plug-in {@link transferEntropy}. The Miller–Madow
 * correction has no pointwise analogue, so it is not an option here.
 */
export function localTransferEntropy(
  source: ArrayLike<number>,
  dest: ArrayLike<number>,
  opts: LocalTransferEntropyOptions = {},
): LocalTransferEntropyResult {
  const setup = setupTransferEntropy('localTransferEntropy', source, dest, opts)
  const values = new Float64Array(setup.xs.symbols.length).fill(Number.NaN)
  const start = setup.first + 1
  const value = cmiEvaluate(setup.base, sourceBlock(setup), values, start)
  return { values, start, mean: value.plugin, count: setup.count }
}

/**
 * Net directed flow $TE_{X \to Y} - TE_{Y \to X}$ in bits, positive when the
 * dominant direction of information transfer is $X \to Y$. Both directions
 * use the same $(k, l, u)$ embedding. Sign is meaningful, magnitude inherits
 * the plug-in bias of both terms — prefer {@link effectiveTransferEntropy}
 * or a permutation test before reading anything into small values.
 */
export function netTransferEntropy(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  opts: TransferEntropyOptions = {},
): number {
  return transferEntropy(x, y, opts) - transferEntropy(y, x, opts)
}
