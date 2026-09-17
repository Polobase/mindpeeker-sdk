/**
 * Surrogate-based significance for transfer entropy. The plug-in TE of two
 * finite independent streams is positive (estimation bias), so a raw TE value
 * alone means nothing — compare it against a surrogate ensemble (here) or, in
 * the adequately sampled regime, against its asymptotic χ² null
 * (`chiSquareTest`).
 */

import { FlowError } from './errors.js'
import { cmiEvaluate, finalize } from './internal/cmi.js'
import { setupTransferEntropy, sourceBlock, type TeSetup } from './internal/embedding.js'
import { type KeyColumn, permuteKeys } from './internal/keys.js'
import {
  drawSurrogates,
  resolveSurrogates,
  type SurrogateDraw,
  type SurrogateInfo,
  type SurrogateOptions,
  summarize,
} from './internal/surrogate-plan.js'
import type { TransferEntropyOptions } from './transfer.js'

export type { SurrogateInfo, SurrogateMethod, SurrogateOptions } from './internal/surrogate-plan.js'

/** Options for {@link permutationTest}: the TE embedding plus the surrogate configuration. */
export interface PermutationTestOptions extends TransferEntropyOptions, SurrogateOptions {}

/** Result of {@link permutationTest}. */
export interface PermutationTestResult {
  /** Observed transfer entropy $TE_{X \to Y}$ in bits. */
  readonly te: number
  /** The surrogate TE ensemble, in generation order (offsets $1 \dots n-1$ when exact). */
  readonly surrogates: Float64Array
  /**
   * One-sided empirical p-value with the add-one correction
   * $$p = \frac{1 + \left|\{ TE_{surr} \ge TE_{obs} \}\right|}{1 + n_{surr}}$$
   * (Davison & Hinkley 1997 §4.2; North, Curtis & Sham 2002). Never exactly
   * zero — the observed statistic counts as a member of its own null. Values
   * within a relative $10^{-12}$ of the observed TE count as ties
   * (conservative: equal count tables summed in a different order). For an
   * exact rotation test this is the exact permutation p over all $n$ rotations.
   */
  readonly p: number
  /** Mean of the surrogate ensemble — the bias floor under this null. */
  readonly mean: number
  /** Sample standard deviation ($n - 1$ denominator) of the ensemble; `NaN` for one surrogate. */
  readonly sd: number
  /**
   * Descriptive z-score $(TE - \text{mean}) / \text{sd}$ (JIDT's
   * `getTSscore`); ±∞ when sd = 0 and TE differs from the mean, 0 when equal.
   * The null is not normal — use `p` for decisions.
   */
  readonly z: number
  /**
   * Number of distinct surrogate TE values (ties within $10^{-12}$ merged) —
   * the effective resolution of the null. Far below `surrogates.length` means
   * the null is coarse (e.g. short series under `'circularShift'`).
   */
  readonly distinct: number
  /** The surrogate configuration actually used. */
  readonly surrogate: SurrogateInfo
}

/** TE of one surrogate draw under a prepared set-up. */
export function surrogateTransferEntropy(
  setup: TeSetup,
  draw: SurrogateDraw,
  observedSource: KeyColumn,
  millerMadow: boolean,
): number {
  const source =
    draw.kind === 'series'
      ? sourceBlock(setup, { symbols: draw.symbols, radix: setup.xs.radix })
      : permuteKeys(observedSource, draw.perm)
  return finalize(cmiEvaluate(setup.base, source), millerMadow)
}

/** Shared engine of `permutationTest` and `transferEntropyReport`. */
export function runPermutationTest(
  what: string,
  source: ArrayLike<number>,
  dest: ArrayLike<number>,
  opts: PermutationTestOptions,
): { readonly result: PermutationTestResult; readonly setup: TeSetup } {
  const n = typeof source?.length === 'number' ? source.length : 0
  const info = resolveSurrogates(opts, n)
  const setup = setupTransferEntropy(what, source, dest, opts)
  const mm = opts.millerMadow === true
  const observedSource = sourceBlock(setup)
  const te = finalize(cmiEvaluate(setup.base, observedSource), mm)
  const surrogates = new Float64Array(info.n)
  let i = 0
  for (const draw of drawSurrogates(info, setup.xs.symbols, setup.count)) {
    surrogates[i++] = surrogateTransferEntropy(setup, draw, observedSource, mm)
  }
  const summary = summarize(te, surrogates)
  return { result: { te, surrogates, ...summary, surrogate: info }, setup }
}

/**
 * Permutation test of $TE_{X \to Y}$ against a surrogate-source null: the
 * source is repeatedly resampled under the chosen `surrogate` method and TE
 * re-estimated with identical embedding parameters, so observed and surrogate
 * statistics share the same plug-in bias. Every option is validated before
 * any estimate runs; deterministic for a given seed.
 *
 * Surrogate count: the smallest attainable p is $1/(n_{surr} + 1)$, so a test
 * at level α needs at least $1/α - 1$ surrogates (19 for 0.05, 99 for 0.01);
 * 199–999 gives a stable p near the threshold.
 */
export function permutationTest(
  source: ArrayLike<number>,
  dest: ArrayLike<number>,
  opts: PermutationTestOptions = {},
): PermutationTestResult {
  return runPermutationTest('permutationTest', source, dest, opts).result
}

/** Options for {@link effectiveTransferEntropy} (shuffle null only). */
export interface EffectiveTransferEntropyOptions extends TransferEntropyOptions {
  /** Number of source shuffles averaged into the bias estimate. Default 20. */
  surrogates?: number
  /**
   * @deprecated Renamed to `surrogates` in 0.2.0; still accepted. Passing both
   * with different values throws `invalid_input`.
   */
  nShuffles?: number
  /** Seed for the xoshiro128** surrogate PRNG (non-negative safe integer). Default `0x9e3779b9`. */
  seed?: number
}

/** Result of {@link effectiveTransferEntropy}. */
export interface EffectiveTransferEntropyResult {
  /** Observed plug-in transfer entropy in bits. */
  readonly te: number
  /** Mean TE over the shuffled-source ensemble — the finite-sample bias floor. */
  readonly shuffleMean: number
  /**
   * Effective transfer entropy $ETE = TE - \overline{TE}_{shuffled}$. Can be
   * slightly negative when there is no genuine flow.
   */
  readonly ete: number
}

/**
 * Marschinski–Kantz effective transfer entropy (2002, "Analysing the
 * information flow between financial time series", Eur. Phys. J. B 30, 275):
 * $$ETE_{X \to Y} = TE_{X \to Y} - \left\langle TE_{X_{shuffled} \to Y} \right\rangle$$
 * Shuffling the source keeps its marginal distribution but removes every
 * temporal dependency, so the shuffled ensemble's mean estimates the
 * finite-sample bias of the plug-in estimator; subtracting it recentres
 * "no flow" at ≈ 0. Deterministic for a given seed.
 */
export function effectiveTransferEntropy(
  source: ArrayLike<number>,
  dest: ArrayLike<number>,
  opts: EffectiveTransferEntropyOptions = {},
): EffectiveTransferEntropyResult {
  if (
    opts.surrogates !== undefined &&
    opts.nShuffles !== undefined &&
    opts.surrogates !== opts.nShuffles
  ) {
    throw new FlowError(
      'invalid_input',
      `surrogates (${opts.surrogates}) and its deprecated alias nShuffles (${opts.nShuffles}) disagree`,
    )
  }
  const count = opts.surrogates ?? opts.nShuffles ?? 20
  const { result } = runPermutationTest('effectiveTransferEntropy', source, dest, {
    ...opts,
    surrogates: count,
    surrogate: 'shuffle',
  })
  return { te: result.te, shuffleMean: result.mean, ete: result.te - result.mean }
}
