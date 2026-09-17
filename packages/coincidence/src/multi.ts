/**
 * Many types of categories (Diaconis & Mosteller 1989, Problem 2): people
 * compare birthdays, home towns, first names … — a match in *any* attribute
 * counts as a coincidence.
 */
import { lnBirthdayNoMatch } from './birthday.js'
import { NeumaierSum, oneMinusExp, reachesTarget } from './internal/numerics.js'
import { smallestSatisfying } from './internal/search.js'
import {
  categoryList,
  nonNegativeInteger,
  optionsObject,
  targetProbability,
} from './internal/validate.js'
import type { MultiCategoryOptions, MultiCategorySummary } from './types.js'

function lnNoMatchAny(n: number, cs: readonly number[]): number {
  const sum = new NeumaierSum()
  for (const c of cs) {
    const term = lnBirthdayNoMatch(n, c)
    if (term === Number.NEGATIVE_INFINITY) return term
    sum.add(term)
  }
  return sum.value
}

/**
 * Exact probability that n people show **no** match in any of several
 * independent attributes with $c_1, \dots, c_k$ equally likely values. The
 * attributes are independent, so the no-match events are too and the exact
 * probability on the product space is the product
 * $$P = \prod_{a=1}^{k} \prod_{i=0}^{n-1}\Bigl(1 - \frac i{c_a}\Bigr).$$
 *
 * @param n people, a non-negative safe integer
 * @param cs values per attribute, positive safe integers
 */
export function multiCategoryNoMatch(n: number, cs: readonly number[]): number {
  nonNegativeInteger('n', n)
  return Math.exp(lnNoMatchAny(n, categoryList('cs', cs)))
}

/**
 * Exact probability that at least two of n people match in **at least one**
 * of several independent attributes; see {@link multiCategoryNoMatch}.
 * Diaconis & Mosteller's example — birthdays (365), lottery tickets (1000)
 * and theatre tickets on different nights (500) — reaches ½ at 16 people.
 */
export function multiCategoryMatch(n: number, cs: readonly number[]): number {
  nonNegativeInteger('n', n)
  return oneMinusExp(lnNoMatchAny(n, categoryList('cs', cs)))
}

/**
 * Diaconis & Mosteller's harmonic-mean rule next to the exact answer.
 *
 * To leading order the k attributes act like one attribute with
 * $1/\sum_a 1/c_a = H/k$ values (H the harmonic mean), so about
 * $$N \approx \sqrt{2\ln\tfrac1{1-p}}\;\sqrt{H/k}$$
 * people give probability p of some match — their "$1.2\sqrt{H/k}$" at
 * p = ½. `peopleExact` inverts {@link multiCategoryMatch} exactly.
 *
 * @param cs values per attribute, positive safe integers
 * @param options `p`, the target probability (default ½)
 */
export function multiCategory(
  cs: readonly number[],
  options?: MultiCategoryOptions,
): MultiCategorySummary {
  const categories = categoryList('cs', cs)
  const opts = optionsObject<MultiCategoryOptions>('options', options)
  const p = targetProbability('options.p', opts.p ?? 0.5)
  const inverse = new NeumaierSum()
  for (const c of categories) inverse.add(1 / c)
  const effectiveCategories = 1 / inverse.value
  const peopleApprox =
    p === 1 ? Number.POSITIVE_INFINITY : Math.sqrt(-2 * effectiveCategories * Math.log1p(-p))
  let hi = Number.POSITIVE_INFINITY
  for (const c of categories) hi = Math.min(hi, c + 1)
  const peopleExact =
    p === 1
      ? hi
      : smallestSatisfying(
          (n) => reachesTarget(lnNoMatchAny(n, categories), p),
          1,
          hi,
          peopleApprox,
        )
  return {
    categories,
    harmonicMean: categories.length * effectiveCategories,
    effectiveCategories,
    p,
    peopleApprox,
    peopleExact,
  }
}
