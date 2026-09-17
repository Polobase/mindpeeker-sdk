/**
 * Plug-in conditional mutual information $\hat I(T; S \mid C)$ over embedded
 * key columns — the one estimator every transfer-entropy and storage measure in
 * the package instantiates. The target/condition part is counted once
 * ({@link cmiBase}); only the source part is recounted per evaluation, which is
 * what makes surrogate ensembles cheap.
 */

import { KahanSum } from '@mindpeeker/negentropy/numerics'
import { countTuples, joinKeys, type KeyColumn } from './keys.js'

export interface CmiBase {
  readonly count: number
  readonly target: KeyColumn
  readonly condition: KeyColumn
  /** Per-tuple count of the condition state $c$. */
  readonly cCount: Float64Array
  /** Per-tuple count of the joint $(c, t)$ state. */
  readonly ctCount: Float64Array
  readonly cCells: number
  readonly ctCells: number
}

export interface CmiValue {
  /** Plug-in estimate in bits: the mean of the locals (unclamped). */
  readonly plugin: number
  /** Miller–Madow net correction $\frac{K_{ct} + K_{cs} - K_{cst} - K_c}{2N \ln 2}$. */
  readonly mmCorrection: number
  /** Occupied $(c, s, t)$ cells. */
  readonly cstCells: number
}

export function cmiBase(target: KeyColumn, condition: KeyColumn): CmiBase {
  const c = countTuples(condition)
  const ct = countTuples(joinKeys(condition, target))
  return {
    count: target.keys.length,
    target,
    condition,
    cCount: c.perTuple,
    ctCount: ct.perTuple,
    cCells: c.cells,
    ctCells: ct.cells,
  }
}

/**
 * Evaluate $\hat I(T; S \mid C)$ for one source column. Each tuple $i$
 * contributes the local $\log_2 \frac{c_{cst}\, c_c}{c_{cs}\, c_{ct}}$; the
 * plug-in value is their compensated mean. When `locals` is given, tuple $i$'s
 * local is written to `locals[offset + i]`.
 */
export function cmiEvaluate(
  base: CmiBase,
  source: KeyColumn,
  locals?: Float64Array,
  offset = 0,
): CmiValue {
  const cs = joinKeys(base.condition, source)
  const csCounts = countTuples(cs)
  const cstCounts = countTuples(joinKeys(cs, base.target))
  const count = base.count
  const cst = cstCounts.perTuple
  const csc = csCounts.perTuple
  const cc = base.cCount
  const ctc = base.ctCount
  const sum = new KahanSum()
  for (let i = 0; i < count; i++) {
    const local = Math.log2(
      ((cst[i] as number) * (cc[i] as number)) / ((csc[i] as number) * (ctc[i] as number)),
    )
    if (locals !== undefined) locals[offset + i] = local
    sum.add(local)
  }
  return {
    plugin: sum.value / count,
    mmCorrection:
      (base.ctCells + csCounts.cells - cstCounts.cells - base.cCells) / (2 * count * Math.LN2),
    cstCells: cstCounts.cells,
  }
}

/**
 * Plug-in conditional entropy $\hat H(T \mid C)$ in bits from a base: the
 * compensated mean of the locals $\log_2(c_c / c_{ct})$, optionally with the
 * Miller–Madow correction $\frac{K_{ct} - K_c}{2N \ln 2}$.
 */
export function conditionalEntropy(base: CmiBase, millerMadow: boolean): number {
  const sum = new KahanSum()
  const cc = base.cCount
  const ctc = base.ctCount
  for (let i = 0; i < base.count; i++) sum.add(Math.log2((cc[i] as number) / (ctc[i] as number)))
  const h = sum.value / base.count
  return millerMadow ? h + (base.ctCells - base.cCells) / (2 * base.count * Math.LN2) : h
}

/** Final reported value: Miller–Madow corrected (unclamped) or plug-in clamped at 0. */
export function finalize(value: CmiValue, millerMadow: boolean): number {
  return millerMadow ? value.plugin + value.mmCorrection : Math.max(0, value.plugin)
}
