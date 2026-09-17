import { PsiError } from '../errors.js'
import { closeIterator, nextOrAbort } from '../internal/abort.js'
import { asyncIteratorOf } from '../internal/iterate.js'
import {
  type BinomialBayesModel,
  type BinomialBayesOptions,
  lnBf10Unchecked,
  resolveBinomialModel,
} from './binomial.js'

/**
 * One increment of a Bernoulli stream: a single outcome `0 | 1`, or
 * `{ k, n }` — $k$ successes among $n \ge 1$ *new* trials (e.g. one
 * 200-bit trial as `{ k: sum, n: 200 }`, or a forced-choice session as
 * `{ k: hits, n: sessions }`). Counts accumulate; they are never totals.
 */
export type CoinObservation = 0 | 1 | { readonly k: number; readonly n: number }

/** Options for {@link CoinEProcess} and {@link coinEProcess}. */
export interface CoinEProcessOptions extends BinomialBayesOptions {
  /**
   * Level of the stop rule: reject $H_0$ once the running maximum of
   * $BF_{10}$ reaches $1/\alpha$ (anytime p ≤ α). In $(0, 1)$. Default 0.05.
   */
  alpha?: number
}

/** The e-process state after an observation. */
export interface CoinEProcessPoint {
  /** Cumulative successes. */
  readonly k: number
  /** Cumulative trials. */
  readonly n: number
  /** $\ln BF_{10}$ at the current counts (one-sided per `alternative`). */
  readonly lnBf10: number
  readonly bf10: number
  /** $\ln \max_{s \le n} BF_{10}(s)$, including the start value $BF_{10}(0) = 1$. */
  readonly lnMaxBf10: number
  readonly maxBf10: number
  /** Anytime-valid p: $\min(1,\, 1/\max_{s \le n} BF_{10}(s))$. */
  readonly anytimeP: number
  /** The stop rule has fired: `anytimeP ≤ alpha`. Stays true once reached. */
  readonly reject: boolean
}

function point(
  k: number,
  n: number,
  lnBf10: number,
  lnMax: number,
  alpha: number,
): CoinEProcessPoint {
  const anytimeP = Math.min(1, Math.exp(-lnMax))
  return Object.freeze({
    k,
    n,
    lnBf10,
    bf10: Math.exp(lnBf10),
    lnMaxBf10: lnMax,
    maxBf10: Math.exp(lnMax),
    anytimeP,
    // compare in log space: exp rounding must not decide a boundary case
    reject: lnMax >= -Math.log(alpha),
  })
}

/** Validate one observation into a `{ k, n }` increment. */
export function observationCounts(observation: CoinObservation): { k: number; n: number } {
  if (observation === 0 || observation === 1) return { k: observation, n: 1 }
  if (observation !== null && typeof observation === 'object') {
    const { k, n } = observation
    if (typeof n === 'number' && Number.isSafeInteger(n) && n >= 1) {
      if (typeof k === 'number' && Number.isInteger(k) && k >= 0 && k <= n) return { k, n }
    }
    throw new PsiError(
      'invalid_plan',
      `observation { k: ${String(k)}, n: ${String(n)} } needs integers n ≥ 1 and 0 ≤ k ≤ n`,
    )
  }
  throw new PsiError(
    'invalid_plan',
    `observation must be 0, 1, or { k, n }, got ${String(observation)}`,
  )
}

/** Validate the stop-rule level. */
export function assertAlpha(alpha: unknown): number {
  if (typeof alpha !== 'number' || !(alpha > 0 && alpha < 1)) {
    throw new PsiError('invalid_plan', `alpha must be in (0, 1), got ${String(alpha)}`)
  }
  return alpha
}

/**
 * Anytime-valid test of a coin (any Bernoulli stream) against the chance
 * probability $p_0$: the running Bayes factor
 * $$M_n = BF_{10}(k_n, n) = \frac{B(k_n+a,\; n-k_n+b)}{B(a,b)\; p_0^{k_n}(1-p_0)^{n-k_n}}$$
 * (see `binomialLogBayesFactor`) is a nonnegative martingale with $M_0 = 1$
 * under $H_0$ whenever the Beta prior is fixed in advance — it is the
 * likelihood ratio averaged over a prior, i.e. a *test martingale* (Shafer,
 * Shen, Vereshchagin & Vovk 2011, *Statistical Science* 26:84). Ville's
 * inequality then bounds
 * $$P_{H_0}\big(\exists n: M_n \ge 1/\alpha\big) \le \alpha$$
 * for *every* monitoring and stopping strategy, so
 * $p^{\text{anytime}}_n = \min(1, 1/\max_{s \le n} M_s)$ is a valid p-value at
 * any data-dependent stopping time. A fixed-n p-value checked after every
 * trial rejects a fair coin with probability tending to 1 (law of the iterated
 * logarithm); this one does not. One-sided alternatives (`alternative`) use the
 * truncated prior and are test martingales too.
 *
 * Stateful and synchronous; see {@link coinEProcess} for streams.
 *
 * @throws {PsiError} `invalid_plan` for bad options (constructor) or a
 *   malformed observation / count overflow past $2^{53}$ (`update`, which
 *   leaves the state unchanged).
 */
export class CoinEProcess {
  /** The resolved prior and null. */
  readonly model: BinomialBayesModel
  /** Stop-rule level. */
  readonly alpha: number
  #k = 0
  #n = 0
  #lnMax = 0
  #current: CoinEProcessPoint

  constructor(opts: CoinEProcessOptions = {}) {
    this.model = resolveBinomialModel(opts)
    this.alpha = assertAlpha(opts.alpha ?? 0.05)
    this.#current = point(0, 0, 0, 0, this.alpha)
  }

  /** The latest point — before any data, $n = 0$ and $BF_{10} = 1$. */
  get current(): CoinEProcessPoint {
    return this.#current
  }

  /** Add one observation and return the updated point. */
  update(observation: CoinObservation): CoinEProcessPoint {
    const { k, n } = observationCounts(observation)
    const totalN = this.#n + n
    if (!Number.isSafeInteger(totalN)) {
      throw new PsiError('invalid_plan', `cumulative trials exceed 2^53 − 1 (${totalN})`)
    }
    this.#k += k
    this.#n = totalN
    const lnBf10 = lnBf10Unchecked(this.#k, this.#n, this.model)
    if (lnBf10 > this.#lnMax) this.#lnMax = lnBf10
    this.#current = point(this.#k, this.#n, lnBf10, this.#lnMax, this.alpha)
    return this.#current
  }
}

/** Options for {@link coinEProcess}. */
export interface CoinEProcessStreamOptions extends CoinEProcessOptions {
  /**
   * End the stream right after the first point with `reject: true` (the stop
   * rule), closing the input. Default `false`: one point per observation.
   */
  stopOnReject?: boolean
  signal?: AbortSignal
}

/**
 * Stream form of {@link CoinEProcess}: yields one {@link CoinEProcessPoint}
 * per observation of a sync or async iterable. Options are validated when
 * the stream is created (before any pull); `stopOnReject: true` ends the
 * stream at the stop rule and closes the input. The input iterator is closed
 * on completion, error, abort, or a consumer `break`.
 *
 * @throws {PsiError} `invalid_plan` (bad options immediately; a malformed
 *   observation when pulled), `aborted` when `signal` fires.
 */
export function coinEProcess(
  input: Iterable<CoinObservation> | AsyncIterable<CoinObservation>,
  opts: CoinEProcessStreamOptions = {},
): AsyncGenerator<CoinEProcessPoint> {
  const process = new CoinEProcess(opts)
  const stopOnReject = opts.stopOnReject ?? false
  if (typeof stopOnReject !== 'boolean') {
    throw new PsiError(
      'invalid_plan',
      `stopOnReject must be a boolean, got ${String(stopOnReject)}`,
    )
  }
  return stream(process, asyncIteratorOf(input, 'coinEProcess input'), stopOnReject, opts.signal)
}

async function* stream(
  process: CoinEProcess,
  iterator: AsyncIterator<CoinObservation>,
  stopOnReject: boolean,
  signal: AbortSignal | undefined,
): AsyncGenerator<CoinEProcessPoint> {
  const onAbort = () => new PsiError('aborted', 'coin e-process aborted')
  try {
    while (true) {
      const next = await nextOrAbort(iterator, signal, onAbort)
      if (next.done) {
        if (signal?.aborted) throw onAbort()
        return
      }
      const current = process.update(next.value)
      yield current
      if (stopOnReject && current.reject) return
    }
  } finally {
    await closeIterator(iterator, signal?.aborted === true)
  }
}
