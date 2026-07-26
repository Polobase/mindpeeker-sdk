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

/**
 * Network coherence — the GCP 2.0 headline statistic (a measure of coherent
 * activity across RNGs). Per step, the mean pairwise product of source
 * z-scores S(t)/pairCount with S(t) = ((Σz)² − Σz²)/2; `coherence` is its mean
 * over steps and `perStep` is the plot-ready "evoked response" curve.
 * Significance uses the same CLT normal approximation as
 * `interSourceCorrelation` (one-sided: excess coherence). Requires ≥ 2 sources.
 */
export function networkCoherence(
  zBySource: readonly Float64Array[],
  sources: readonly string[],
): StatResult & { coherence: number; perStep: Float64Array } {
  const steps = checkMatrix(zBySource, sources)
  const n = zBySource.length
  if (n < 2) {
    throw new NegentropyError('invalid_config', 'networkCoherence needs at least 2 sources')
  }
  const pairCount = (n * (n - 1)) / 2
  const perStep = new Float64Array(steps)
  const total = new KahanSum()
  const coherenceMean = new KahanSum()
  for (let t = 0; t < steps; t++) {
    let sum = 0
    let sumSq = 0
    for (let i = 0; i < n; i++) {
      const z = (zBySource[i] as Float64Array)[t] as number
      sum += z
      sumSq += z * z
    }
    const s = (sum * sum - sumSq) / 2
    perStep[t] = s / pairCount
    total.add(s)
    coherenceMean.add(s / pairCount)
  }
  const statistic = total.value / Math.sqrt(steps * pairCount)
  return {
    statistic,
    df: steps * pairCount,
    pValue: normalP(statistic, 'upper'),
    n: steps,
    sources: [...sources],
    coherence: coherenceMean.value / steps,
    perStep,
  }
}

/**
 * Within-cluster vs between-cluster network-variance decomposition, matching
 * GCP 2.0's clustered hardware (clusters of RNGs). `clusters[i]` is the cluster
 * id of source i. Per step each cluster is reduced to its own Stouffer Z;
 * `within` = Σ_c Σ_t clusterZ_c(t)² (χ² over steps × clusters — within-cluster
 * deviation) and `between` = Σ_t Z_g(t)² where Z_g is the Stouffer across the
 * cluster-level Z's (χ² over steps — between-cluster co-deviation). The primary
 * `statistic` is `between` on `df = steps`.
 */
export function clusteredNetvar(
  zBySource: readonly Float64Array[],
  sources: readonly string[],
  clusters: readonly number[],
): StatResult & { within: number; between: number; clusterCount: number } {
  const steps = checkMatrix(zBySource, sources)
  if (clusters.length !== sources.length) {
    throw new NegentropyError(
      'invalid_config',
      `clusters must give one id per source: got ${clusters.length} ids for ${sources.length} sources`,
    )
  }
  // group source indices by cluster id, in first-seen order
  const groups = new Map<number, number[]>()
  for (let i = 0; i < clusters.length; i++) {
    const id = clusters[i] as number
    if (!Number.isInteger(id)) {
      throw new NegentropyError('invalid_config', `cluster ids must be integers, got ${id}`)
    }
    const g = groups.get(id)
    if (g) g.push(i)
    else groups.set(id, [i])
  }
  const clusterIndices = [...groups.values()]
  const clusterCount = clusterIndices.length
  const within = new KahanSum()
  const between = new KahanSum()
  const clusterZ = new Float64Array(clusterCount)
  for (let t = 0; t < steps; t++) {
    for (let c = 0; c < clusterCount; c++) {
      const members = clusterIndices[c] as number[]
      let sum = 0
      for (const i of members) sum += (zBySource[i] as Float64Array)[t] as number
      const cz = sum / Math.sqrt(members.length)
      clusterZ[c] = cz
      within.add(cz * cz)
    }
    const zg = stoufferZ(clusterZ)
    between.add(zg * zg)
  }
  return {
    statistic: between.value,
    df: steps,
    pValue: chiSquareP(between.value, steps),
    n: steps,
    sources: [...sources],
    within: within.value,
    between: between.value,
    clusterCount,
  }
}

/**
 * Pearson correlation between an onsite and a global network stream (e.g. two
 * `networkCoherence` `perStep` series), with a p-value from the Fisher
 * z-transform z = atanh(r)·√(n − 3) ~ N(0, 1). Mirrors the GCP 2.0
 * onsite↔global coherence-correlation analysis (reported r ≈ 0.27). One-sided
 * by default (positive coupling); `df = n − 3`.
 */
export function onsiteVsGlobal(
  onsite: Float64Array,
  global: Float64Array,
): StatResult & { r: number } {
  if (onsite.length !== global.length) {
    throw new NegentropyError(
      'invalid_config',
      `streams must be equal length: onsite ${onsite.length}, global ${global.length}`,
    )
  }
  const n = onsite.length
  if (n < 4) {
    throw new NegentropyError('insufficient_data', `onsiteVsGlobal needs ≥ 4 steps, got ${n}`)
  }
  let sx = 0
  let sy = 0
  for (let i = 0; i < n; i++) {
    sx += onsite[i] as number
    sy += global[i] as number
  }
  const mx = sx / n
  const my = sy / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    const dx = (onsite[i] as number) - mx
    const dy = (global[i] as number) - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  if (!(sxx > 0) || !(syy > 0)) {
    throw new NegentropyError('insufficient_data', 'a stream is constant — correlation undefined')
  }
  const r = Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)))
  // clamp |r| off exactly 1 so atanh stays finite
  const rc = Math.max(-1 + 1e-15, Math.min(1 - 1e-15, r))
  const z = Math.atanh(rc) * Math.sqrt(n - 3)
  return {
    statistic: z,
    df: n - 3,
    pValue: normalP(z, 'upper'),
    n,
    sources: ['onsite', 'global'],
    r,
  }
}
