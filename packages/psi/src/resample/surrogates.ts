import { PsiError } from '../errors.js'
import type { TrialSeries } from '../types.js'

/** Options for {@link timeOffsetSurrogates}. */
export interface SurrogateOptions {
  /** Index (into `seriesBySource`) of the source whose series is rotated. Default 0. */
  sourceIndex?: number
  /**
   * Explicit circular offsets in trials. Each must be an integer that is
   * nonzero modulo the series length (a zero rotation is the observed data,
   * not a surrogate).
   */
  offsets?: readonly number[]
  /**
   * When `offsets` is omitted: how many evenly spaced offsets to generate,
   * $\left\{\mathrm{round}\!\big(\tfrac{(i+1)\,T}{c+1}\big)\right\}_{i<c}$
   * clamped to $[1, T-1]$ and deduplicated. Default `min(T − 1, 100)`.
   */
  count?: number
}

/** One surrogate dataset: the rotation applied and the resulting series. */
export interface Surrogate {
  /** Circular offset in trials (positive = the rotated series is shifted earlier). */
  readonly offset: number
  /** Same array as the input except the rotated source's series is replaced. */
  readonly series: readonly TrialSeries[]
}

function resolveOffsets(steps: number, opts: SurrogateOptions): number[] {
  if (opts.offsets !== undefined) {
    if (opts.offsets.length === 0) {
      throw new PsiError('invalid_plan', 'offsets must not be empty')
    }
    return opts.offsets.map((offset) => {
      if (!Number.isInteger(offset)) {
        throw new PsiError('invalid_plan', `offsets must be integers, got ${offset}`)
      }
      const normalized = ((offset % steps) + steps) % steps
      if (normalized === 0) {
        throw new PsiError(
          'invalid_plan',
          `offset ${offset} is zero modulo ${steps} steps — that is the observed data, not a surrogate`,
        )
      }
      return normalized
    })
  }
  const count = opts.count ?? Math.min(steps - 1, 100)
  if (!Number.isInteger(count) || count < 1) {
    throw new PsiError('invalid_plan', `count must be an integer ≥ 1, got ${count}`)
  }
  const capped = Math.min(count, steps - 1)
  const offsets: number[] = []
  for (let i = 0; i < capped; i++) {
    const offset = Math.min(Math.max(Math.round(((i + 1) * steps) / (capped + 1)), 1), steps - 1)
    if (offsets[offsets.length - 1] !== offset) offsets.push(offset)
  }
  return offsets
}

/**
 * Time-offset surrogates: circularly rotate ONE source's trial sums relative
 * to the others, $x'_t = x_{(t + \tau) \bmod T}$, keeping every timestamp
 * grid in place. Each rotation preserves the rotated source's marginal
 * distribution and autocorrelation exactly while destroying any
 * cross-source simultaneity — the empirical null the GCP formal analyses
 * use for netvar-style statistics (Nelson et al. 2002; Bancel & Nelson
 * 2008; the surrogate-data method of Theiler et al. 1992).
 *
 * Rationale: negentropy documents its `significanceEnvelope` as POINTWISE —
 * recomputing your statistic over these surrogates and calling
 * {@link permutationP} gives an honest family-wise empirical p instead.
 *
 * Deterministic (no RNG): offsets are explicit or evenly spaced. Lazy: each
 * surrogate is materialized only when the generator is pulled. Only the
 * rotated series is a new object; the others are shared by reference.
 */
export function* timeOffsetSurrogates(
  seriesBySource: readonly TrialSeries[],
  opts: SurrogateOptions = {},
): Generator<Surrogate> {
  if (seriesBySource.length === 0) {
    throw new PsiError('invalid_plan', 'timeOffsetSurrogates needs at least one series')
  }
  const steps = (seriesBySource[0] as TrialSeries).sums.length
  for (const s of seriesBySource) {
    if (s.sums.length !== steps) {
      throw new PsiError(
        'source_mismatch',
        `series are not step-aligned: ${s.source} has ${s.sums.length} trials, ${(seriesBySource[0] as TrialSeries).source} has ${steps}`,
        { source: s.source },
      )
    }
  }
  if (steps < 2) {
    throw new PsiError(
      'insufficient_data',
      `time-offset surrogates need at least 2 trials, got ${steps}`,
    )
  }
  const sourceIndex = opts.sourceIndex ?? 0
  if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= seriesBySource.length) {
    throw new PsiError(
      'invalid_plan',
      `sourceIndex ${sourceIndex} is outside the ${seriesBySource.length} available series`,
    )
  }
  const offsets = resolveOffsets(steps, opts)
  const target = seriesBySource[sourceIndex] as TrialSeries

  for (const offset of offsets) {
    const sums = new Float64Array(steps)
    for (let t = 0; t < steps; t++) sums[t] = target.sums[(t + offset) % steps] as number
    const rotated: TrialSeries = Object.freeze({
      source: target.source,
      bitsPerTrial: target.bitsPerTrial,
      sums,
      ...(target.timestamps && { timestamps: target.timestamps }),
    })
    const series = seriesBySource.map((s, i) => (i === sourceIndex ? rotated : s))
    yield Object.freeze({ offset, series: Object.freeze(series) })
  }
}

/**
 * Permutation/randomization p-value with the +1 correction:
 * $$p = \frac{1 + \left|\{ i : s_i \ge s_{\text{obs}} \}\right|}{1 + m}$$
 * for $m$ surrogate statistics — the observed arrangement counts as one
 * member of its own null ensemble, so $p$ can never be 0 (Davison &
 * Hinkley 1997 §4.2.3; North, Curtis & Sham 2002). Upper-tail convention:
 * larger statistics are more extreme (ties count against the observation).
 */
export function permutationP(observed: number, surrogateStats: ArrayLike<number>): number {
  if (surrogateStats.length === 0) {
    throw new PsiError('insufficient_data', 'permutationP needs at least one surrogate statistic')
  }
  if (!Number.isFinite(observed)) {
    throw new PsiError('invalid_plan', `observed statistic must be finite, got ${observed}`)
  }
  let atLeast = 0
  for (let i = 0; i < surrogateStats.length; i++) {
    const s = surrogateStats[i] as number
    if (!Number.isFinite(s)) {
      throw new PsiError('invalid_plan', `surrogate statistic ${i} is not finite: ${s}`)
    }
    if (s >= observed) atLeast++
  }
  return (1 + atLeast) / (1 + surrogateStats.length)
}
