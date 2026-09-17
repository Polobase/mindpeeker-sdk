/**
 * Birthday problems with unequal category probabilities — the realistic case
 * for word values, oracle outcomes on biased sources, real birthdays.
 *
 * Non-uniformity always *raises* the chance of a match. Replacing two
 * probabilities x, y by their mean changes P(all different) by
 * $n!\,\frac{(x-y)^2}{4}\,e_{n-2}(\text{rest}) \ge 0$ (Haigh, *Taking
 * Chances*, 1999), so the uniform distribution minimises the match
 * probability for every n.
 */
import { CoincidenceError } from './errors.js'
import { NeumaierSum, oneMinusExp } from './internal/numerics.js'
import {
  nonNegativeFinite,
  nonNegativeInteger,
  optionsObject,
  probabilityVector,
} from './internal/validate.js'
import type { NonUniformMethod, NonUniformOptions, NonUniformResult } from './types.js'

/**
 * Work limit (draws × categories with p > 0) for the exact recursion in
 * {@link noMatchNonUniform}; about a second of arithmetic.
 */
export const NONUNIFORM_EXACT_LIMIT = 1e8

/**
 * Collision probability $q = \sum_i p_i^2$: the chance that two independent
 * draws land in the same category. $1/q$ is the "effective number of
 * categories" and $-\log_2 q$ the Rényi collision entropy in bits. For c equal
 * categories $q = 1/c$; any unevenness makes q larger.
 *
 * @param probs category probabilities (non-negative, summing to 1 within 1e-9)
 */
export function collisionProbability(probs: readonly number[] | Float64Array): number {
  const p = probabilityVector('probs', probs)
  const sum = new NeumaierSum()
  for (const x of p) sum.add(x * x)
  return sum.value
}

/**
 * Normalize a histogram (counts or any non-negative weights) into category
 * probabilities, $p_i = w_i / \sum w$.
 */
export function probabilitiesFromCounts(counts: readonly number[] | Float64Array): number[] {
  if (!Array.isArray(counts) && !(counts instanceof Float64Array)) {
    throw new CoincidenceError('invalid_input', 'counts must be an array of numbers', {
      argument: 'counts',
    })
  }
  const weights = Array.from(counts, (w, i) => nonNegativeFinite(`counts[${i}]`, w))
  const total = new NeumaierSum()
  for (const w of weights) total.add(w)
  if (!(total.value > 0)) {
    throw new CoincidenceError('invalid_input', 'counts must contain a positive entry', {
      argument: 'counts',
    })
  }
  return weights.map((w) => w / total.value)
}

/**
 * Exact P(no match) and P(match) by dynamic programming over the categories,
 * scaled so that no intermediate value underflows. After t categories with
 * total mass T_t = p_1 + … + p_t,
 *   F[j] = P(j draws are all different | all j land among the first t),
 *   G[j] = 1 − F[j] = P(some collision | all j land among the first t).
 * Adding category t (α = T_{t−1}/T_t, β = p_t/T_t) sends Binomial(j, β) of
 * the j draws into it:
 *   F[j] ← α^j·F[j] + jβα^{j−1}·F[j−1]
 *   G[j] ← α^j·G[j] + jβα^{j−1}·G[j−1] + P(Binomial(j, β) ≥ 2)
 * Each update is a (sub-)convex combination of non-negative terms, so both
 * tails keep full relative precision and a value too small to represent is
 * never amplified later. F[n] after all categories is n!·e_n(p).
 */
function exactNonUniform(n: number, probs: readonly number[]): NonUniformResult {
  const f = new Float64Array(n + 1)
  const g = new Float64Array(n + 1)
  const pow = new Float64Array(n + 1) // α^j
  const atLeastTwo = new Float64Array(n + 1) // P(Binomial(j, β) ≥ 2)
  f[0] = 1
  pow[0] = 1
  const total = new NeumaierSum()
  for (const p of probs) {
    total.add(p)
    const beta = Math.min(1, p / total.value)
    const alpha = 1 - beta
    // α^j by multiplication, re-anchored every 32 steps from ln α = log1p(−β),
    // which is accurate even when α rounds (β tiny)
    const lnAlpha = Math.log1p(-beta)
    for (let j = 1; j <= n; j++) {
      pow[j] = j % 32 === 0 ? Math.exp(j * lnAlpha) : (pow[j - 1] as number) * alpha
      if (j >= 2) {
        atLeastTwo[j] =
          (atLeastTwo[j - 1] as number) + (j - 1) * beta * beta * (pow[j - 2] as number)
      }
    }
    for (let j = n; j >= 1; j--) {
      const stay = pow[j] as number
      const one = j * beta * (pow[j - 1] as number)
      f[j] = stay * (f[j] as number) + one * (f[j - 1] as number)
      g[j] = stay * (g[j] as number) + one * (g[j - 1] as number) + (atLeastTwo[j] as number)
    }
  }
  return {
    noMatch: Math.min(1, f[n] as number),
    match: Math.min(1, g[n] as number),
    method: 'exact',
  }
}

function approximate(n: number, probs: readonly number[], method: NonUniformMethod) {
  const s2 = new NeumaierSum()
  const s3 = new NeumaierSum()
  for (const p of probs) {
    s2.add(p * p)
    s3.add(p * p * p)
  }
  const pairs = (n * (n - 1)) / 2
  let lnP = -pairs * s2.value
  if (method === 'second-order') {
    const triples = (n * (n - 1) * (n - 2)) / 6
    lnP += 2 * triples * s3.value - ((n * (n - 1) * (2 * n - 3)) / 4) * s2.value * s2.value
  }
  lnP = Math.min(0, lnP)
  return { noMatch: Math.exp(lnP), match: oneMinusExp(lnP), method }
}

/**
 * Probability that n independent draws from categories with probabilities
 * `probs` are all different (and its complement, the match probability).
 *
 * Exact method: $P(\text{no match}) = n!\,e_n(p_1, \dots, p_c)$, the n-th
 * elementary symmetric polynomial, by an O(n·c) recursion over the categories
 * that conditions on the draws landing among those seen so far (so nothing
 * underflows) and adds only non-negative terms; the match probability comes
 * from a companion recursion, so both tails keep full relative precision. Within {@link NONUNIFORM_EXACT_LIMIT}
 * (`n` × number of categories with p > 0) `'auto'` is exact; beyond it,
 * `'auto'` uses the second-order expansion
 * $$\ln P \approx -\binom n2 S_2 + 2\binom n3 S_3 - \frac{n(n-1)(2n-3)}{4}S_2^2,
 * \qquad S_k = \sum_i p_i^k,$$
 * which is accurate when $n \max_i p_i \ll 1$ (for equal categories its error
 * is $O(n^4/c^3)$ in $\ln P$). `'poisson'` keeps only the first term.
 * n larger than the number of categories with p > 0 gives exactly 0 / 1.
 *
 * @example noMatchNonUniform(23, Array(365).fill(1 / 365)).noMatch // 0.4927027656760…
 */
export function noMatchNonUniform(
  n: number,
  probs: readonly number[] | Float64Array,
  options?: NonUniformOptions,
): NonUniformResult {
  nonNegativeInteger('n', n)
  const p = probabilityVector('probs', probs).filter((x) => x > 0)
  const opts = optionsObject<NonUniformOptions>('options', options)
  const method = opts.method ?? 'auto'
  if (!['auto', 'exact', 'poisson', 'second-order'].includes(method)) {
    throw new CoincidenceError(
      'invalid_input',
      `options.method must be 'auto', 'exact', 'poisson' or 'second-order', got ${String(method)}`,
      { argument: 'options.method' },
    )
  }
  if (n <= 1) return { noMatch: 1, match: 0, method: method === 'auto' ? 'exact' : method }
  if (n > p.length && (method === 'auto' || method === 'exact')) {
    return { noMatch: 0, match: 1, method: 'exact' }
  }
  const work = n * p.length
  if (method === 'exact' || (method === 'auto' && work <= NONUNIFORM_EXACT_LIMIT)) {
    if (work > NONUNIFORM_EXACT_LIMIT) {
      throw new CoincidenceError(
        'too_large',
        `exact non-uniform match needs n × categories = ${work} > ${NONUNIFORM_EXACT_LIMIT}; ` +
          "use method 'second-order' or 'poisson'",
        { argument: 'n' },
      )
    }
    return exactNonUniform(n, p)
  }
  return approximate(n, p, method === 'auto' ? 'second-order' : method)
}
