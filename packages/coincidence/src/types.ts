/** A coincidence probability and its complement, each computed to its own precision. */
export interface MatchProbabilities {
  /** Probability that the coincidence happens (at least one match). */
  readonly match: number
  /** Probability that it does not (no match). */
  readonly noMatch: number
}

/**
 * How {@link noMatchNonUniform} computed its answer.
 *
 * - `exact` — the elementary-symmetric-polynomial recursion (both tails exact
 *   up to floating-point rounding);
 * - `poisson` — $\exp(-\binom n2 S_2)$ with $S_2 = \sum p_i^2$;
 * - `second-order` — the log expansion through second order in the power sums,
 *   $\ln P \approx -\binom n2 S_2 + 2\binom n3 S_3 - \tfrac{n(n-1)(2n-3)}{4} S_2^2$.
 */
export type NonUniformMethod = 'exact' | 'poisson' | 'second-order'

export interface NonUniformOptions {
  /**
   * `'auto'` (default) is exact while $n \cdot$ (number of categories with
   * $p > 0$) $\le$ {@link NONUNIFORM_EXACT_LIMIT}, else `'second-order'`.
   * `'exact'` throws `too_large` beyond the limit.
   */
  readonly method?: 'auto' | NonUniformMethod
}

export interface NonUniformResult extends MatchProbabilities {
  readonly method: NonUniformMethod
}

/**
 * How a k-fold match probability was computed — both are exact up to rounding.
 *
 * - `dp` — conditional-binomial dynamic programme over the categories; `match`
 *   and `noMatch` each carry full relative precision;
 * - `levin` — Levin's (1981) truncated-Poisson representation, used when it is
 *   much cheaper (huge category counts); `noMatch` has relative error of about
 *   $c \cdot 10^{-16}$ for c equal categories (1e-10 at $c = 10^6$) and
 *   `match = 1 − noMatch` carries the same absolute error, so a tiny `match`
 *   loses relative precision.
 */
export type KWayMethod = 'dp' | 'levin'

export interface KWayResult extends MatchProbabilities {
  readonly method: KWayMethod
}

/** Circle: day 1 neighbours day c (calendar dates). Line: no wrap-around (an interval). */
export type NearTopology = 'circle' | 'line'

export interface NearMatchOptions {
  /** Default `'circle'`, as in Abramson & Moser (1970). */
  readonly topology?: NearTopology
}

export interface MultiCategoryOptions {
  /** Target probability of at least one match; default ½. */
  readonly p?: number
}

/** Diaconis–Mosteller summary for several independent attributes. */
export interface MultiCategorySummary {
  readonly categories: readonly number[]
  /** $H = k / \sum_i 1/c_i$. */
  readonly harmonicMean: number
  /** $1 / \sum_i 1/c_i = H/k$ — one attribute with this many values behaves alike to leading order. */
  readonly effectiveCategories: number
  /** The target probability the two people counts refer to. */
  readonly p: number
  /** $\sqrt{2\,(H/k)\ln(1/(1-p))}$: Diaconis & Mosteller's $1.2\sqrt{H/k}$ at $p = ½$. */
  readonly peopleApprox: number
  /** Smallest n with exact P(match in at least one attribute) ≥ p. */
  readonly peopleExact: number
}

/** One grade of agreement for one attribute, with its null probability. */
export interface FisherGrade {
  readonly label: string
  readonly probability: number
}

/** An attribute scored Fisher-style: grades ordered from worst (no agreement) to best. */
export interface FisherAttribute {
  readonly name: string
  readonly grades: readonly FisherGrade[]
}

/** A validated Fisher scoring scheme with its exact null moments. */
export interface FisherScheme {
  readonly attributes: readonly FisherAttribute[]
  /** `scores[a][g]` = $-\log_{10} P(\text{grade} \ge g)$ for attribute a. */
  readonly scores: readonly (readonly number[])[]
  /** Null mean of the raw score (sum over attributes). */
  readonly mean: number
  /** Null standard deviation of the raw score. */
  readonly sd: number
}

/** One observed grade per attribute, by label or by index (0 = worst), in attribute order. */
export type FisherObservation = readonly (string | number)[]

export interface FisherMatchScore {
  /** Grade index per attribute. */
  readonly grades: readonly number[]
  /** $\sum_a -\log_{10} P_a(\text{grade} \ge g_a)$. */
  readonly raw: number
  /** Fisher's standardized score $10\,(\text{raw} - \mu)/\sigma$ (null mean 0, SD 10). */
  readonly score: number
  /** $\prod_a P_a(\text{grade} \ge g_a) = 10^{-\text{raw}}$. */
  readonly tailProbability: number
}

export interface FisherSeriesResult {
  readonly n: number
  /** Sum of standardized scores. */
  readonly total: number
  readonly meanScore: number
  /** $10/\sqrt n$. */
  readonly standardError: number
  /** meanScore / standardError. */
  readonly z: number
  /** Fisher's (1924) criterion: meanScore > 2 · standardError. */
  readonly exceedsTwoStandardErrors: boolean
}

export type CardSuit = 'spades' | 'hearts' | 'diamonds' | 'clubs'

/** A playing card; rank 1 = ace, 2–10 spot cards, 11 = jack, 12 = queen, 13 = king. */
export interface PlayingCard {
  readonly suit: CardSuit
  readonly rank: number
}

/** Observation span of an event series: `[start, end]`, or `[0, span]` for a number. */
export type SeriesSpan = number | { readonly start: number; readonly end: number }

export interface SeriesClusteringOptions {
  /** Window width, in the same unit as the timestamps. Windows tile the span from its start. */
  readonly window: number
  readonly span: SeriesSpan
  /**
   * Pre-specified event rate (events per time unit). When given, window
   * counts are independent Poisson(rate · length) — an unconditional null
   * that also tests the total. When omitted, the null conditions on the
   * observed number of events (uniform event times; multinomial counts).
   */
  readonly rate?: number
}

/** Pearson dispersion of the window counts with its exact null moments. */
export interface DispersionSummary {
  /** $X^2 = \sum_i (x_i - e_i)^2 / e_i$ (the index of dispersion for equal windows). */
  readonly statistic: number
  /** Exact null mean: windows − 1 (conditional) or windows (Poisson rate). */
  readonly mean: number
  /** Exact null variance (Haldane 1937 for the multinomial; $\sum (2 + 1/e_i)$ for Poisson). */
  readonly variance: number
  /** (statistic − mean) / √variance, or `null` when the variance is 0. No p-value is claimed. */
  readonly z: number | null
}

export interface SeriesClusteringResult {
  readonly n: number
  readonly start: number
  readonly end: number
  readonly window: number
  /** Number of windows; the last one may be shorter than `window`. */
  readonly windows: number
  readonly counts: readonly number[]
  /** Null expectation per window. */
  readonly expected: readonly number[]
  readonly null: 'conditional' | 'poisson'
  /** Largest window count — the scan statistic on this grid. */
  readonly maxCount: number
  /** Index of the first window holding `maxCount`. */
  readonly maxWindow: number
  readonly maxWindowStart: number
  /** Exact P(some window count ≥ maxCount) under the null. */
  readonly pValue: number
  /** How `pValue` was computed. */
  readonly method: KWayMethod | 'poisson-product'
  /** `null` when there are no events under the conditional null. */
  readonly dispersion: DispersionSummary | null
}
