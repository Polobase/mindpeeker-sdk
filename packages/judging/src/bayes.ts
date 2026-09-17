/**
 * Beta-binomial Bayes factors for forced-choice hit counts against the design's
 * chance rate. The same formula as `@mindpeeker/psi`'s `binomialLogBayesFactor`
 * (implemented here from negentropy's numerics so judging does not depend on
 * psi); the fixture values come from an independent mpmath computation.
 */
import { betaInc, lnBeta, lnBetaPrefactor } from './internal/numerics.js'
import {
  invalidInput,
  invalidOptions,
  oneOf,
  openUnit,
  optionInteger,
  optionsObject,
} from './internal/validate.js'
import type { Alternative, BetaPrior } from './types.js'

/** Options for {@link forcedChoiceBayesFactor}: give exactly one of `p0` or `choices`. */
export interface ForcedChoiceBayesOptions {
  /** Chance hit probability under $H_0$, in (0, 1). */
  readonly p0?: number
  /** Equiprobable alternatives per trial; sets $p_0 = 1/\text{choices}$. */
  readonly choices?: number
  /** Beta prior on the hit probability under $H_1$. Default Beta(1, 1). */
  readonly prior?: BetaPrior
  /**
   * Direction of $H_1$. `'greater'` truncates the prior to $(p_0, 1)$,
   * `'less'` to $(0, p_0)$. Default `'two-sided'` (psi's default).
   */
  readonly alternative?: Alternative
}

/** A forced-choice Bayes factor, in log space first. */
export interface ForcedChoiceBayesFactor {
  readonly hits: number
  readonly trials: number
  readonly p0: number
  readonly a: number
  readonly b: number
  readonly alternative: Alternative
  /**
   * $\ln BF_{10}$. Finite for two-sided tests; a one-sided test can give
   * `-Infinity` when the posterior mass on the tested side underflows
   * (hits far out on the opposite side of chance).
   */
  readonly lnBf10: number
  /** $BF_{10} = e^{\ln BF_{10}}$; may overflow to `Infinity` or underflow to 0. */
  readonly bf10: number
  /** $BF_{01} = 1/BF_{10}$. */
  readonly bf01: number
}

const ALTERNATIVES: readonly Alternative[] = ['two-sided', 'greater', 'less']

/** Beta(a, b) mass above (`greater`) or below (`less`) p0. */
function sideMass(a: number, b: number, p0: number, alternative: 'greater' | 'less'): number {
  return alternative === 'greater' ? betaInc(b, a, 1 - p0) : betaInc(a, b, p0)
}

/**
 * Bayes factor for $k$ hits in $n$ trials, testing
 * $H_1: p \sim \mathrm{Beta}(a, b)$ against the chance point null $H_0: p = p_0$:
 * $$BF_{10} = \frac{B(k+a,\; n-k+b)}{B(a,b)\; p_0^{\,k}(1-p_0)^{\,n-k}}.$$
 * A one-sided alternative truncates the prior to the tested side, multiplying
 * $BF_{10}$ by (posterior mass)/(prior mass) on that side, e.g. for
 * `'greater'` $\bigl(1 - I_{p_0}(k+a, n-k+b)\bigr)/\bigl(1 - I_{p_0}(a, b)\bigr)$.
 *
 * $\ln BF_{10}$ is formed as
 * $a\ln p_0 + b\ln(1-p_0) - \ln B(a,b) - \ln[p_0^{\alpha}(1-p_0)^{\beta}/B(\alpha,\beta)]$
 * with $\alpha = k+a$, $\beta = n-k+b$ and the last term expanded around the
 * posterior mean (Stirling), so no $O(n)$ terms cancel at $n = 10^6$.
 *
 * A Bayes factor with a fixed prior is a test martingale under $H_0$
 * (Shafer et al. 2011): monitoring it trial by trial and stopping at
 * $BF_{10} \ge 1/\alpha$ keeps the false-alarm rate below $\alpha$ — unlike
 * repeated p-values (see `optionalStoppingRisk`). The prior is part of the
 * pre-registration; a different prior is a different test.
 *
 * @example
 * // 122 hits in 354 ganzfeld sessions, p0 = 1/4, one-sided uniform prior
 * forcedChoiceBayesFactor(122, 354, { choices: 4, alternative: 'greater' }).bf10
 *
 * @throws {JudgingError} `invalid_input` for bad counts; `invalid_options` when
 *   neither or both of `p0`/`choices` are given, for non-positive or
 *   non-finite prior shapes, or an unknown alternative.
 */
export function forcedChoiceBayesFactor(
  hits: number,
  trials: number,
  options: ForcedChoiceBayesOptions,
): ForcedChoiceBayesFactor {
  if (typeof trials !== 'number' || !Number.isSafeInteger(trials) || trials < 0) {
    invalidInput('trials', `trials must be a safe integer ≥ 0, got ${String(trials)}`)
  }
  if (typeof hits !== 'number' || !Number.isInteger(hits) || hits < 0 || hits > trials) {
    invalidInput('hits', `hits must be an integer in [0, ${trials}], got ${String(hits)}`)
  }
  const opts = optionsObject(options)
  if ((opts.p0 === undefined) === (opts.choices === undefined)) {
    invalidOptions('p0', 'give exactly one of p0 or choices')
  }
  const p0 =
    opts.p0 !== undefined ? openUnit('p0', opts.p0) : 1 / optionInteger('choices', opts.choices, 2)
  const prior = optionsObject(opts.prior, 'prior')
  const a = prior.a ?? 1
  const b = prior.b ?? 1
  for (const [name, value] of [
    ['prior.a', a],
    ['prior.b', b],
  ] as const) {
    if (typeof value !== 'number' || !Number.isFinite(value) || !(value > 0)) {
      invalidOptions(name, `${name} must be a finite number > 0, got ${String(value)}`)
    }
  }
  const alternative = oneOf('alternative', opts.alternative ?? 'two-sided', ALTERNATIVES)
  let lnBf10 =
    a * Math.log(p0) +
    b * Math.log1p(-p0) -
    lnBeta(a, b) -
    lnBetaPrefactor(hits + a, trials - hits + b, p0)
  if (alternative !== 'two-sided') {
    const priorMass = sideMass(a, b, p0, alternative)
    if (!(priorMass > 0)) {
      invalidOptions(
        'prior',
        `the Beta(${a}, ${b}) prior puts no representable mass on the '${alternative}' side of p0 = ${p0}`,
      )
    }
    lnBf10 += Math.log(sideMass(hits + a, trials - hits + b, p0, alternative)) - Math.log(priorMass)
  }
  return Object.freeze({
    hits,
    trials,
    p0,
    a,
    b,
    alternative,
    lnBf10,
    bf10: Math.exp(lnBf10),
    bf01: Math.exp(-lnBf10),
  })
}
