/**
 * Information storage in a single symbol stream — the companions of transfer
 * entropy in Lizier's local information dynamics: block entropy, entropy
 * rate, active information storage (Lizier, Prokopenko & Zomaya 2012,
 * "Local measures of information storage in complex distributed computation",
 * Information Sciences 208, 39–54) and finite-length predictive information
 * (Bialek, Nemenman & Tishby 2001; Crutchfield & Feldman 2003). All are
 * plug-in count estimates in bits over overlapping embedded blocks, so for
 * every history length $k$ the exact identity
 * $A_X(k) + h_\mu(k) = \hat H(X_{t+1})$ holds over the same predicted samples.
 */

import type { EntropyOptions } from './entropy.js'
import { FlowError } from './errors.js'
import { cmiBase, cmiEvaluate, conditionalEntropy, finalize } from './internal/cmi.js'
import { assertCount, integerOption, prepareSeries } from './internal/embedding.js'
import { constantKeys, lagBlock, type SymbolSeries } from './internal/keys.js'
import { entropyFromCounts, validateAlphabetOption } from './internal/symbols.js'

/** Options for the storage measures: history length plus alphabet / Miller–Madow. */
export interface StorageOptions extends EntropyOptions {
  /** History (past block) length $k \ge 1$. Default 1. */
  k?: number
}

/** Options for {@link predictiveInformation}. */
export interface PredictiveInformationOptions extends StorageOptions {
  /** Future block length $k_f \ge 1$. Default: `k`. */
  kFuture?: number
}

/** Pointwise active information storage, aligned to the predicted sample. */
export interface LocalActiveInformationStorageResult {
  /** `values[t]` is the local AIS for predicting `x[t]`; `NaN` for `t < start`. */
  readonly values: Float64Array
  /** Index of the first finite local value: $k$. */
  readonly start: number
  /** Arithmetic mean of the locals — exactly the plug-in AIS. */
  readonly mean: number
  /** Number of embedded tuples: $n - k$. */
  readonly count: number
}

interface Prepared {
  readonly series: SymbolSeries
  readonly k: number
  readonly count: number
}

function prepare(
  what: string,
  x: ArrayLike<number>,
  opts: StorageOptions,
  futureLength: number,
): Prepared {
  const k = integerOption(opts.k, 'k', 1)
  const alphabet = validateAlphabetOption(opts.alphabet)
  const series = prepareSeries(x, 'x', alphabet)
  const n = series.symbols.length
  const count = n - k - futureLength + 1
  assertCount(`${what} with k=${k}`, count, k + futureLength + 1, n)
  return { series, k, count }
}

function aisValue(what: string, x: ArrayLike<number>, opts: StorageOptions, locals: boolean) {
  const { series, k, count } = prepare(what, x, opts, 1)
  const first = k - 1
  const base = cmiBase(lagBlock(series, first, count, -1, 1), constantKeys(count))
  const values = locals ? new Float64Array(series.symbols.length).fill(Number.NaN) : undefined
  const value = cmiEvaluate(base, lagBlock(series, first, count, 0, k), values, k)
  return { value, values, k, count }
}

/**
 * Active information storage (Lizier et al. 2012), in bits:
 * $$A_X(k) = \hat I\!\left(X_t^{(k)};\, X_{t+1}\right)
 *   = \sum p(x_t^{(k)}, x_{t+1}) \log_2 \frac{p(x_{t+1} \mid x_t^{(k)})}{p(x_{t+1})}$$
 * over the $n - k$ predicted samples $x_k, \dots, x_{n-1}$ — how much of the
 * next symbol the stream's own past predicts. A period-$p$ sequence stores
 * $\log_2 p$ bits for $k \ge p - 1$; iid symbols store ≈ 0 (plus the plug-in
 * bias). Clamped at 0 unless `millerMadow` is set.
 */
export function activeInformationStorage(x: ArrayLike<number>, opts: StorageOptions = {}): number {
  const { value } = aisValue('activeInformationStorage', x, opts, false)
  return finalize(value, opts.millerMadow === true)
}

/**
 * Local active information storage $a_X(k, t+1) = \log_2 \frac{\hat p(x_{t+1}
 * \mid x_t^{(k)})}{\hat p(x_{t+1})}$ for every predicted sample; negative
 * values mark steps where the past *misinformed*. The mean is exactly the
 * plug-in {@link activeInformationStorage}. `millerMadow` is ignored (no
 * pointwise analogue).
 */
export function localActiveInformationStorage(
  x: ArrayLike<number>,
  opts: StorageOptions = {},
): LocalActiveInformationStorageResult {
  const { value, values, k, count } = aisValue('localActiveInformationStorage', x, opts, true)
  return { values: values as Float64Array, start: k, mean: value.plugin, count }
}

/**
 * Finite-history entropy rate, in bits per symbol:
 * $$h_\mu(k) = \hat H\!\left(X_{t+1} \mid X_t^{(k)}\right)
 *   = \hat H(X_t^{(k)}, X_{t+1}) - \hat H(X_t^{(k)})$$
 * over the same $n - k$ predicted samples as {@link activeInformationStorage},
 * so $A_X(k) + h_\mu(k) = \hat H(x_k, \dots, x_{n-1})$ exactly (up to
 * rounding). With `millerMadow` both joint terms are corrected, a net
 * $\frac{K_{x^{(k)} x^+} - K_{x^{(k)}}}{2N \ln 2}$. A deterministic (e.g.
 * periodic) stream has rate 0; iid uniform symbols approach $\log_2 A$.
 */
export function entropyRate(x: ArrayLike<number>, opts: StorageOptions = {}): number {
  const { series, k, count } = prepare('entropyRate', x, opts, 1)
  const first = k - 1
  const base = cmiBase(lagBlock(series, first, count, -1, 1), lagBlock(series, first, count, 0, k))
  const h = conditionalEntropy(base, opts.millerMadow === true)
  return opts.millerMadow === true ? h : Math.max(0, h)
}

/**
 * Block entropy $\hat H(X^{(k)})$ of the $n - k + 1$ overlapping length-$k$
 * blocks $(x_t, \dots, x_{t+k-1})$, in bits (PyInform's `block_entropy`). For
 * $k = 1$ it equals `shannonEntropy`. $\hat H(X^{(k+1)}) - \hat H(X^{(k)})$
 * approximates the entropy rate from blocks.
 */
export function blockEntropy(x: ArrayLike<number>, k: number, opts: EntropyOptions = {}): number {
  if (!Number.isInteger(k) || k < 1) {
    throw new FlowError('invalid_input', `k must be an integer ≥ 1, got ${k}`)
  }
  const alphabet = validateAlphabetOption(opts.alphabet)
  const series = prepareSeries(x, 'x', alphabet)
  const n = series.symbols.length
  const count = n - k + 1
  if (count < 1) {
    throw new FlowError('insufficient_data', `blockEntropy with k=${k} needs at least ${k} samples`)
  }
  const keys: ArrayLike<number | string> = lagBlock(series, k - 1, count, 0, k).keys
  const cells = new Map<number | string, number>()
  for (let i = 0; i < count; i++) {
    const key = keys[i] as number | string
    cells.set(key, (cells.get(key) ?? 0) + 1)
  }
  return entropyFromCounts(cells.values(), count, opts.millerMadow === true)
}

/**
 * Finite-length predictive information (excess entropy estimate), in bits:
 * $$E(k, k_f) = \hat I\!\left(X_t^{(k)};\, X_{t+1}^{(k_f)}\right),\quad
 *   x_{t+1}^{(k_f)} = (x_{t+1}, \dots, x_{t+k_f})$$
 * over the $n - k - k_f + 1$ overlapping past/future block pairs — the
 * mutual information between a length-$k$ past and a length-$k_f$ future
 * (Bialek, Nemenman & Tishby 2001; Crutchfield & Feldman 2003). With
 * $k_f = 1$ it is exactly {@link activeInformationStorage}. Needs
 * $N \gg A^{k + k_f}$ samples to mean anything. Clamped at 0 unless
 * `millerMadow` is set.
 */
export function predictiveInformation(
  x: ArrayLike<number>,
  opts: PredictiveInformationOptions = {},
): number {
  const kFuture = integerOption(opts.kFuture, 'kFuture', integerOption(opts.k, 'k', 1))
  const { series, k, count } = prepare('predictiveInformation', x, opts, kFuture)
  const first = k - 1
  const future = lagBlock(series, first, count, -kFuture, kFuture) // x_{t+kf} … x_{t+1}
  const base = cmiBase(future, constantKeys(count))
  const value = cmiEvaluate(base, lagBlock(series, first, count, 0, k))
  return finalize(value, opts.millerMadow === true)
}
