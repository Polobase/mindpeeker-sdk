/**
 * Surrogate-based significance for transfer entropy. The plug-in TE of two
 * finite independent streams is positive (estimation bias), so a raw TE
 * value alone means nothing — significance here always comes from comparing
 * against surrogate ensembles, never from analytic tails.
 */

import { FlowError } from './errors.js'
import { xorshift32 } from './internal/prng.js'
import { circularShift, sourceShuffle } from './surrogates.js'
import { type TransferEntropyOptions, transferEntropy } from './transfer.js'

/** Which surrogate null the source is drawn from. */
export type SurrogateMethod = 'shuffle' | 'circularShift'

export interface PermutationTestOptions extends TransferEntropyOptions {
  /** Number of surrogate TEs to draw. Default 199 (min attainable p = 0.005). */
  surrogates?: number
  /** Surrogate generator for the source stream. Default `'shuffle'`. */
  surrogate?: SurrogateMethod
  /** Seed for the xorshift32 surrogate PRNG. Default `0x9e3779b9`. */
  seed?: number
}

export interface PermutationTestResult {
  /** Observed transfer entropy $TE_{X \to Y}$ in bits. */
  readonly te: number
  /** The surrogate TE ensemble, in generation order. */
  readonly surrogates: Float64Array
  /**
   * One-sided empirical p-value with the add-one correction
   * $$p = \frac{1 + \left|\{ TE_{surr} \ge TE_{obs} \}\right|}{1 + n_{surr}}$$
   * (Davison & Hinkley 1997 §4.2; North, Curtis & Sham 2002). Never exactly
   * zero — the observed statistic counts as a member of its own null.
   */
  readonly p: number
}

/**
 * Permutation test of $TE_{X \to Y}$ against a surrogate-source null: the
 * source is repeatedly shuffled (or circularly shifted) and TE re-estimated
 * with identical embedding parameters, so observed and surrogate statistics
 * share the same plug-in bias. Deterministic for a given seed.
 */
export function permutationTest(
  source: ArrayLike<number>,
  dest: ArrayLike<number>,
  opts: PermutationTestOptions = {},
): PermutationTestResult {
  const nSurrogates = opts.surrogates ?? 199
  if (!Number.isInteger(nSurrogates) || nSurrogates < 1) {
    throw new FlowError(
      'invalid_input',
      `surrogates must be a positive integer, got ${nSurrogates}`,
    )
  }
  const method = opts.surrogate ?? 'shuffle'
  const generate = method === 'shuffle' ? sourceShuffle : circularShift
  const te = transferEntropy(source, dest, opts)
  const rng = xorshift32(opts.seed)
  const surrogates = new Float64Array(nSurrogates)
  let atLeast = 0
  for (let i = 0; i < nSurrogates; i++) {
    const value = transferEntropy(generate(source, rng), dest, opts)
    surrogates[i] = value
    if (value >= te) atLeast++
  }
  return { te, surrogates, p: (1 + atLeast) / (1 + nSurrogates) }
}

export interface EffectiveTransferEntropyOptions extends TransferEntropyOptions {
  /** Number of source shuffles averaged into the bias estimate. Default 20. */
  nShuffles?: number
  /** Seed for the xorshift32 surrogate PRNG. Default `0x9e3779b9`. */
  seed?: number
}

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
  const nShuffles = opts.nShuffles ?? 20
  if (!Number.isInteger(nShuffles) || nShuffles < 1) {
    throw new FlowError('invalid_input', `nShuffles must be a positive integer, got ${nShuffles}`)
  }
  const te = transferEntropy(source, dest, opts)
  const rng = xorshift32(opts.seed)
  let sum = 0
  for (let i = 0; i < nShuffles; i++) {
    sum += transferEntropy(sourceShuffle(source, rng), dest, opts)
  }
  const shuffleMean = sum / nShuffles
  return { te, shuffleMean, ete: te - shuffleMean }
}
