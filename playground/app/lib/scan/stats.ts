// Small statistics and shaping helpers for the scan page. CLIENT-ONLY
// (imports @mindpeeker/negentropy/numerics for the exact χ² tail).

import { chi2Sf } from '@mindpeeker/negentropy/numerics'

/** Standard normal density — the reference curve for a z histogram. */
export function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
}

/** Median of a numeric list (does not mutate the input). */
export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}

/** Share of `values` that satisfy `test`. */
export function shareWhere(values: readonly number[], test: (v: number) => boolean): number {
  if (values.length === 0) return Number.NaN
  let hits = 0
  for (const v of values) if (test(v)) hits += 1
  return hits / values.length
}

export interface GoodnessOfFit {
  readonly statistic: number
  readonly df: number
  readonly p: number
}

/**
 * Pearson χ² goodness of fit of `counts` against `expected` counts
 * (`chi2Sf` from `@mindpeeker/negentropy/numerics` gives the exact upper tail).
 * Used for "are these digits uniform?", never as evidence of an effect.
 */
export function chiSquareUniform(counts: readonly number[], expected: number): GoodnessOfFit {
  let statistic = 0
  for (const c of counts) {
    const d = c - expected
    statistic += (d * d) / expected
  }
  const df = Math.max(1, counts.length - 1)
  return { statistic, df, p: chi2Sf(statistic, df) }
}

/** Normalised frequencies of integers in `[0, size)`. */
export function frequencies(values: readonly number[], size: number): number[] {
  const counts = new Array<number>(size).fill(0)
  for (const v of values) {
    if (v >= 0 && v < size) counts[v] = (counts[v] as number) + 1
  }
  const total = values.length || 1
  return counts.map((c) => c / total)
}

/** Integer counts of values in `[0, size)`. */
export function histogramCounts(values: readonly number[], size: number): number[] {
  const counts = new Array<number>(size).fill(0)
  for (const v of values) {
    if (v >= 0 && v < size) counts[v] = (counts[v] as number) + 1
  }
  return counts
}

/** A short prefix of a hex digest, for display. */
export function shortHash(hex: string | undefined, head = 10): string {
  if (!hex) return '—'
  return hex.length <= head ? hex : `${hex.slice(0, head)}…`
}

/** Bytes a beacon round yields, used only for "about N fetches" hints. */
export const BEACON_ROUND_BYTES = 32
