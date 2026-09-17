/**
 * Multiplicity baselines: what chance alone produces when the best of several
 * looks is reported, and what repeated looks at a fixed-n test do to α.
 *
 * Law of the iterated logarithm: for a fair binomial walk,
 * $\limsup (S_n - np)/\sqrt{2np(1-p)\ln\ln n} = 1$ almost surely, so a test
 * that rejects when the critical ratio exceeds any fixed $c$ will reject
 * eventually with probability 1 if one may keep adding trials and stop at the
 * first crossing (Robbins 1952; Epstein's "optional stopping"). Fixed-n
 * p-values are valid only when n was fixed in advance; for open-ended
 * monitoring use a test martingale (`forcedChoiceBayesFactor` with a fixed
 * prior, or psi's `coinEProcess`).
 */
import { binomialPmf, binomialSf, normIsf, normSf } from './internal/numerics.js'
import {
  integerAtLeast,
  invalidInput,
  numberArray,
  oneOf,
  openUnit,
  optionsObject,
  tooLarge,
} from './internal/validate.js'

/** Euler–Mascheroni constant γ. */
const EULER_GAMMA = 0.5772156649015329

/** Largest Bernoulli-step work (≈ Σ trials × support) {@link optionalStoppingRisk} performs. */
export const MAX_OPTIONAL_STOPPING_WORK = 250_000_000

/** Expected maximum of I independent standard normal looks. */
export interface ExpectedMaxOfLooks {
  readonly looks: number
  /** $E[\max_{i \le I} Z_i]$ by quadrature (relative error < 1e-12). */
  readonly exact: number
  /**
   * Bailey & López de Prado's approximation
   * $(1-\gamma)\Phi^{-1}(1 - 1/I) + \gamma\,\Phi^{-1}(1 - 1/(Ie))$; `null` for I = 1.
   */
  readonly approximation: number | null
  /** The bound $\sqrt{2\ln I}$ (for I ≥ 2 it exceeds the exact value). */
  readonly upperBound: number
}

/** Options for {@link deflatedCriticalValue} and {@link maxOfLooksPValue}. */
export interface LooksOptions {
  /** Family-wise level α. Default 0.05. */
  readonly alpha?: number
  /** `'one'` tests the largest z; `'two'` the largest |z|. Default `'one'`. */
  readonly sided?: 'one' | 'two'
}

/** Critical z for the best of I independent looks at family-wise level α. */
export interface DeflatedCriticalValue {
  readonly looks: number
  readonly alpha: number
  readonly sided: 'one' | 'two'
  /** Šidák per-look level $1 - (1-\alpha)^{1/I}$. */
  readonly perLookAlpha: number
  /** Critical value: the largest (|)z(|) must exceed this. */
  readonly z: number
  /** Bonferroni critical value (per-look level α/I), slightly larger. */
  readonly bonferroniZ: number
}

/** Options for {@link optionalStoppingRisk}. */
export interface OptionalStoppingOptions {
  /** Chance hit probability per trial, in (0, 1). */
  readonly p0: number
  /** Nominal one-sided level applied at every look. Default 0.05. */
  readonly alpha?: number
}

/** Actual false-positive rate of an exact one-sided binomial test repeated at several looks. */
export interface OptionalStoppingRisk {
  readonly looks: readonly number[]
  readonly p0: number
  readonly alpha: number
  /** Smallest hit count rejecting at each look, or `null` if no count can. */
  readonly criticalHits: readonly (number | null)[]
  /** Exact size $P(X_n \ge c_n)$ of each single look (≤ α, discreteness makes it smaller). */
  readonly lookSizes: readonly number[]
  /** $P(\text{some look rejects})$ under $H_0$, exact. */
  readonly risk: number
}

// 20-point Gauss–Legendre nodes/weights on [−1, 1], computed once by Newton on P_20
const GL_ORDER = 20
let glNodes: Float64Array | undefined
let glWeights: Float64Array | undefined

function gaussLegendre(): [Float64Array, Float64Array] {
  if (glNodes !== undefined && glWeights !== undefined) return [glNodes, glWeights]
  const nodes = new Float64Array(GL_ORDER)
  const weights = new Float64Array(GL_ORDER)
  for (let i = 0; i < GL_ORDER; i++) {
    let x = Math.cos((Math.PI * (i + 0.75)) / (GL_ORDER + 0.5))
    let derivative = 0
    for (let iter = 0; iter < 100; iter++) {
      let p0 = 1
      let p1 = x
      for (let j = 2; j <= GL_ORDER; j++) {
        const p2 = ((2 * j - 1) * x * p1 - (j - 1) * p0) / j
        p0 = p1
        p1 = p2
      }
      derivative = (GL_ORDER * (x * p1 - p0)) / (x * x - 1)
      const step = p1 / derivative
      x -= step
      if (Math.abs(step) < 1e-16) break
    }
    nodes[i] = x
    weights[i] = 2 / ((1 - x * x) * derivative * derivative)
  }
  glNodes = nodes
  glWeights = weights
  return [nodes, weights]
}

function integrate(f: (x: number) => number, a: number, b: number, width: number): number {
  const [nodes, weights] = gaussLegendre()
  const pieces = Math.max(1, Math.ceil((b - a) / width))
  const h = (b - a) / pieces
  let total = 0
  for (let piece = 0; piece < pieces; piece++) {
    const mid = a + (piece + 0.5) * h
    let sum = 0
    for (let i = 0; i < GL_ORDER; i++)
      sum += (weights[i] as number) * f(mid + 0.5 * h * (nodes[i] as number))
    total += 0.5 * h * sum
  }
  return total
}

/**
 * Expected value of the largest of $I$ independent standard normal
 * statistics — the score chance alone gives the best of I analyses, windows
 * or subjects:
 * $$E_I = \int_{-\infty}^{\infty} x\, I\varphi(x)\Phi(x)^{I-1}\,dx
 *       = \int_0^\infty \bigl(1 - \Phi(x)^I\bigr)dx - \int_{-\infty}^0 \Phi(x)^I dx,$$
 * evaluated in the second (density-free) form with 20-point Gauss–Legendre
 * panels of width ¼, $1-\Phi^I$ as $-\mathrm{expm1}(I\,\mathrm{log1p}(-\bar\Phi))$.
 * Closed forms check it: $E_2 = 1/\sqrt\pi$, $E_3 = 3/(2\sqrt\pi)$. Also
 * returns the approximation used for the deflated Sharpe ratio (Bailey &
 * López de Prado 2014; López de Prado 2018, which errs by ~2 % at I = 10)
 * and the bound $\sqrt{2\ln I}$.
 *
 * @throws {JudgingError} `invalid_input` for `looks` not a safe integer ≥ 1.
 */
export function expectedMaxOfLooks(looks: number): ExpectedMaxOfLooks {
  const I = integerAtLeast('looks', looks, 1)
  if (I === 1) return Object.freeze({ looks: 1, exact: 0, approximation: null, upperBound: 0 })
  const upper = normIsf(Math.min(0.25, 1e-22 / I)) + 1
  const positive = integrate((x) => -Math.expm1(I * Math.log1p(-normSf(x))), 0, upper, 0.25)
  const negative = integrate((x) => Math.exp(I * Math.log(normSf(-x))), -10, 0, 0.25)
  return Object.freeze({
    looks: I,
    exact: positive - negative,
    approximation: (1 - EULER_GAMMA) * normIsf(1 / I) + EULER_GAMMA * normIsf(1 / (I * Math.E)),
    upperBound: Math.sqrt(2 * Math.log(I)),
  })
}

/**
 * Expected maximum of `looks` independent draws from a discrete distribution
 * on $x_0 + \{0, 1, \dots\}$ — e.g. the best of three displacement scores of a
 * Zener run under the exact closed-deck pmf, $6.740$ instead of 5 (Epstein):
 * $$E[\max] = x_0 + \sum_{i \ge 1}\bigl(1 - F(x_0 + i - 1)^{k}\bigr),$$
 * with the upper tails summed from the top so tiny tails keep precision.
 * (Displacement scores of one run are not truly independent; the value is the
 * independent-looks baseline Epstein uses.)
 *
 * @param pmf probabilities of $x_0, x_0 + 1, \dots$ (non-negative, summing to 1 within 1e-9)
 * @param looks number of independent looks k ≥ 1
 * @param offset the value $x_0$ of `pmf[0]`. Default 0.
 * @throws {JudgingError} `invalid_input` for a malformed pmf or `looks`.
 */
export function expectedMaxOfPmf(pmf: ArrayLike<number>, looks: number, offset = 0): number {
  const k = integerAtLeast('looks', looks, 1)
  const probabilities = numberArray('pmf', pmf)
  if (typeof offset !== 'number' || !Number.isFinite(offset)) {
    invalidInput('offset', `offset must be a finite number, got ${String(offset)}`)
  }
  let total = 0
  for (const [i, p] of probabilities.entries()) {
    if (p < 0) invalidInput(`pmf[${i}]`, `pmf[${i}] must be ≥ 0, got ${p}`)
    total += p
  }
  if (Math.abs(total - 1) > 1e-9) invalidInput('pmf', `pmf must sum to 1, got ${total}`)
  // tail[i] = P(X ≥ x0 + i), summed from the top
  let tail = 0
  let expectation = 0
  for (let i = probabilities.length - 1; i >= 1; i--) {
    tail += probabilities[i] as number
    const upper = Math.min(1, tail)
    expectation += -Math.expm1(k * Math.log1p(-upper))
  }
  return offset + expectation
}

function looksOptions(options: LooksOptions | undefined): { alpha: number; sided: 'one' | 'two' } {
  const opts = optionsObject(options)
  const alpha = opts.alpha === undefined ? 0.05 : openUnit('alpha', opts.alpha)
  const sided = oneOf('sided', opts.sided ?? 'one', ['one', 'two'] as const)
  return { alpha, sided }
}

/**
 * The critical value the best of $I$ independent z-statistics must exceed to
 * keep the family-wise error at α (Šidák 1967): per-look level
 * $\alpha_1 = 1 - (1-\alpha)^{1/I}$, $z = \Phi^{-1}(1-\alpha_1)$ one-sided or
 * $\Phi^{-1}(1-\alpha_1/2)$ two-sided. Exact under independence and
 * conservative for positively dependent looks (overlapping windows, adjacent
 * displacements). Computed as $-\mathrm{expm1}(\mathrm{log1p}(-\alpha)/I)$ so
 * $I = 10^9$ keeps precision. Bonferroni's value is returned for comparison.
 *
 * @throws {JudgingError} `invalid_input` for `looks` < 1; `invalid_options`
 *   for α outside (0, 1) or an unknown `sided`.
 */
export function deflatedCriticalValue(
  looks: number,
  options?: LooksOptions,
): DeflatedCriticalValue {
  const I = integerAtLeast('looks', looks, 1)
  const { alpha, sided } = looksOptions(options)
  const perLookAlpha = -Math.expm1(Math.log1p(-alpha) / I)
  const divisor = sided === 'two' ? 2 : 1
  return Object.freeze({
    looks: I,
    alpha,
    sided,
    perLookAlpha,
    z: normIsf(perLookAlpha / divisor),
    bonferroniZ: normIsf(alpha / I / divisor),
  })
}

/**
 * Family-wise p-value of the best of $I$ independent z looks:
 * $p = 1 - (1 - p_1)^I$ with $p_1$ the single-look p of `z`
 * ($1-\Phi(z)$ one-sided, $2(1-\Phi(|z|))$ two-sided), computed as
 * $-\mathrm{expm1}(I\,\mathrm{log1p}(-p_1))$.
 *
 * @throws {JudgingError} `invalid_input` for a non-finite z or `looks` < 1;
 *   `invalid_options` for an unknown `sided`.
 */
export function maxOfLooksPValue(
  z: number,
  looks: number,
  options?: Pick<LooksOptions, 'sided'>,
): number {
  if (typeof z !== 'number' || Number.isNaN(z))
    invalidInput('z', `z must be a number, got ${String(z)}`)
  const I = integerAtLeast('looks', looks, 1)
  const { sided } = looksOptions({ sided: optionsObject(options).sided })
  const single = sided === 'two' ? Math.min(1, 2 * normSf(Math.abs(z))) : normSf(z)
  return Math.min(1, -Math.expm1(I * Math.log1p(-single)))
}

/** Smallest c with P(X ≥ c) ≤ α for X ~ Binomial(n, p), or null. */
function criticalCount(n: number, p: number, alpha: number): number | null {
  if (binomialPmf(n, n, p) > alpha) return null // even n hits of n cannot reject
  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2)
    const size = mid === 0 ? 1 : binomialSf(mid - 1, n, p)
    if (size <= alpha) hi = mid
    else lo = mid + 1
  }
  return lo
}

/**
 * Exact probability that a one-sided exact binomial test at level α rejects
 * $H_0: p = p_0$ at *at least one* of the given looks, when the same trials
 * accumulate between looks — the price of peeking. A dynamic program over the
 * hit count carries the probability of paths not yet rejected, trial by
 * trial, and removes the mass at or above each look's critical count
 * (probabilities of positive terms only, so the result is accurate to
 * ~1e-14). With one look it equals that look's exact size.
 *
 * Checking a ganzfeld series (p0 = ¼) after every session from 10 to 200
 * rejects a true null far more often than 5 %; that inflation grows without
 * bound as looks continue (law of the iterated logarithm).
 *
 * @param looks strictly increasing trial counts at which the test is applied
 * @throws {JudgingError} `invalid_input` for empty, non-integer or
 *   non-increasing looks; `invalid_options` for `p0` or α outside (0, 1);
 *   `too_large` beyond {@link MAX_OPTIONAL_STOPPING_WORK}.
 */
export function optionalStoppingRisk(
  looks: readonly number[],
  options: OptionalStoppingOptions,
): OptionalStoppingRisk {
  const list = numberArray('looks', looks)
  list.forEach((n, i) => {
    integerAtLeast(`looks[${i}]`, n, 1)
    if (i > 0 && n <= (list[i - 1] as number)) {
      invalidInput(`looks[${i}]`, 'looks must be strictly increasing')
    }
  })
  const opts = optionsObject(options)
  const p0 = openUnit('p0', opts.p0)
  const alpha = opts.alpha === undefined ? 0.05 : openUnit('alpha', opts.alpha)
  const last = list[list.length - 1] as number
  const work = (last * (last + 1)) / 2
  if (work > MAX_OPTIONAL_STOPPING_WORK) {
    tooLarge('looks', `optional-stopping DP work ${work} exceeds ${MAX_OPTIONAL_STOPPING_WORK}`)
  }
  const criticalHits = list.map((n) => criticalCount(n, p0, alpha))
  const lookSizes = list.map((n, i) => {
    const c = criticalHits[i]
    return c === null || c === undefined ? 0 : c === 0 ? 1 : binomialSf(c - 1, n, p0)
  })
  const q0 = 1 - p0
  const dist = new Float64Array(last + 1)
  dist[0] = 1
  let trials = 0
  let risk = 0
  list.forEach((n, i) => {
    for (; trials < n; trials++) {
      for (let h = trials + 1; h >= 1; h--) {
        dist[h] = (dist[h] as number) * q0 + (dist[h - 1] as number) * p0
      }
      dist[0] = (dist[0] as number) * q0
    }
    const c = criticalHits[i]
    if (c === null || c === undefined) return
    for (let h = c; h <= n; h++) {
      risk += dist[h] as number
      dist[h] = 0
    }
  })
  return Object.freeze({
    looks: Object.freeze(list),
    p0,
    alpha,
    criticalHits: Object.freeze(criticalHits),
    lookSizes: Object.freeze(lookSizes),
    risk: Math.min(1, risk),
  })
}
