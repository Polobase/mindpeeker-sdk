/**
 * Shared public types of `@mindpeeker/judging`. Result shapes that belong to
 * one scorer live next to that scorer and are re-exported from the index.
 */
export type { Seed } from './internal/prng.js'

/**
 * Direction of the alternative hypothesis relative to chance:
 * - `'greater'` — above-chance hitting (psi-hitting in the literature's terms)
 * - `'less'` — below-chance hitting (psi-missing)
 * - `'two-sided'` — either direction
 */
export type Alternative = 'two-sided' | 'greater' | 'less'

/** A two-sided confidence interval for a proportion. */
export interface ConfidenceInterval {
  /** Lower bound in [0, 1]. */
  readonly lower: number
  /** Upper bound in [0, 1]. */
  readonly upper: number
  /** Nominal coverage, e.g. 0.95. */
  readonly confidence: number
}

/** Beta prior on the hit probability under $H_1$ (default Beta(1, 1), uniform). */
export interface BetaPrior {
  /** Shape $a > 0$. Default 1. */
  readonly a?: number
  /** Shape $b > 0$. Default 1. */
  readonly b?: number
}

/**
 * A classical fixed-length run convention (Rhine & Pratt 1957): how many
 * trials make one run and the chance probability of a hit per trial.
 */
export interface RunConvention {
  /** Short identifier, e.g. `'esp'` or `'pk'`. */
  readonly name: string
  /** Trials in one run (25 cards, 24 die throws). */
  readonly trialsPerRun: number
  /** Number of equiprobable alternatives per trial. */
  readonly choices: number
  /** Chance hit probability per trial, $1/\text{choices}$. */
  readonly p0: number
}
