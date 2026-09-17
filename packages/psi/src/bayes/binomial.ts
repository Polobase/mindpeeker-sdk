import { betaInc, lnBeta } from '@mindpeeker/negentropy/numerics'
import { PsiError } from '../errors.js'

/**
 * Beta prior on the per-trial success probability under H1. The default
 * $\mathrm{Beta}(1,1)$ is uniform on $[0,1]$; symmetric choices with
 * $a = b > 1$ concentrate the prior near $\tfrac12$ (small anticipated
 * effects), which is the honest choice for MMI-sized deviations.
 */
export interface BetaPrior {
  /** Shape $\alpha > 0$. Default 1. */
  a?: number
  /** Shape $\beta > 0$. Default 1. */
  b?: number
}

/**
 * Direction of H1 relative to the chance probability $p_0$:
 * - `'two-sided'` — $p \sim \mathrm{Beta}(a,b)$ on $(0,1)$;
 * - `'greater'` — the prior truncated to $(p_0, 1)$ (above-chance hitting);
 * - `'less'` — the prior truncated to $(0, p_0)$ (psi-missing).
 */
export type BinomialAlternative = 'two-sided' | 'greater' | 'less'

/** Options for {@link binomialBayesFactor} and {@link binomialLogBayesFactor}. */
export interface BinomialBayesOptions extends BetaPrior {
  /**
   * Chance probability of a success under $H_0$, $0 < p_0 < 1$. Default
   * $\tfrac12$ (a bit, a placement test). Forced-choice designs use their own
   * null: $\tfrac14$ (ganzfeld, one target and three decoys), $\tfrac15$
   * (Zener cards), $\tfrac16$ (a die face).
   */
  p0?: number
  /** Direction of H1. Default `'two-sided'`. */
  alternative?: BinomialAlternative
}

/** A validated, default-resolved binomial Bayes-factor model. */
export interface BinomialBayesModel {
  readonly a: number
  readonly b: number
  readonly p0: number
  readonly alternative: BinomialAlternative
}

const ALTERNATIVES: readonly BinomialAlternative[] = ['two-sided', 'greater', 'less']

/**
 * Validate and resolve {@link BinomialBayesOptions}.
 *
 * @throws {PsiError} `invalid_plan` for non-finite or non-positive shapes,
 *   `p0` outside $(0,1)$, an unknown alternative, or a one-sided prior with no
 *   mass on the tested side.
 */
export function resolveBinomialModel(opts: BinomialBayesOptions = {}): BinomialBayesModel {
  if (opts === null || typeof opts !== 'object') {
    throw new PsiError('invalid_plan', 'Bayes-factor options must be an object')
  }
  const a = opts.a ?? 1
  const b = opts.b ?? 1
  const p0 = opts.p0 ?? 0.5
  const alternative = opts.alternative ?? 'two-sided'
  if (
    typeof a !== 'number' ||
    typeof b !== 'number' ||
    !(a > 0) ||
    !(b > 0) ||
    !Number.isFinite(a) ||
    !Number.isFinite(b)
  ) {
    throw new PsiError(
      'invalid_plan',
      `prior shapes must be finite and > 0, got a=${String(a)}, b=${String(b)}`,
    )
  }
  if (typeof p0 !== 'number' || !(p0 > 0 && p0 < 1)) {
    throw new PsiError('invalid_plan', `p0 must be in (0, 1), got ${String(p0)}`)
  }
  if (!ALTERNATIVES.includes(alternative)) {
    throw new PsiError(
      'invalid_plan',
      `alternative must be 'two-sided', 'greater', or 'less', got ${String(alternative)}`,
    )
  }
  if (alternative !== 'two-sided' && !(sideMass(a, b, p0, alternative) > 0)) {
    throw new PsiError(
      'invalid_plan',
      `the Beta(${a}, ${b}) prior puts no representable mass on p ${alternative === 'greater' ? '>' : '<'} ${p0}`,
    )
  }
  return Object.freeze({ a, b, p0, alternative })
}

/** Beta(a, b) mass on the tested side of p0: P(p > p0) = I_{1−p0}(b, a), P(p < p0) = I_{p0}(a, b). */
function sideMass(a: number, b: number, p0: number, alternative: 'greater' | 'less'): number {
  return alternative === 'greater' ? betaInc(b, a, 1 - p0) : betaInc(a, b, p0)
}

function assertCounts(k: unknown, n: unknown): void {
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) {
    throw new PsiError('invalid_plan', `n must be a safe integer ≥ 0, got ${String(n)}`)
  }
  if (typeof k !== 'number' || !Number.isInteger(k) || k < 0 || k > n) {
    throw new PsiError('invalid_plan', `k must be an integer in [0, ${n}], got ${String(k)}`)
  }
}

// Stirling-series coefficients B_2j / (2j(2j−1)), j = 1…8
const STIRLING = [
  1 / 12,
  -1 / 360,
  1 / 1260,
  -1 / 1680,
  1 / 1188,
  -691 / 360360,
  1 / 156,
  -3617 / 122400,
]

/** δ(y) = lnΓ(y) − [(y − ½) ln y − y + ½ ln 2π] for y ≥ 10 (truncation error < 2e-18). */
function stirlingCorrection(y: number): number {
  const inv2 = 1 / (y * y)
  let term = 1 / y
  let sum = 0
  for (const c of STIRLING) {
    sum += c * term
    term *= inv2
  }
  return sum
}

/** ln(1 + u) − u without cancellation for small |u|. */
function log1pmx(u: number): number {
  if (Math.abs(u) >= 0.01) return Math.log1p(u) - u
  // −u²/2 + u³/3 − …; |u|¹⁸/18 < 1e-37
  let power = u * u
  let sum = 0
  for (let j = 2; j <= 17; j++) {
    sum += ((j % 2 === 0 ? -1 : 1) * power) / j
    power *= u
  }
  return sum
}

/**
 * ln[x^α (1 − x)^β / B(α, β)] for α, β ≥ 10, expanded around the mean with
 * Stirling's series so the O(α ln α) terms cancel analytically:
 * α·log1pmx(d/α) + β·log1pmx(−d/β) + ½ ln(αβ/(2πs)) + δ(s) − δ(α) − δ(β),
 * with s = α + β and d = xs − α.
 */
function lnBetaPrefactorLarge(alpha: number, beta: number, x: number): number {
  const s = alpha + beta
  const d = x * s - alpha
  const scaled = (m: number, diff: number): number =>
    Math.abs(diff) < 0.5 * m ? m * log1pmx(diff / m) : m * Math.log1p(diff / m) - diff
  return (
    scaled(alpha, d) +
    scaled(beta, -d) +
    0.5 * Math.log((alpha * beta) / (2 * Math.PI * s)) +
    stirlingCorrection(s) -
    stirlingCorrection(alpha) -
    stirlingCorrection(beta)
  )
}

/**
 * $\ln BF_{10}$ for validated counts under a resolved model — the unchecked
 * kernel shared by the e-process and sequential runner.
 */
export function lnBf10Unchecked(k: number, n: number, model: BinomialBayesModel): number {
  const { a, b, p0, alternative } = model
  const alpha = k + a
  const beta = n - k + b
  // near the posterior mean every term is O(n) while the result is O(ln n): expand
  // analytically there; with a small shape the result itself is large (no cancellation)
  const base =
    alpha >= 10 && beta >= 10
      ? a * Math.log(p0) +
        b * Math.log1p(-p0) -
        lnBeta(a, b) -
        lnBetaPrefactorLarge(alpha, beta, p0)
      : lnBeta(alpha, beta) - lnBeta(a, b) - k * Math.log(p0) - (n - k) * Math.log1p(-p0)
  if (alternative === 'two-sided') return base
  // truncated prior: multiply by posterior mass / prior mass on the tested side
  const posterior = sideMass(k + a, n - k + b, p0, alternative)
  return base + Math.log(posterior) - Math.log(sideMass(a, b, p0, alternative))
}

/**
 * Natural log of the Bayes factor $BF_{10}$ for $k$ successes in $n$
 * Bernoulli trials, testing $H_1: p \sim \mathrm{Beta}(a, b)$ against the
 * chance point null $H_0: p = p_0$:
 * $$\ln BF_{10} = \ln B(k+a,\; n-k+b) - \ln B(a,b) - k \ln p_0 - (n-k)\ln(1-p_0).$$
 * One-sided alternatives truncate the prior to the tested side of $p_0$,
 * which multiplies $BF_{10}$ by the ratio of posterior to prior mass there:
 * for `'greater'`
 * $BF_{+0} = BF_{10}\,\frac{1 - I_{p_0}(k+a,\,n-k+b)}{1 - I_{p_0}(a,b)}$,
 * for `'less'` the same with $I_{p_0}$ in place of $1 - I_{p_0}$ (regularized
 * incomplete beta via negentropy's `betaInc`, computed on the small side).
 *
 * Log space throughout (`lnBeta` with Stirling corrections), so the result
 * stays finite at any $n$ up to $2^{53}$ — where `binomialBayesFactor` rounds
 * to `Infinity` or `0`. The one exception: a one-sided factor whose posterior
 * mass on the tested side underflows double precision ($< 10^{-308}$, i.e.
 * overwhelming evidence *against* that side) returns `-Infinity`.
 *
 * With the prior fixed before the data, $BF_{10}$ (either sidedness) is a
 * test martingale under $H_0$ (Shafer, Shen, Vereshchagin & Vovk 2011): by
 * Ville's inequality $P(\sup_n BF_{10} \ge 1/\alpha) \le \alpha$, however the
 * data are monitored — see {@link CoinEProcess}.
 *
 * @throws {PsiError} `invalid_plan` for counts outside $0 \le k \le n$ or bad
 *   options (see {@link resolveBinomialModel}).
 */
export function binomialLogBayesFactor(
  k: number,
  n: number,
  opts: BinomialBayesOptions = {},
): number {
  assertCounts(k, n)
  return lnBf10Unchecked(k, n, resolveBinomialModel(opts))
}

/**
 * Alias of {@link binomialLogBayesFactor}: $\ln BF_{10}$ for $k$ of $n$ —
 * the quantity to rank, sum across independent studies, or compare without
 * `Infinity - Infinity`.
 */
export const lnBayesFactor: typeof binomialLogBayesFactor = binomialLogBayesFactor

/**
 * Bayes factor $BF_{10}$ for $k$ successes in $n$ Bernoulli trials, testing
 * $H_1: p \sim \mathrm{Beta}(a, b)$ against the chance point null
 * $H_0: p = p_0$ (default $\tfrac12$). Closed form via the beta function:
 * $$BF_{10} = \frac{\int_0^1 p^k (1-p)^{n-k}\,\mathrm{Beta}(p; a, b)\,dp}
 * {p_0^k (1-p_0)^{n-k}} = \frac{B(k+a,\; n-k+b)}{B(a,b)\; p_0^k (1-p_0)^{n-k}},$$
 * which for $p_0 = \tfrac12$ is $\frac{B(k+a,\,n-k+b)}{B(a,b)}\,2^n$
 * (Jeffreys 1961, *Theory of Probability*; Wagenmakers 2007). $BF_{10} > 1$
 * favors H1, $BF_{10} < 1$ favors chance — and unlike a p-value it can
 * *quantify support for the null*, the property that makes it the right
 * summary for MMI claims. `alternative` selects a one-sided H1 (see
 * {@link binomialLogBayesFactor}).
 *
 * This is `Math.exp(binomialLogBayesFactor(k, n, opts))`, so it rounds to
 * `Infinity` for $\ln BF_{10} > 709.78$ and to `0` below $-745$; use the log
 * form for ranking, summing, or PEAR-scale bit counts.
 *
 * @throws {PsiError} `invalid_plan` as {@link binomialLogBayesFactor}; `n` must
 *   additionally be ≥ 1.
 */
export function binomialBayesFactor(k: number, n: number, opts: BinomialBayesOptions = {}): number {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
    throw new PsiError('invalid_plan', `n must be an integer ≥ 1, got ${String(n)}`)
  }
  return Math.exp(binomialLogBayesFactor(k, n, opts))
}
