/**
 * Schreiber transfer entropy over discrete symbol streams (Schreiber 2000,
 * "Measuring Information Transfer", Phys. Rev. Lett. 85, 461), implemented
 * as plug-in conditional mutual information over embedded state counts.
 */

import { FlowError } from './errors.js'
import { KahanSum } from './internal/kahan.js'
import {
  makeEncoder,
  type StateKey,
  validateAlphabetOption,
  validateSymbols,
} from './internal/symbols.js'

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
   * Default: inferred as `max(symbol) + 1` across both streams. Affects
   * validation and key packing only, never the estimate.
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

interface TeCore {
  readonly n: number
  readonly start: number
  readonly locals: Float64Array // length n, NaN prefix
  readonly plugin: number // mean of locals (unclamped)
  readonly mmCorrection: number
}

function teCore(
  source: ArrayLike<number>,
  dest: ArrayLike<number>,
  opts: LocalTransferEntropyOptions,
): TeCore {
  const k = opts.k ?? 1
  const l = opts.l ?? 1
  const u = opts.lag ?? 1
  if (!Number.isInteger(k) || k < 1) {
    throw new FlowError('invalid_input', `k must be an integer ≥ 1, got ${k}`)
  }
  if (!Number.isInteger(l) || l < 1) {
    throw new FlowError('invalid_input', `l must be an integer ≥ 1, got ${l}`)
  }
  if (!Number.isInteger(u) || u < 1) {
    throw new FlowError('invalid_input', `lag must be an integer ≥ 1, got ${u}`)
  }
  if (source.length !== dest.length) {
    throw new FlowError(
      'invalid_input',
      `source and dest must be aligned: source has ${source.length} samples, dest has ${dest.length}`,
    )
  }
  const alphabetOpt = validateAlphabetOption(opts.alphabet)
  const { symbols: xs, maxSymbol: mx } = validateSymbols(source, 'source', alphabetOpt)
  const { symbols: ys, maxSymbol: my } = validateSymbols(dest, 'dest', alphabetOpt)
  const n = ys.length
  const tMin = Math.max(k - 1, u + l - 2)
  const count = n - 1 - tMin
  if (count < 2) {
    throw new FlowError(
      'insufficient_data',
      `transfer entropy with k=${k}, l=${l}, lag=${u} needs at least ${tMin + 3} samples, got ${n}`,
    )
  }
  const alphabet = alphabetOpt ?? Math.max(mx, my) + 1

  // Four marginalizations of the embedded joint state (see entropy.ts):
  //   dp = y_t^{(k)}   df = (y_t^{(k)}, y_{t+1})   sp = (y_t^{(k)}, x^{(l)})   full = all three
  const encDp = makeEncoder(alphabet, k)
  const encDf = makeEncoder(alphabet, k + 1)
  const encSp = makeEncoder(alphabet, k + l)
  const encFull = makeEncoder(alphabet, k + l + 1)
  const dp = new Map<StateKey, number>()
  const df = new Map<StateKey, number>()
  const sp = new Map<StateKey, number>()
  const full = new Map<StateKey, number>()
  const dpKeys = new Array<StateKey>(count)
  const dfKeys = new Array<StateKey>(count)
  const spKeys = new Array<StateKey>(count)
  const fullKeys = new Array<StateKey>(count)
  const buf = new Int32Array(k + l + 1) // [y past (k) | x past (l) | y future]
  const dfBuf = new Int32Array(k + 1) // [y past (k) | y future]

  for (let i = 0; i < count; i++) {
    const t = tMin + i
    for (let j = 0; j < k; j++) buf[j] = ys[t - j] as number
    for (let j = 0; j < l; j++) buf[k + j] = xs[t - u + 1 - j] as number
    buf[k + l] = ys[t + 1] as number
    for (let j = 0; j < k; j++) dfBuf[j] = buf[j] as number
    dfBuf[k] = buf[k + l] as number

    const kDp = encDp.encode(buf, k)
    const kSp = encSp.encode(buf, k + l)
    const kFull = encFull.encode(buf, k + l + 1)
    const kDf = encDf.encode(dfBuf, k + 1)
    dpKeys[i] = kDp
    spKeys[i] = kSp
    fullKeys[i] = kFull
    dfKeys[i] = kDf
    dp.set(kDp, (dp.get(kDp) ?? 0) + 1)
    sp.set(kSp, (sp.get(kSp) ?? 0) + 1)
    full.set(kFull, (full.get(kFull) ?? 0) + 1)
    df.set(kDf, (df.get(kDf) ?? 0) + 1)
  }

  const locals = new Float64Array(n).fill(Number.NaN)
  const sum = new KahanSum()
  for (let i = 0; i < count; i++) {
    const cFull = full.get(fullKeys[i] as StateKey) as number
    const cDp = dp.get(dpKeys[i] as StateKey) as number
    const cSp = sp.get(spKeys[i] as StateKey) as number
    const cDf = df.get(dfKeys[i] as StateKey) as number
    const local = Math.log2((cFull * cDp) / (cSp * cDf))
    locals[tMin + 1 + i] = local
    sum.add(local)
  }
  const mmCorrection = (df.size + sp.size - full.size - dp.size) / (2 * count * Math.LN2)
  return { n: count, start: tMin + 1, locals, plugin: sum.value / count, mmCorrection }
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
  const core = teCore(source, dest, opts)
  if (opts.millerMadow === true) return core.plugin + core.mmCorrection
  return Math.max(0, core.plugin)
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
  const core = teCore(source, dest, opts)
  return { values: core.locals, start: core.start, mean: core.plugin, count: core.n }
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
