import { PsiError } from '../errors.js'
import { assertOpenInterval } from '../internal/validate.js'

/** Multiplicity-adjusted p-values for a family of hypotheses, in input order. */
export interface AdjustedPValues {
  readonly method: 'holm' | 'benjamini-hochberg' | 'maxT-single-step' | 'maxT-step-down'
  /** Adjusted p per hypothesis, aligned with the input. */
  readonly adjusted: readonly number[]
  /** `adjusted ≤ level` per hypothesis. */
  readonly rejected: readonly boolean[]
  /** The family-wise error rate α (Holm, maxT) or false discovery rate q (BH) used for `rejected`. */
  readonly level: number
}

function assertPValues(pValues: ArrayLike<number>): number[] {
  if (pValues === null || typeof pValues !== 'object' || typeof pValues.length !== 'number') {
    throw new PsiError('invalid_plan', 'pValues must be an array of numbers')
  }
  if (pValues.length === 0) {
    throw new PsiError('insufficient_data', 'need at least one p-value to adjust')
  }
  const out: number[] = []
  for (let i = 0; i < pValues.length; i++) {
    const p = pValues[i] as number
    if (!(p >= 0 && p <= 1)) {
      throw new PsiError('invalid_plan', `p-value ${i} must be in [0, 1], got ${p}`)
    }
    out.push(p)
  }
  return out
}

function finish(
  method: AdjustedPValues['method'],
  adjusted: number[],
  level: number,
): AdjustedPValues {
  return Object.freeze({
    method,
    adjusted: Object.freeze(adjusted),
    rejected: Object.freeze(adjusted.map((p) => p <= level)),
    level,
  })
}

/** Indices sorted by ascending p; ties keep input order (stable sort). */
function ascending(p: readonly number[]): number[] {
  return p.map((_, i) => i).sort((a, b) => (p[a] as number) - (p[b] as number))
}

/**
 * Holm's step-down Bonferroni adjustment (Holm 1979) — strong family-wise
 * error control under *any* dependence. With $p_{(1)} \le \dots \le p_{(K)}$:
 * $$\tilde p_{(j)} = \max_{i \le j} \min\{1, (K - i + 1)\, p_{(i)}\}.$$
 * Uniformly more powerful than Bonferroni (negentropy's `bonferroni`).
 *
 * @throws {PsiError} `insufficient_data` (empty), `invalid_plan` (p outside
 *   [0, 1] or `alpha` outside (0, 1)).
 */
export function holm(pValues: ArrayLike<number>, opts: { alpha?: number } = {}): AdjustedPValues {
  const alpha = assertOpenInterval(opts.alpha ?? 0.05, 0, 1, 'alpha')
  const p = assertPValues(pValues)
  const k = p.length
  const adjusted = new Array<number>(k)
  let running = 0
  ascending(p).forEach((index, i) => {
    running = Math.max(running, Math.min(1, (k - i) * (p[index] as number)))
    adjusted[index] = running
  })
  return finish('holm', adjusted, alpha)
}

/**
 * Benjamini–Hochberg step-up adjustment (Benjamini & Hochberg 1995) —
 * controls the false discovery rate at $q$ for independent or positively
 * regression-dependent (PRDS) p-values:
 * $$\tilde p_{(j)} = \min_{i \ge j} \min\{1, K\, p_{(i)}/i\}.$$
 * Controls the expected *proportion* of false claims, not the chance of any —
 * use {@link holm} or {@link maxTAdjust} when a single false claim matters.
 *
 * @throws {PsiError} as {@link holm}, for `q`.
 */
export function benjaminiHochberg(
  pValues: ArrayLike<number>,
  opts: { q?: number } = {},
): AdjustedPValues {
  const q = assertOpenInterval(opts.q ?? 0.05, 0, 1, 'q')
  const p = assertPValues(pValues)
  const k = p.length
  const order = ascending(p)
  const adjusted = new Array<number>(k)
  let running = 1
  for (let i = k - 1; i >= 0; i--) {
    const index = order[i] as number
    running = Math.min(running, Math.min(1, (k * (p[index] as number)) / (i + 1)))
    adjusted[index] = running
  }
  return finish('benjamini-hochberg', adjusted, q)
}

/** Options for {@link maxTAdjust}. */
export interface MaxTOptions {
  /** Family-wise α for `rejected`. Default 0.05. */
  alpha?: number
  /** Step-down (default, Westfall–Young Algorithm 2.8) or single-step maxT. */
  stepDown?: boolean
}

/**
 * Westfall–Young maxT adjustment (Westfall & Young 1993; Ge, Dudoit & Speed
 * 2003) over a resampling null: strong family-wise error control that *uses*
 * the dependence among the $K$ statistics instead of bounding it away, so it
 * is less conservative than Holm when the statistics are correlated (e.g.
 * netvar over overlapping windows).
 *
 * `observed[k]` is statistic $t_k$ (larger = more extreme); `surrogates[b][k]`
 * is the same statistic recomputed on null dataset $b$ (one row per
 * surrogate from {@link timeOffsetSurrogates}, {@link labelShuffleSurrogates},
 * or {@link placeboWindows}). With the $+1$ convention of {@link permutationP}:
 *
 * - single-step: $\tilde p_k = \big(1 + \#\{b : \max_j u_{b,j} \ge t_k\}\big)/(1+m)$
 * - step-down: order $t_{r_1} \ge \dots \ge t_{r_K}$, successive maxima
 *   $u_{b,j} = \max_{l \ge j} u_{b,r_l}$, $\tilde p_{r_j} = \big(1 + \#\{b : u_{b,j} \ge t_{r_j}\}\big)/(1+m)$,
 *   then monotonicity $\tilde p_{r_j} \leftarrow \max(\tilde p_{r_{j-1}}, \tilde p_{r_j})$.
 *
 * @throws {PsiError} `insufficient_data` (no statistics or no surrogates),
 *   `invalid_plan` (ragged rows, non-finite values, bad `alpha`).
 */
export function maxTAdjust(
  observed: ArrayLike<number>,
  surrogates: readonly ArrayLike<number>[],
  opts: MaxTOptions = {},
): AdjustedPValues {
  const alpha = assertOpenInterval(opts.alpha ?? 0.05, 0, 1, 'alpha')
  const k = observed?.length
  if (typeof k !== 'number' || k === 0) {
    throw new PsiError('insufficient_data', 'maxTAdjust needs at least one observed statistic')
  }
  if (!Array.isArray(surrogates as unknown) || surrogates.length === 0) {
    throw new PsiError('insufficient_data', 'maxTAdjust needs at least one surrogate row')
  }
  const t: number[] = []
  for (let j = 0; j < k; j++) {
    const v = observed[j] as number
    if (!Number.isFinite(v)) {
      throw new PsiError('invalid_plan', `observed statistic ${j} is not finite: ${v}`)
    }
    t.push(v)
  }
  surrogates.forEach((row, b) => {
    if (row?.length !== k) {
      throw new PsiError(
        'invalid_plan',
        `surrogate row ${b} has ${row?.length} statistics, expected ${k}`,
      )
    }
    for (let j = 0; j < k; j++) {
      if (!Number.isFinite(row[j])) {
        throw new PsiError('invalid_plan', `surrogate row ${b} statistic ${j} is not finite`)
      }
    }
  })
  const m = surrogates.length
  const adjusted = new Array<number>(k)
  if (opts.stepDown === false) {
    const maxima = surrogates.map((row) => {
      let max = Number.NEGATIVE_INFINITY
      for (let j = 0; j < k; j++) max = Math.max(max, row[j] as number)
      return max
    })
    for (let j = 0; j < k; j++) {
      const tj = t[j] as number
      adjusted[j] = (1 + maxima.filter((u) => u >= tj).length) / (1 + m)
    }
    return finish('maxT-single-step', adjusted, alpha)
  }
  // descending by observed statistic; stable for ties
  const order = t.map((_, j) => j).sort((a, b) => (t[b] as number) - (t[a] as number))
  const counts = new Array<number>(k).fill(0)
  for (const row of surrogates) {
    let running = Number.NEGATIVE_INFINITY
    for (let j = k - 1; j >= 0; j--) {
      const index = order[j] as number
      running = Math.max(running, row[index] as number)
      if (running >= (t[index] as number)) counts[j] = (counts[j] as number) + 1
    }
  }
  let previous = 0
  for (let j = 0; j < k; j++) {
    const index = order[j] as number
    previous = Math.max(previous, (1 + (counts[j] as number)) / (1 + m))
    adjusted[index] = previous
  }
  return finish('maxT-step-down', adjusted, alpha)
}
