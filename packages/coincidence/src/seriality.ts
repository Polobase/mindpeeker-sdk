/**
 * Seriality: are events bunched in time more than chance allows?
 *
 * Paul Kammerer's *Das Gesetz der Serie* (1919) defined a series as the
 * recurrence or clustering, in time or space, of the same or similar things
 * that no common active cause connects, and classified series by their
 * *order* (successive coincidences), *power* (parallel coincidences) and
 * *parameters* (shared attributes) — Koestler, *The Roots of Coincidence*
 * (1972), ch. III. Kammerer offered a taxonomy but no test. Chance alone
 * produces runs: a Poisson process clusters. This module prices the
 * clustering of a logged series against exactly that null; whether a surplus
 * means anything more is a hypothesis this package does not assert.
 */
import { CoincidenceError } from './errors.js'
import { kWayEngine } from './internal/kway-engine.js'
import { NeumaierSum, oneMinusExp, poissonSplit } from './internal/numerics.js'
import { finiteNumber, optionsObject, positiveFinite } from './internal/validate.js'
import type { DispersionSummary, SeriesClusteringOptions, SeriesClusteringResult } from './types.js'

/** Most windows a series may be cut into. */
export const MAX_WINDOWS = 1e7

function spanOf(span: unknown): { start: number; end: number } {
  if (typeof span === 'number') return { start: 0, end: positiveFinite('options.span', span) }
  if (span === null || typeof span !== 'object' || Array.isArray(span)) {
    throw new CoincidenceError(
      'invalid_input',
      'options.span must be a positive number or { start, end }',
      { argument: 'options.span' },
    )
  }
  const { start, end } = span as { start: unknown; end: unknown }
  finiteNumber('options.span.start', start)
  finiteNumber('options.span.end', end)
  if (!((end as number) > (start as number))) {
    throw new CoincidenceError('invalid_input', 'options.span.end must be greater than start', {
      argument: 'options.span',
    })
  }
  return { start: start as number, end: end as number }
}

function dispersion(
  counts: readonly number[],
  expected: readonly number[],
  mean: number,
  variance: number,
): DispersionSummary {
  const statistic = new NeumaierSum()
  counts.forEach((x, i) => {
    const e = expected[i] as number
    statistic.add(((x - e) * (x - e)) / e)
  })
  const v = Math.max(0, variance)
  return {
    statistic: statistic.value,
    mean,
    variance: v,
    z: v > 0 ? (statistic.value - mean) / Math.sqrt(v) : null,
  }
}

/**
 * Exact clustering test for event timestamps on a fixed grid of windows.
 *
 * The span `[start, end]` is tiled from `start` into windows of width
 * `window` (the last may be shorter); each event is counted in its window.
 * The statistic is the largest window count M (the scan statistic on this
 * grid) and the p-value is exact:
 *
 * - **conditional null** (default): given the n observed events, their times
 *   are independent and uniform on the span — a homogeneous Poisson process
 *   of unknown rate. Counts are Multinomial(n; ℓ_i/L) and
 *   P(M ≥ m) is the k-fold match probability for categories of probability
 *   ℓ_i/L (see `kWayProbabilities`).
 * - **Poisson null** (`rate` given, pre-specified — not estimated from the
 *   same data): counts are independent Poisson(rate·ℓ_i) and
 *   $P(M \ge m) = 1 - \prod_i P(X_i < m)$.
 *
 * It also reports Pearson's dispersion $X^2 = \sum (x_i - e_i)^2/e_i$ with its
 * exact null mean and variance (Haldane 1937:
 * $\mathrm{Var} = 2(B-1) + (\sum_i 1/p_i - B^2 - 2B + 2)/n$ conditionally;
 * $\sum_i (2 + 1/e_i)$ under the Poisson null) and the standardized z — no
 * p-value is claimed for it, because the χ² approximation fails for the
 * small expected counts typical of coincidence logs.
 *
 * The grid (origin and width) is part of the hypothesis: fix it before
 * looking at the data. Trying several widths or origins and reporting the best
 * is a multiple comparison this function cannot see.
 *
 * @param times event timestamps, finite numbers inside the span (any unit)
 * @param options `window` width, `span`, optional pre-specified `rate`
 */
export function seriesClustering(
  times: readonly number[] | Float64Array,
  options: SeriesClusteringOptions,
): SeriesClusteringResult {
  if (!Array.isArray(times) && !(times instanceof Float64Array)) {
    throw new CoincidenceError('invalid_input', 'times must be an array of numbers', {
      argument: 'times',
    })
  }
  if (options === undefined) {
    throw new CoincidenceError('invalid_input', 'options { window, span } are required', {
      argument: 'options',
    })
  }
  const opts = optionsObject<SeriesClusteringOptions>('options', options)
  const window = positiveFinite('options.window', opts.window)
  const { start, end } = spanOf(opts.span)
  const rate = opts.rate === undefined ? undefined : positiveFinite('options.rate', opts.rate)
  const total = end - start
  const windows = Math.max(1, Math.ceil(total / window - 1e-9))
  if (windows > MAX_WINDOWS) {
    throw new CoincidenceError(
      'too_large',
      `span / window gives ${windows} windows (limit ${MAX_WINDOWS})`,
      { argument: 'options.window' },
    )
  }
  const counts = new Array<number>(windows).fill(0)
  for (let i = 0; i < times.length; i++) {
    const t = finiteNumber(`times[${i}]`, times[i])
    if (t < start || t > end) {
      throw new CoincidenceError(
        'invalid_input',
        `times[${i}] = ${t} lies outside the span [${start}, ${end}]`,
        { argument: `times[${i}]` },
      )
    }
    const index = Math.min(windows - 1, Math.floor((t - start) / window))
    counts[index] = (counts[index] as number) + 1
  }
  const n = times.length
  const last = total - (windows - 1) * window
  const lengths = Array.from({ length: windows }, (_, i) => (i < windows - 1 ? window : last))
  let maxCount = 0
  let maxWindow = 0
  counts.forEach((x, i) => {
    if (x > maxCount) {
      maxCount = x
      maxWindow = i
    }
  })
  const base = {
    n,
    start,
    end,
    window,
    windows,
    counts,
    maxCount,
    maxWindow,
    maxWindowStart: start + maxWindow * window,
  }

  if (rate !== undefined) {
    const expected = lengths.map((length) => rate * length)
    let pValue = 1
    if (maxCount > 0) {
      const lnNone = new NeumaierSum()
      for (const mu of expected) {
        const split = poissonSplit(maxCount, mu)
        lnNone.add(split.atLeast < 0.5 ? Math.log1p(-split.atLeast) : Math.log(split.below))
      }
      pValue = oneMinusExp(lnNone.value)
    }
    const variance = new NeumaierSum()
    for (const mu of expected) variance.add(2 + 1 / mu)
    return {
      ...base,
      expected,
      null: 'poisson',
      pValue,
      method: 'poisson-product',
      dispersion: dispersion(counts, expected, windows, variance.value),
    }
  }

  const probs = lengths.map((length) => length / total)
  const expected = probs.map((p) => n * p)
  if (n === 0) {
    return { ...base, expected, null: 'conditional', pValue: 1, method: 'dp', dispersion: null }
  }
  const equal = Math.abs(last - window) <= 1e-12 * window
  const result = kWayEngine(n, equal ? { uniform: windows } : probs, maxCount)
  const inverse = new NeumaierSum()
  for (const p of probs) inverse.add(1 / p)
  const variance = 2 * (windows - 1) + (inverse.value - windows * windows - 2 * windows + 2) / n
  return {
    ...base,
    expected,
    null: 'conditional',
    pValue: result.match,
    method: result.method,
    dispersion: dispersion(counts, expected, windows - 1, variance),
  }
}
