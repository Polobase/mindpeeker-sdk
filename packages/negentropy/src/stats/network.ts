import { NegentropyError } from '../errors.js'
import { KahanSum } from '../internal/kahan.js'
import type { StatResult } from '../types.js'
import { chiSquareP, normalP } from './pvalues.js'
import { stoufferZ } from './zscores.js'

/**
 * All network statistics consume a "z matrix": one Float64Array of z-scores
 * per source, all the same length (steps), step-aligned across sources.
 * Useful identity relating the three: Z_s(t)² = [Σᵢzᵢ² + 2S(t)] / N — netvar
 * is a specific mixture of device variance and covariance.
 */
function checkMatrix(zBySource: readonly Float64Array[], sources: readonly string[]): number {
  if (zBySource.length === 0 || zBySource.length !== sources.length) {
    throw new NegentropyError(
      'invalid_config',
      `need one z array per source: got ${zBySource.length} arrays for ${sources.length} sources`,
    )
  }
  const steps = (zBySource[0] as Float64Array).length
  for (let i = 1; i < zBySource.length; i++) {
    if ((zBySource[i] as Float64Array).length !== steps) {
      throw new NegentropyError(
        'invalid_config',
        `z arrays must be step-aligned: ${sources[i]} has ${(zBySource[i] as Float64Array).length} steps, ${sources[0]} has ${steps}`,
      )
    }
  }
  if (steps === 0) {
    throw new NegentropyError('insufficient_data', 'network statistics need at least one step')
  }
  return steps
}

/**
 * Network variance — the GCP standard event statistic: Σₜ Z_s(t)² where
 * Z_s(t) is the per-step Stouffer Z across sources; ~ χ²(steps) under H0.
 * Sensitive to a common signal shared across sources and to mean shifts.
 */
export function netvar(zBySource: readonly Float64Array[], sources: readonly string[]): StatResult {
  const steps = checkMatrix(zBySource, sources)
  const acc = new KahanSum()
  const zAt = new Float64Array(zBySource.length)
  for (let t = 0; t < steps; t++) {
    for (let i = 0; i < zBySource.length; i++) zAt[i] = (zBySource[i] as Float64Array)[t] as number
    const z = stoufferZ(zAt)
    acc.add(z * z)
  }
  const statistic = acc.value
  return {
    statistic,
    df: steps,
    pValue: chiSquareP(statistic, steps),
    n: steps,
    sources: [...sources],
  }
}

/**
 * Device variance: Σₜ Σᵢ zᵢ(t)² ~ χ²(steps × sources) under H0. Sensitive to
 * individual sources changing variance; blind to cross-source correlation.
 */
export function devvar(zBySource: readonly Float64Array[], sources: readonly string[]): StatResult {
  const steps = checkMatrix(zBySource, sources)
  const acc = new KahanSum()
  for (const zs of zBySource) {
    for (let t = 0; t < steps; t++) {
      const z = zs[t] as number
      acc.add(z * z)
    }
  }
  const df = steps * zBySource.length
  const statistic = acc.value
  return {
    statistic,
    df,
    pValue: chiSquareP(statistic, df),
    n: steps,
    sources: [...sources],
  }
}

export interface PairCorrelation {
  a: string
  b: string
  /** Mean per-step product of the pair's z-scores (≈ correlation, z's being standardized). */
  r: number
}

/**
 * Inter-source correlation: per step S(t) = Σᵢ<ⱼ zᵢzⱼ = ((Σz)² − Σz²)/2;
 * statistic = ΣₜS(t) / √(steps·N(N−1)/2), treated as N(0,1) by the CLT.
 * Not valid for tiny steps×pairs — expect ≥ ~100 products before trusting
 * the normal approximation. `df` reports that product count for context; the
 * p-value comes from the normal tail (one-sided: excess correlation).
 */
export function interSourceCorrelation(
  zBySource: readonly Float64Array[],
  sources: readonly string[],
): StatResult & { pairs: readonly PairCorrelation[] } {
  const steps = checkMatrix(zBySource, sources)
  const n = zBySource.length
  if (n < 2) {
    throw new NegentropyError('invalid_config', 'interSourceCorrelation needs at least 2 sources')
  }
  const total = new KahanSum()
  for (let t = 0; t < steps; t++) {
    let sum = 0
    let sumSq = 0
    for (let i = 0; i < n; i++) {
      const z = (zBySource[i] as Float64Array)[t] as number
      sum += z
      sumSq += z * z
    }
    total.add((sum * sum - sumSq) / 2)
  }
  const pairCount = (n * (n - 1)) / 2
  const statistic = total.value / Math.sqrt(steps * pairCount)
  const pairs: PairCorrelation[] = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const za = zBySource[i] as Float64Array
      const zb = zBySource[j] as Float64Array
      const acc = new KahanSum()
      for (let t = 0; t < steps; t++) acc.add((za[t] as number) * (zb[t] as number))
      pairs.push({ a: sources[i] as string, b: sources[j] as string, r: acc.value / steps })
    }
  }
  return {
    statistic,
    df: steps * pairCount,
    pValue: normalP(statistic, 'upper'),
    n: steps,
    sources: [...sources],
    pairs,
  }
}
