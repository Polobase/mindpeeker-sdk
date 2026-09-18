// Goodness-of-fit against an oracle's exact odds. CLIENT-ONLY (it imports the
// SDK's numerics entry point).
//
// The odds are exact rational numbers, so the null is fully specified and no
// parameter is estimated: df = bins − 1. Cells whose expected count is below 5
// are pooled with their neighbours, because Pearson's χ² approximation is the
// part of this that is *not* exact.

import { chi2Sf } from '@mindpeeker/negentropy/numerics'

export interface GoodnessOfFit {
  readonly chi2: number
  readonly df: number
  /** Pointwise p: large is "no deviation detected", never "the odds are right". */
  readonly p: number
  readonly bins: number
  /** True when cells were merged to keep every expected count ≥ 5. */
  readonly pooled: boolean
  readonly samples: number
}

const MIN_EXPECTED = 5

/**
 * Pearson χ² of `observed` counts against exact `probabilities`.
 * Returns `undefined` when there is not enough data for two pooled bins.
 */
export function goodnessOfFit(
  observed: ArrayLike<number>,
  probabilities: ArrayLike<number>,
): GoodnessOfFit | undefined {
  const cells = Math.min(observed.length, probabilities.length)
  let samples = 0
  for (let i = 0; i < cells; i++) samples += observed[i] as number
  if (samples <= 0) return undefined

  const pooledObserved: number[] = []
  const pooledExpected: number[] = []
  let runObserved = 0
  let runExpected = 0
  for (let i = 0; i < cells; i++) {
    runObserved += observed[i] as number
    runExpected += (probabilities[i] as number) * samples
    if (runExpected >= MIN_EXPECTED) {
      pooledObserved.push(runObserved)
      pooledExpected.push(runExpected)
      runObserved = 0
      runExpected = 0
    }
  }
  if (pooledExpected.length === 0) return undefined
  if (runExpected > 0) {
    const last = pooledExpected.length - 1
    pooledObserved[last] = (pooledObserved[last] as number) + runObserved
    pooledExpected[last] = (pooledExpected[last] as number) + runExpected
  }
  if (pooledExpected.length < 2) return undefined

  let chi2 = 0
  for (let i = 0; i < pooledExpected.length; i++) {
    const expected = pooledExpected[i] as number
    const delta = (pooledObserved[i] as number) - expected
    chi2 += (delta * delta) / expected
  }
  const df = pooledExpected.length - 1
  return {
    chi2,
    df,
    p: chi2Sf(chi2, df),
    bins: pooledExpected.length,
    pooled: pooledExpected.length < cells,
    samples,
  }
}

/** Counts as frequencies that sum to 1 (an empty tally stays all zeros). */
export function toFrequencies(counts: ArrayLike<number>): number[] {
  let total = 0
  for (let i = 0; i < counts.length; i++) total += counts[i] as number
  const out = new Array<number>(counts.length).fill(0)
  if (total <= 0) return out
  for (let i = 0; i < counts.length; i++) out[i] = (counts[i] as number) / total
  return out
}
