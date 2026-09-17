import { KahanSum } from '../internal/kahan.js'
import { chiSquareP, normalP } from '../stats/pvalues.js'

/**
 * Presence-aware network statistics for step-aligned experiment archives:
 * a NaN z marks a source absent at that step, and each step combines over
 * the sources present there — exactly what a live session does per round.
 * With every source present they perform the SAME floating-point operations
 * in the same order as `netvar`/`devvar`/`interSourceCorrelation`/
 * `covar(…, { bitsPerTrial })`/`cumulativeDeviation`, so results are
 * bit-identical. The public stats
 * functions stay strict (they reject NaN); these are internal to the
 * experiment layer.
 */

export interface WindowStat {
  statistic: number
  df: number
  pValue: number
  /** Steps in [start, end) with at least one present source. */
  n: number
}

/** Present-source count per step over [0, steps). */
export function presentCounts(zBySource: readonly Float64Array[], steps: number): Uint32Array {
  const counts = new Uint32Array(steps)
  for (const zs of zBySource) {
    for (let t = 0; t < steps; t++) {
      if (!Number.isNaN(zs[t] as number)) counts[t] = (counts[t] as number) + 1
    }
  }
  return counts
}

/** Stouffer Z over the sources present at step t (NaN when none are). */
export function stepStouffer(zBySource: readonly Float64Array[], t: number): number {
  let sum = 0
  let count = 0
  for (let i = 0; i < zBySource.length; i++) {
    const z = (zBySource[i] as Float64Array)[t] as number
    if (Number.isNaN(z)) continue
    sum += z
    count++
  }
  return count === 0 ? Number.NaN : sum / Math.sqrt(count)
}

/** Σₜ Z_s(t)² over steps with ≥ 1 present source; χ²(df = those steps). Null when there are none. */
export function presentNetvar(
  zBySource: readonly Float64Array[],
  start: number,
  end: number,
): WindowStat | null {
  const acc = new KahanSum()
  let n = 0
  for (let t = start; t < end; t++) {
    const z = stepStouffer(zBySource, t)
    if (Number.isNaN(z)) continue
    acc.add(z * z)
    n++
  }
  if (n === 0) return null
  return { statistic: acc.value, df: n, pValue: chiSquareP(acc.value, n), n }
}

/** Σ over present cells of z²; χ²(df = present cells). Null when there are none. */
export function presentDevvar(
  zBySource: readonly Float64Array[],
  start: number,
  end: number,
): WindowStat | null {
  const acc = new KahanSum()
  let cells = 0
  for (const zs of zBySource) {
    for (let t = start; t < end; t++) {
      const z = zs[t] as number
      if (Number.isNaN(z)) continue
      acc.add(z * z)
      cells++
    }
  }
  if (cells === 0) return null
  let n = 0
  for (let t = start; t < end; t++) if (!Number.isNaN(stepStouffer(zBySource, t))) n++
  return { statistic: acc.value, df: cells, pValue: chiSquareP(acc.value, cells), n }
}

/**
 * Σₜ S(t) / √(Σₜ Pₜ) with S(t) = ((Σz)² − Σz²)/2 over the nₜ present sources
 * and Pₜ = nₜ(nₜ − 1)/2 present pairs (Var S(t) = Pₜ under H0); one-sided
 * normal tail, df = Σₜ Pₜ. Null when no step has two present sources.
 */
export function presentCorrelation(
  zBySource: readonly Float64Array[],
  start: number,
  end: number,
): WindowStat | null {
  const total = new KahanSum()
  let pairs = 0
  let n = 0
  for (let t = start; t < end; t++) {
    let sum = 0
    let sumSq = 0
    let count = 0
    for (let i = 0; i < zBySource.length; i++) {
      const z = (zBySource[i] as Float64Array)[t] as number
      if (Number.isNaN(z)) continue
      sum += z
      sumSq += z * z
      count++
    }
    if (count === 0) continue
    n++
    total.add((sum * sum - sumSq) / 2)
    pairs += (count * (count - 1)) / 2
  }
  if (pairs === 0) return null
  const statistic = total.value / Math.sqrt(pairs)
  return { statistic, df: pairs, pValue: normalP(statistic, 'upper'), n }
}

/**
 * Correlation of variances (GCP's C2, see `covar`): Σₜ S₂(t) / √(Σₜ Pₜ · v²)
 * with uᵢ = zᵢ² − 1, S₂(t) = ((Σu)² − Σu²)/2 over the nₜ present sources,
 * Pₜ = nₜ(nₜ − 1)/2 present pairs and v = Var z² = 2 − 2/k for Binomial(k, ½)
 * trials (exact under theoretical calibration), so Var S₂(t) = Pₜ·v² under
 * H0; one-sided normal tail (CLT — the products are skewed), df = Σₜ Pₜ.
 * Null when no step has two present sources.
 */
export function presentCovar(
  zBySource: readonly Float64Array[],
  start: number,
  end: number,
  bitsPerTrial: number,
): WindowStat | null {
  const v = 2 - 2 / bitsPerTrial
  const total = new KahanSum()
  let pairs = 0
  let n = 0
  for (let t = start; t < end; t++) {
    let sum = 0
    let sumSq = 0
    let count = 0
    for (let i = 0; i < zBySource.length; i++) {
      const z = (zBySource[i] as Float64Array)[t] as number
      if (Number.isNaN(z)) continue
      const u = z * z - 1
      sum += u
      sumSq += u * u
      count++
    }
    if (count === 0) continue
    n++
    total.add((sum * sum - sumSq) / 2)
    pairs += (count * (count - 1)) / 2
  }
  if (pairs === 0) return null
  const statistic = total.value / Math.sqrt(pairs * v * v)
  return { statistic, df: pairs, pValue: normalP(statistic, 'upper'), n }
}

/** cumsum(Z_s² − 1) over [start, end); a step with no present source adds nothing. */
export function presentCumulative(
  zBySource: readonly Float64Array[],
  start: number,
  end: number,
): Float64Array {
  const out = new Float64Array(Math.max(0, end - start))
  const acc = new KahanSum()
  for (let t = start; t < end; t++) {
    const z = stepStouffer(zBySource, t)
    if (!Number.isNaN(z)) acc.add(z * z - 1)
    out[t - start] = acc.value
  }
  return out
}
