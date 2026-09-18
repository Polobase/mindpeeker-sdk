// The closed forms the flow README states, so every empirical number on the
// page has its exact reference next to it. CLIENT-ONLY: `chi2Density` uses the
// SDK's own `lnGamma`.

import { lnGamma } from '@mindpeeker/negentropy/numerics'

/**
 * Free parameters the source adds to the destination's Markov model:
 * df = (A_Y − 1) · A_Y^k · (A_X^l − 1).
 */
export function degreesOfFreedom(
  alphabetY: number,
  alphabetX: number,
  k: number,
  l: number,
): number {
  return (alphabetY - 1) * alphabetY ** k * (alphabetX ** l - 1)
}

/** Cells of the joint table: A_Y^{k+1} · A_X^l. */
export function cellCount(alphabetY: number, alphabetX: number, k: number, l: number): number {
  return alphabetY ** (k + 1) * alphabetX ** l
}

/**
 * The plug-in bias of two independent finite streams, ≈ df / (2N ln2) bits over
 * N embedded tuples. An approximation — it holds only while N is large against
 * the table.
 */
export function biasFloor(df: number, tuples: number): number {
  return tuples > 0 ? df / (2 * tuples * Math.LN2) : Number.NaN
}

/** `chiSquareTest`'s adequacy rule: N ≥ minSamplesPerCell · A_Y^{k+1} A_X^l. */
export function adequacyThreshold(cells: number, minSamplesPerCell = 10): number {
  return minSamplesPerCell * cells
}

/** G = 2N ln2 · TE — the log-likelihood-ratio statistic behind the χ² test. */
export function gStatistic(te: number, tuples: number): number {
  return 2 * tuples * Math.LN2 * te
}

/** χ²(df) probability density, from the SDK's log-gamma. */
export function chi2Density(x: number, df: number): number {
  if (!(x > 0)) return 0
  const half = df / 2
  return Math.exp((half - 1) * Math.log(x) - x / 2 - half * Math.LN2 - lnGamma(half))
}

/**
 * The χ² null mapped onto the transfer-entropy axis: with G = c·TE and
 * c = 2N ln2, the density of TE is c · f_{χ²(df)}(c · TE).
 */
export function teNullDensity(df: number, tuples: number): (te: number) => number {
  const c = 2 * tuples * Math.LN2
  return (te: number) => c * chi2Density(c * te, df)
}

/** Smallest p a permutation test with `n` surrogates can report: 1/(n+1). */
export function smallestP(surrogates: number): number {
  return 1 / (surrogates + 1)
}

/** Surrogates a level-α test needs at minimum: 1/α − 1. */
export function surrogatesForAlpha(alpha: number): number {
  return Math.ceil(1 / alpha - 1)
}

/** Embedded tuples a length-n pair yields at this embedding. */
export function tupleCount(n: number, k: number, l: number, lag: number): number {
  return Math.max(0, n - Math.max(k - 1, lag + l - 2) - 1)
}

/** Maximum permutation entropy in bits for order m: log2(m!). */
export function maxPermutationEntropy(order: number): number {
  return Math.log2(factorial(order))
}

export function factorial(m: number): number {
  let f = 1
  for (let i = 2; i <= m; i++) f *= i
  return f
}
