/**
 * Interaction-delay reconstruction: transfer entropy as a function of the
 * source lag with a family-wise max-statistic surrogate test (Wibral et al.
 * 2013, "Measuring information-transfer delays", PLoS ONE 8, e55809; the
 * maximum statistic of IDTxl, Novelli et al. 2019).
 */

import { FlowError } from './errors.js'
import { cmiEvaluate, finalize } from './internal/cmi.js'
import { integerOption, setupTransferEntropy, sourceBlock } from './internal/embedding.js'
import { type KeyColumn, permuteKeys } from './internal/keys.js'
import {
  atLeast,
  drawSurrogates,
  resolveSurrogates,
  type SurrogateInfo,
  type SurrogateOptions,
} from './internal/surrogate-plan.js'
import type { TransferEntropyOptions } from './transfer.js'

/** Options for {@link transferEntropyByLag}: embedding (without `lag`), lag range, level, surrogates. */
export interface TransferEntropyByLagOptions
  extends Omit<TransferEntropyOptions, 'lag'>,
    SurrogateOptions {
  /** Smallest lag scanned, ≥ 1. Default 1. */
  minLag?: number
  /** Largest lag scanned, ≥ `minLag`. Required. */
  maxLag: number
  /** Family-wise level for `threshold` / `significant`. Default 0.05. */
  alpha?: number
}

/** One lag of a {@link transferEntropyByLag} profile. */
export interface LagTransferEntropy {
  readonly lag: number
  /** TE at this lag in bits, over the scan's common tuple range. */
  readonly te: number
  /**
   * Max-statistic p-value $\frac{1 + |\{s : \max_u TE_s(u) \ge TE(lag)\}|}{1 + n_{surr}}$
   * — family-wise over every scanned lag.
   */
  readonly p: number
  /** `te > threshold`, equivalently `p ≤ alpha`. */
  readonly significant: boolean
}

/** Result of {@link transferEntropyByLag}. */
export interface TransferEntropyByLagResult {
  readonly lags: readonly LagTransferEntropy[]
  /** Lag with the largest TE (smallest such lag on ties). */
  readonly bestLag: number
  readonly te: number
  readonly p: number
  /**
   * Family-wise critical value: a lag is significant iff its TE exceeds it.
   * $+\infty$ when `surrogates` is too small for `alpha`
   * ($\lfloor α (n_{surr} + 1) \rfloor < 1$).
   */
  readonly threshold: number
  readonly alpha: number
  /** Per-surrogate maximum TE over all lags, in generation order. */
  readonly maxNull: Float64Array
  /** Tuples per lag (identical for every lag). */
  readonly count: number
  readonly surrogate: SurrogateInfo
}

/**
 * TE profile over lags $u = $ `minLag` … `maxLag` with a max-statistic null.
 * Every lag is evaluated over the SAME predicted samples — those valid at
 * `maxLag`, $t \ge \max(k - 1,\; u_{max} + l - 2)$ — so the values share
 * `count` and plug-in bias (and can differ slightly from `transferEntropy` at
 * that lag on the full range). Each surrogate draws ONE source resample (or
 * tuple permutation, applied to every lag) and contributes the maximum of its
 * TE profile; comparing each observed lag against that distribution controls
 * the family-wise error over the scan (the peak of a TE-vs-lag plot is
 * otherwise the analysis-flexibility trap). The true interaction delay
 * maximises TE (Wibral et al. 2013, also with feedback).
 */
export function transferEntropyByLag(
  source: ArrayLike<number>,
  dest: ArrayLike<number>,
  opts: TransferEntropyByLagOptions,
): TransferEntropyByLagResult {
  if (opts === null || typeof opts !== 'object') {
    throw new FlowError('invalid_input', 'transferEntropyByLag needs options with maxLag')
  }
  const minLag = integerOption(opts.minLag, 'minLag', 1)
  if (opts.maxLag === undefined) {
    throw new FlowError('invalid_input', 'transferEntropyByLag needs maxLag')
  }
  const maxLag = integerOption(opts.maxLag, 'maxLag', minLag, minLag)
  const alpha = opts.alpha ?? 0.05
  if (!(alpha > 0 && alpha < 1)) {
    throw new FlowError('invalid_input', `alpha must be in (0, 1), got ${alpha}`)
  }
  const k = integerOption(opts.k, 'k', 1)
  const l = integerOption(opts.l, 'l', 1)
  const n = typeof source?.length === 'number' ? source.length : 0
  const info = resolveSurrogates(opts, n)
  const first = Math.max(k - 1, maxLag + l - 2)
  const setup = setupTransferEntropy(
    'transferEntropyByLag',
    source,
    dest,
    opts,
    { k, l, lag: maxLag },
    first,
  )
  const mm = opts.millerMadow === true
  const lagCount = maxLag - minLag + 1
  const observedColumns: KeyColumn[] = []
  const observed = new Float64Array(lagCount)
  for (let i = 0; i < lagCount; i++) {
    const column = sourceBlock(setup, setup.xs, minLag + i)
    observedColumns.push(column)
    observed[i] = finalize(cmiEvaluate(setup.base, column), mm)
  }
  const maxNull = new Float64Array(info.n)
  let s = 0
  for (const draw of drawSurrogates(info, setup.xs.symbols, setup.count)) {
    let max = Number.NEGATIVE_INFINITY
    for (let i = 0; i < lagCount; i++) {
      const column =
        draw.kind === 'series'
          ? sourceBlock(setup, { symbols: draw.symbols, radix: setup.xs.radix }, minLag + i)
          : permuteKeys(observedColumns[i] as KeyColumn, draw.perm)
      const value = finalize(cmiEvaluate(setup.base, column), mm)
      if (value > max) max = value
    }
    maxNull[s++] = max
  }
  const sorted = Float64Array.from(maxNull).sort().reverse()
  const r = Math.floor(alpha * (info.n + 1)) - 1
  const threshold = r < 0 ? Number.POSITIVE_INFINITY : (sorted[r] as number)
  const lags: LagTransferEntropy[] = []
  let best = 0
  for (let i = 0; i < lagCount; i++) {
    const te = observed[i] as number
    let exceed = 0
    for (let j = 0; j < info.n; j++) if (atLeast(maxNull[j] as number, te)) exceed++
    const p = (1 + exceed) / (1 + info.n)
    lags.push({ lag: minLag + i, te, p, significant: p <= alpha })
    if (te > (observed[best] as number)) best = i
  }
  const bestEntry = lags[best] as LagTransferEntropy
  return {
    lags,
    bestLag: bestEntry.lag,
    te: bestEntry.te,
    p: bestEntry.p,
    threshold,
    alpha,
    maxNull,
    count: setup.count,
    surrogate: info,
  }
}
