import { NegentropyError } from '../errors.js'
import { KahanSum } from '../internal/kahan.js'
import type { StatResult } from '../types.js'
import { checkMatrix } from './network.js'
import { normalP } from './pvalues.js'
import { validateBitsPerTrial } from './trials.js'

export interface CovarOptions {
  /**
   * Trial width k when the z's are theoretically calibrated Binomial(k, ½)
   * trials: the null variance of z² is then exactly 2 − 2/k (E z⁴ = 3 − 2/k).
   * Omit for Gaussian z's (dithered or probit data, or empirical calibration
   * treated as normal): Var z² = 2.
   */
  bitsPerTrial?: number
}

/**
 * Correlation of variances ("covar", GCP's C2) — the co-movement of the
 * sources' *squared* deviations, orthogonal to netvar's linear channel
 * (Nelson & Bancel 2011, "Effects of mass consciousness", EXPLORE 7(6)).
 * Per step, with uᵢ = zᵢ² − 1,
 * $$S_2(t) = \sum_{i<j} u_i u_j = \tfrac12\Big[\big(\textstyle\sum_i u_i\big)^2 - \sum_i u_i^2\Big],$$
 * and the statistic is ΣₜS₂(t)/√(T·P·v²) with P = N(N−1)/2 pairs and
 * v = Var(z²). Under H0 (independent sources and steps, E u = 0) the pair
 * products are uncorrelated with variance v², so the statistic has mean 0 and
 * variance 1 exactly; its normal tail is a CLT approximation — expect
 * T·P ≳ a few hundred before trusting small p (the u's are skewed). One-sided:
 * a positive statistic is excess co-variation of variances. `perStep` is the
 * mean pair product S₂(t)/P (a plot-ready curve like `networkCoherence`),
 * `meanProduct` its mean over steps, `zSquaredVariance` the v used.
 * Requires ≥ 2 sources; z's must be finite.
 */
export function covar(
  zBySource: readonly Float64Array[],
  sources: readonly string[],
  opts: CovarOptions = {},
): StatResult & { perStep: Float64Array; meanProduct: number; zSquaredVariance: number } {
  const steps = checkMatrix(zBySource, sources)
  const n = zBySource.length
  if (n < 2) throw new NegentropyError('invalid_config', 'covar needs at least 2 sources')
  const v = opts.bitsPerTrial === undefined ? 2 : 2 - 2 / validateBitsPerTrial(opts.bitsPerTrial)
  const pairs = (n * (n - 1)) / 2
  const perStep = new Float64Array(steps)
  const total = new KahanSum()
  const mean = new KahanSum()
  for (let t = 0; t < steps; t++) {
    let sum = 0
    let sumSq = 0
    for (let i = 0; i < n; i++) {
      const z = (zBySource[i] as Float64Array)[t] as number
      const u = z * z - 1
      sum += u
      sumSq += u * u
    }
    const s2 = (sum * sum - sumSq) / 2
    perStep[t] = s2 / pairs
    total.add(s2)
    mean.add(s2 / pairs)
  }
  const statistic = total.value / Math.sqrt(steps * pairs * v * v)
  return {
    statistic,
    df: steps * pairs,
    pValue: normalP(statistic, 'upper'),
    n: steps,
    sources: [...sources],
    perStep,
    meanProduct: mean.value / steps,
    zSquaredVariance: v,
  }
}
