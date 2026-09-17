/**
 * The standard birthday problem (Diaconis & Mosteller 1989, Problem 1):
 * n draws, independently and uniformly, from c equally likely categories.
 */
import { lnFallingOverPower, oneMinusExp, reachesTarget } from './internal/numerics.js'
import { smallestSatisfying } from './internal/search.js'
import {
  nonNegativeFinite,
  nonNegativeInteger,
  positiveFinite,
  positiveInteger,
  targetProbability,
} from './internal/validate.js'

/** ln P(no match) = ln ∏_{i<n}(1 − i/c); −∞ when n > c. */
export function lnBirthdayNoMatch(n: number, c: number): number {
  return lnFallingOverPower(c, n, c)
}

/**
 * Exact probability that n draws from c equally likely categories are all
 * different:
 * $$P(\text{no match}) = \prod_{i=0}^{n-1}\Bigl(1 - \frac ic\Bigr) = \frac{c!}{(c-n)!\,c^n}$$
 * (Diaconis & Mosteller 1989, eq. 7.1). Computed in log space, so it neither
 * overflows nor loses the tiny values; 0 when n > c (pigeonhole).
 *
 * @example birthdayNoMatch(23, 365) // 0.4927027656760146
 * @param n number of draws (people), a non-negative safe integer
 * @param c number of categories (days), a positive safe integer
 */
export function birthdayNoMatch(n: number, c: number): number {
  nonNegativeInteger('n', n)
  positiveInteger('c', c)
  return Math.exp(lnBirthdayNoMatch(n, c))
}

/**
 * Exact probability that at least two of n draws from c equally likely
 * categories coincide, $1 - \prod_{i<n}(1 - i/c)$, formed as
 * $-\mathrm{expm1}(\ln P(\text{no match}))$ so small probabilities keep full
 * precision.
 *
 * @example birthdayMatch(23, 365) // 0.5072972343239854 — the classic "23 people"
 */
export function birthdayMatch(n: number, c: number): number {
  nonNegativeInteger('n', n)
  positiveInteger('c', c)
  return oneMinusExp(lnBirthdayNoMatch(n, c))
}

/**
 * The Poisson (pair-count) approximation of the **no-match** probability,
 * $\exp(-n(n-1)/2c)$: $\binom n2$ pairs, each matching with probability $1/c$.
 * Diaconis & Mosteller write it $\exp(-N^2/2c)$ (eq. 7.2), the same to
 * leading order; it is good when n is small compared with $c^{2/3}$.
 * `1 − birthdayApprox(n, c)` approximates the match probability.
 *
 * @param n number of draws, a finite number ≥ 0
 * @param c number of categories, a finite number > 0 (need not be an integer)
 */
export function birthdayApprox(n: number, c: number): number {
  nonNegativeFinite('n', n)
  positiveFinite('c', c)
  return Math.exp(-(n * Math.max(0, n - 1)) / (2 * c))
}

/**
 * Exact inversion: the smallest n with `birthdayMatch(n, c) ≥ p`.
 * `peopleForMatch(0.5, 365)` is 23, `peopleForMatch(0.95, 365)` is 47 and
 * `peopleForMatch(1, c)` is c + 1. The search is a bisection over the exact
 * probability (O(log c) evaluations, each O(1) beyond 2048 draws).
 *
 * @param p target probability in (0, 1]
 * @param c number of categories, a positive safe integer
 */
export function peopleForMatch(p: number, c: number): number {
  targetProbability('p', p)
  positiveInteger('c', c)
  if (p === 1) return c + 1
  const guess = Math.sqrt(-2 * c * Math.log1p(-p))
  return smallestSatisfying((n) => reachesTarget(lnBirthdayNoMatch(n, c), p), 1, c + 1, guess)
}

/**
 * Diaconis & Mosteller's approximate people count for a match with
 * probability p: set $\exp(-N^2/2c) = 1 - p$, so
 * $N = \sqrt{2c\ln(1/(1-p))}$ — $1.1774\sqrt c$ at $p = ½$ (their "1.2√c",
 * eq. 7.3) and $2.4477\sqrt c$ at $p = 0.95$ (their "2.5√c", eq. 7.4).
 * Returns a real number; `Infinity` for p = 1. This is the same leading-order
 * bound `@mindpeeker/gematria`'s `birthdayBound` uses with $q = 1/c$.
 *
 * @param p target probability in (0, 1]
 * @param c number of categories, a finite number > 0
 */
export function peopleForMatchApprox(p: number, c: number): number {
  targetProbability('p', p)
  positiveFinite('c', c)
  return p === 1 ? Number.POSITIVE_INFINITY : Math.sqrt(-2 * c * Math.log1p(-p))
}
