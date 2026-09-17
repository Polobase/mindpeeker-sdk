/**
 * Multiple events (Diaconis & Mosteller 1989, Problem 3): the chance that
 * some category receives k or more of n draws — three people sharing a
 * birthday, four readings landing on the same hexagram.
 */
import { CoincidenceError } from './errors.js'
import { KWAY_WORK_LIMIT, kWayEngine } from './internal/kway-engine.js'
import { lnFactorial, NeumaierSum, oneMinusExp } from './internal/numerics.js'
import { smallestSatisfying } from './internal/search.js'
import {
  nonNegativeInteger,
  positiveFinite,
  positiveInteger,
  probabilityVector,
  targetProbability,
} from './internal/validate.js'
import type { KWayResult } from './types.js'

export { KWAY_WORK_LIMIT }

/** Either a number of equally likely categories or a probability vector. */
export type Categories = number | readonly number[] | Float64Array

function engineInput(categories: Categories): readonly number[] | { readonly uniform: number } {
  if (typeof categories === 'number') return { uniform: positiveInteger('categories', categories) }
  return probabilityVector('categories', categories).filter((p) => p > 0)
}

function categoryCount(input: readonly number[] | { readonly uniform: number }): number {
  return 'uniform' in input ? input.uniform : input.length
}

/**
 * Exact probabilities that some category receives **at least k** of n
 * independent draws (`match`) and that none does (`noMatch`). k = 2 is the
 * birthday problem.
 *
 * `categories` is a count of equally likely categories or a probability
 * vector. Two exact algorithms are chosen by cost: a conditional-binomial
 * dynamic programme (≈ categories·n·k operations; both tails at full relative
 * precision) or Levin's (1981) truncated-Poisson representation with repeated
 * squaring (≈ n²·log₂ c for c equal categories; relative error of `noMatch`
 * ≈ c·10⁻¹⁶, and `match = 1 − noMatch` carries it as absolute error). `method`
 * says which ran. When neither fits {@link KWAY_WORK_LIMIT} (about two seconds
 * of arithmetic) it throws `too_large` — use {@link kWayMatchApprox}.
 *
 * Reproduces Levin's exact table in Diaconis & Mosteller (1989, Table 3):
 * with 365 days, 88 people give a triple birthday with probability 0.5111,
 * 187 a quadruple with 0.5027, 1813 a 13-fold with 0.5011.
 *
 * @param n draws (people), a non-negative safe integer
 * @param categories number of equal categories, or their probabilities (sum 1)
 * @param k fold size, a positive safe integer
 */
export function kWayProbabilities(n: number, categories: Categories, k: number): KWayResult {
  nonNegativeInteger('n', n)
  const input = engineInput(categories)
  positiveInteger('k', k)
  return kWayEngine(n, input, k)
}

/** Exact P(some category receives ≥ k of n draws); see {@link kWayProbabilities}. */
export function kWayMatch(n: number, categories: Categories, k: number): number {
  return kWayProbabilities(n, categories, k).match
}

/** Exact P(every category receives fewer than k of n draws); see {@link kWayProbabilities}. */
export function kWayNoMatch(n: number, categories: Categories, k: number): number {
  return kWayProbabilities(n, categories, k).noMatch
}

/**
 * Smallest n with exact `kWayMatch(n, categories, k) ≥ p`. Starts at the
 * Diaconis–Mosteller approximation and brackets outward, so only a handful of
 * exact evaluations near the answer are made. `peopleForKWayMatch(0.5, 365, 3)`
 * is 88.
 */
export function peopleForKWayMatch(p: number, categories: Categories, k: number): number {
  targetProbability('p', p)
  const input = engineInput(categories)
  positiveInteger('k', k)
  const c = categoryCount(input)
  if (k === 1) return 1
  const hi = c * (k - 1) + 1
  if (!Number.isSafeInteger(hi)) {
    throw new CoincidenceError('too_large', 'categories × (k − 1) exceeds the safe-integer range', {
      argument: 'k',
    })
  }
  // effective equal-category count with the same Σ p^k
  let effective = c
  if (!('uniform' in input)) {
    const sum = new NeumaierSum()
    for (const q of input) sum.add(q ** k)
    effective = sum.value ** (-1 / (k - 1))
  }
  if (p === 1) return hi
  const reaches = (n: number) => {
    const result = kWayEngine(n, input, k)
    return p > 0.5 ? result.noMatch <= 1 - p : result.match >= p
  }
  return smallestSatisfying(reaches, k, hi, dmPeople(p, effective, k))
}

/** ln of the Diaconis–Mosteller expected count of k-fold categories (see kWayMatchApprox). */
function lnKFoldIntensity(n: number, c: number, k: number): number {
  return (
    k * Math.log(n) -
    n / c -
    (k - 1) * Math.log(c) -
    lnFactorial(k) -
    Math.log1p(-n / (c * (k + 1)))
  )
}

/**
 * Diaconis & Mosteller's large-c approximation (after their eq. 7.5):
 * $$P(\text{k-fold match}) \approx 1 - \exp\Bigl(-\frac{n^k e^{-n/c}}
 *   {c^{k-1}\,k!\,\bigl(1 - n/(c(k+1))\bigr)}\Bigr),$$
 * i.e. c times the Poisson probability that one category receives at least k.
 * Returns exactly 1 for n > c(k − 1) (pigeonhole) and 0 for n < k.
 *
 * @param n draws, a non-negative safe integer
 * @param c number of equally likely categories, a finite number > 0
 * @param k fold size, a positive safe integer
 */
export function kWayMatchApprox(n: number, c: number, k: number): number {
  nonNegativeInteger('n', n)
  positiveFinite('c', c)
  positiveInteger('k', k)
  if (n < k) return 0
  if (k === 1 || n > c * (k - 1)) return 1
  return oneMinusExp(-Math.exp(lnKFoldIntensity(n, c, k)))
}

function dmPeople(p: number, c: number, k: number): number {
  const rhs = (Math.log(c) * (k - 1) + lnFactorial(k) + Math.log(-Math.log1p(-p))) / k
  const f = (n: number) => Math.log(n) - n / (c * k) - Math.log1p(-n / (c * (k + 1))) / k - rhs
  let lo = 0
  let hi = c * (k + 1)
  for (let i = 0; i < 200 && hi - lo > 1e-12 * hi; i++) {
    const mid = (lo + hi) / 2
    if (mid === lo || mid === hi) break
    if (f(mid) < 0) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/**
 * Diaconis & Mosteller's (1989) eq. 7.5, solved for N: the approximate number
 * of draws for probability p of a k-fold match among c equal categories,
 * $$N e^{-N/(ck)}\bigl(1 - N/(c(k+1))\bigr)^{-1/k} = \bigl(c^{k-1}\,k!\,\ln\tfrac1{1-p}\bigr)^{1/k}.$$
 * The left side increases strictly on $(0, c(k+1))$, so bisection finds the
 * unique root. Their example: c = 30 days of the month, k = 3, p = ½ gives
 * N ≈ 18 (17.96; the exact answer is 18). Returns a real number; `Infinity`
 * for p = 1.
 */
export function peopleForKWayMatchApprox(p: number, c: number, k: number): number {
  targetProbability('p', p)
  positiveFinite('c', c)
  positiveInteger('k', k)
  if (p === 1) return Number.POSITIVE_INFINITY
  if (k === 1) return 1
  return dmPeople(p, c, k)
}
