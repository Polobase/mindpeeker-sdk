// Reading a pasted category vector, and the one transformation the
// non-uniformity lemma needs.
//
// The SDK wants probabilities summing to 1; people have counts. `parseVector`
// accepts either and says which reading it used, so nothing is silently
// renormalized behind the reader's back.

import { probabilitiesFromCounts } from '@mindpeeker/coincidence'

/** Editing 4000 numbers in a textarea is already absurd; past it we refuse. */
export const MAX_CATEGORIES = 4000

export interface ParsedVector {
  /** Probabilities summing to 1 (empty when `error` is set). */
  readonly probs: readonly number[]
  /** The numbers as typed. */
  readonly raw: readonly number[]
  readonly mode: 'probabilities' | 'counts'
  readonly sum: number
  /** Categories with p > 0 — the only ones the SDK counts. */
  readonly support: number
  readonly error?: string
}

const EMPTY: ParsedVector = { probs: [], raw: [], mode: 'counts', sum: 0, support: 0 }

/**
 * Parse whitespace/comma/semicolon separated numbers. A vector summing to 1
 * (within 1e-6) is read as probabilities; anything else as counts, normalized
 * with `probabilitiesFromCounts`.
 */
export function parseVector(text: string): ParsedVector {
  const tokens = text.split(/[\s,;]+/).filter((token) => token.length > 0)
  if (tokens.length === 0) return { ...EMPTY, error: 'Enter at least one category.' }
  if (tokens.length > MAX_CATEGORIES) {
    return { ...EMPTY, error: `That is ${tokens.length} categories; this page stops at ${MAX_CATEGORIES}.` }
  }
  const raw: number[] = []
  for (const token of tokens) {
    const value = Number(token)
    if (!Number.isFinite(value)) return { ...EMPTY, error: `“${token}” is not a number.` }
    if (value < 0) return { ...EMPTY, error: `“${token}” is negative; category weights cannot be.` }
    raw.push(value)
  }
  const sum = raw.reduce((total, value) => total + value, 0)
  if (sum <= 0) return { ...EMPTY, raw, error: 'The weights sum to zero.' }
  const mode: ParsedVector['mode'] = Math.abs(sum - 1) <= 1e-6 ? 'probabilities' : 'counts'
  try {
    const probs = mode === 'probabilities' ? normalize(raw) : probabilitiesFromCounts(raw)
    return { probs, raw, mode, sum, support: probs.filter((p) => p > 0).length }
  } catch (error) {
    return { ...EMPTY, raw, sum, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Re-sum to exactly 1 so a vector typed to 6 decimals still validates. */
function normalize(values: readonly number[]): number[] {
  const sum = values.reduce((total, value) => total + value, 0)
  return values.map((value) => value / sum)
}

/**
 * Move a distribution a fraction λ of the way to uniform over its support:
 * $p_i(λ) = (1-λ)p_i + λ/c$. Haigh's lemma says P(all different) rises
 * monotonically along this path, so the match probability falls — flat
 * categories minimise coincidences.
 */
export function mixToUniform(probs: readonly number[], lambda: number): number[] {
  const c = probs.length
  return probs.map((p) => (1 - lambda) * p + lambda / c)
}

/** Largest probabilities first, for a readable bar chart. */
export function topCategories(
  probs: readonly number[],
  limit: number,
): { labels: string[]; values: number[]; truncated: number } {
  const indexed = probs.map((p, index) => ({ p, index }))
  indexed.sort((a, b) => b.p - a.p)
  const head = indexed.slice(0, limit)
  return {
    labels: head.map((entry) => `#${entry.index + 1}`),
    values: head.map((entry) => entry.p),
    truncated: Math.max(0, probs.length - head.length),
  }
}
