/** Exact binomial tails, the two-sided exact p-value, and Clopper–Pearson bounds. */
import type { ConfidenceInterval } from '../types.js'
import { betaPpf, binomialCdf, binomialPmf, binomialSf } from './numerics.js'

/** P(X ≥ k) for X ~ Binomial(n, p), exact. */
export function upperTail(k: number, n: number, p: number): number {
  return k <= 0 ? 1 : binomialSf(k - 1, n, p)
}

/** P(X ≤ k) for X ~ Binomial(n, p), exact. */
export function lowerTail(k: number, n: number, p: number): number {
  return binomialCdf(k, n, p)
}

/**
 * Two-sided exact binomial p-value by the minimum-likelihood rule: the total
 * probability of every outcome no more likely than the observed one,
 * $\sum_{j:\,f(j) \le f(k)(1+10^{-7})} f(j)$ with $f$ the Binomial(n, p) pmf.
 * The relative tolerance and the search are those of SciPy's `binomtest`
 * (after Clopper & Pearson's pmf ordering), so values agree with it.
 * The pmf is unimodal and $\lfloor np \rfloor$/$\lceil np \rceil$ bound the
 * mode, so the far side is one contiguous tail found by binary search.
 */
export function twoSidedP(k: number, n: number, p: number): number {
  const np = n * p
  if (k === np) return 1
  const threshold = binomialPmf(k, n, p) * (1 + 1e-7)
  if (k < np) {
    // smallest j ≥ ⌈np⌉ with pmf(j) ≤ threshold (pmf non-increasing there)
    let lo = Math.ceil(np)
    let hi = n
    if (binomialPmf(hi, n, p) > threshold) return Math.min(1, lowerTail(k, n, p))
    while (lo < hi) {
      const mid = lo + Math.floor((hi - lo) / 2)
      if (binomialPmf(mid, n, p) <= threshold) hi = mid
      else lo = mid + 1
    }
    return Math.min(1, lowerTail(k, n, p) + upperTail(lo, n, p))
  }
  // largest j ≤ ⌊np⌋ with pmf(j) ≤ threshold (pmf non-decreasing there)
  let lo = 0
  let hi = Math.floor(np)
  if (binomialPmf(0, n, p) > threshold) return Math.min(1, upperTail(k, n, p))
  while (lo < hi) {
    const mid = lo + Math.ceil((hi - lo) / 2)
    if (binomialPmf(mid, n, p) <= threshold) lo = mid
    else hi = mid - 1
  }
  return Math.min(1, lowerTail(lo, n, p) + upperTail(k, n, p))
}

/**
 * Clopper–Pearson ("exact") interval for a binomial proportion: the bounds
 * invert the two one-sided exact tests at level $(1-c)/2$ each,
 * $L = B^{-1}(\tfrac{1-c}{2};\,k,\,n-k+1)$ and
 * $U = B^{-1}(\tfrac{1+c}{2};\,k+1,\,n-k)$, with $L = 0$ at $k = 0$ and
 * $U = 1$ at $k = n$ (Clopper & Pearson 1934). Coverage is at least $c$.
 */
export function clopperPearson(k: number, n: number, confidence: number): ConfidenceInterval {
  const tail = (1 - confidence) / 2
  const lower = k === 0 ? 0 : betaPpf(tail, k, n - k + 1)
  const upper = k === n ? 1 : betaPpf(1 - tail, k + 1, n - k)
  return Object.freeze({ lower, upper, confidence })
}
