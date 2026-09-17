/**
 * One result record for a transfer-entropy analysis: estimate, bias-corrected
 * effect sizes, surrogate and χ² significance, and everything needed to
 * reproduce it (embedding, counts, surrogate configuration).
 */

import { chiSquareFromSetup, resolveMinSamplesPerCell } from './chi-square.js'
import { cmiEvaluate, conditionalEntropy } from './internal/cmi.js'
import type { Embedding } from './internal/embedding.js'
import { sourceBlock } from './internal/embedding.js'
import type { SurrogateInfo } from './internal/surrogate-plan.js'
import { type PermutationTestOptions, runPermutationTest } from './significance.js'

/** Options for {@link transferEntropyReport}: every `permutationTest` option plus the χ² adequacy rule. */
export interface TransferEntropyReportOptions extends PermutationTestOptions {
  /** Adequacy multiplier for the χ² test (see `chiSquareTest`). Default 10. */
  minSamplesPerCell?: number
}

/** Result record of {@link transferEntropyReport}. */
export interface TransferEntropyReport {
  /** Observed $TE_{X \to Y}$ in bits (Miller–Madow corrected when requested). */
  readonly te: number
  /** Effective TE: `te` minus the surrogate ensemble mean. */
  readonly ete: number
  /**
   * Normalized TE (Gourévitch & Eggermont 2007, J. Neurophysiol. 97, 2533):
   * $NTE = ETE / \hat H(Y_{t+1} \mid Y_t^{(k)})$ — the share of the
   * destination's own-past uncertainty the source explains beyond the bias
   * floor. 0 when the conditional entropy is 0 (then TE is 0 too).
   */
  readonly nte: number
  /** Conditional entropy $\hat H(Y_{t+1} \mid Y_t^{(k)})$ over the same tuples, in bits (plug-in). */
  readonly destEntropyRate: number
  /** Descriptive surrogate z-score $(TE - \text{mean}) / \text{sd}$. */
  readonly z: number
  /** Add-one surrogate p-value (see `permutationTest`). */
  readonly p: number
  /** Surrogate ensemble mean and sample SD. */
  readonly surrogateMean: number
  readonly surrogateSd: number
  /** Distinct surrogate values (resolution of the null). */
  readonly distinct: number
  /** Asymptotic χ² p-value on the plug-in TE — trust only when `adequate`. */
  readonly pChiSquare: number
  /** χ² statistic $2N \ln 2 \cdot TE_{bits}$ (plug-in). */
  readonly statistic: number
  /** χ² degrees of freedom $(A_Y - 1) A_Y^k (A_X^l - 1)$. */
  readonly df: number
  /** Number of embedded tuples. */
  readonly count: number
  /** Joint table size $A_Y^{k+1} A_X^l$ and the cells observed. */
  readonly cells: number
  readonly occupiedCells: number
  /** χ² adequacy: `count ≥ minSamplesPerCell · cells`. */
  readonly adequate: boolean
  readonly embedding: Embedding
  readonly millerMadow: boolean
  readonly surrogate: SurrogateInfo
}

/**
 * Full transfer-entropy report: runs the permutation test (all
 * `permutationTest` options apply) and the χ² test on one prepared problem and
 * returns effect sizes next to both p-values. `ete`/`nte`/`z` are relative to
 * the chosen surrogate null (not always the shuffle null of Marschinski–Kantz).
 * `pChiSquare`, `statistic` and `nte`'s denominator always use the plug-in
 * estimate; `te`, `ete`, `z` and `p` follow `millerMadow`.
 */
export function transferEntropyReport(
  source: ArrayLike<number>,
  dest: ArrayLike<number>,
  opts: TransferEntropyReportOptions = {},
): TransferEntropyReport {
  const minSamplesPerCell = resolveMinSamplesPerCell(opts.minSamplesPerCell)
  const { result, setup } = runPermutationTest('transferEntropyReport', source, dest, opts)
  const plain = cmiEvaluate(setup.base, sourceBlock(setup))
  const chi = chiSquareFromSetup(
    setup,
    Math.max(0, plain.plugin),
    plain.cstCells,
    minSamplesPerCell,
  )
  const destEntropyRate = Math.max(0, conditionalEntropy(setup.base, false))
  const ete = result.te - result.mean
  return {
    te: result.te,
    ete,
    nte: destEntropyRate > 0 ? ete / destEntropyRate : 0,
    destEntropyRate,
    z: result.z,
    p: result.p,
    surrogateMean: result.mean,
    surrogateSd: result.sd,
    distinct: result.distinct,
    pChiSquare: chi.p,
    statistic: chi.statistic,
    df: chi.df,
    count: chi.count,
    cells: chi.cells,
    occupiedCells: chi.occupiedCells,
    adequate: chi.adequate,
    embedding: setup.embedding,
    millerMadow: opts.millerMadow === true,
    surrogate: result.surrogate,
  }
}
