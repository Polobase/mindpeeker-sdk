/**
 * Closed decks: the exact null distribution of matches when the target pack is
 * a shuffled multiset (5 × 5 Zener cards) rather than independent draws.
 *
 * Every number is computed in exact integer arithmetic first. The count of
 * target orders with exactly k matches uses the rook polynomial of the
 * "match board" and inclusion–exclusion (Riordan 1958, ch. 7–8), which is an
 * alternating sum — harmless in bigints, fatal in floats. The float `pmf` is
 * derived from those integers at the end.
 */
import { factorial, ratioToNumber } from './internal/numerics.js'
import {
  integerAtLeast,
  invalidInput,
  optionInteger,
  optionsObject,
  tooLarge,
} from './internal/validate.js'

/** Largest deck (total cards) {@link closedDeckMatchDistribution} accepts. */
export const MAX_CLOSED_DECK_CARDS = 512

/** Largest `runs × cards` {@link closedDeckTest} convolves. */
export const MAX_CLOSED_DECK_RUN_CARDS = 20_000

/** Exact null distribution of matches for one closed-deck run. */
export interface ClosedDeckDistribution {
  /** Target pack composition: copies of each symbol. */
  readonly symbolCounts: readonly number[]
  /** Call composition over the same symbols (defaults to `symbolCounts`). */
  readonly callCounts: readonly number[]
  /** Cards per run, $N = \sum_s t_s$. */
  readonly cards: number
  /** Distinct target orders, $N!/\prod_s t_s!$ (all equally likely under $H_0$). */
  readonly arrangements: bigint
  /** `counts[k]` = distinct target orders giving exactly k matches, k = 0…N. */
  readonly counts: readonly bigint[]
  /** `pmf[k] = counts[k] / arrangements`. */
  readonly pmf: Float64Array
  /** Exact mean $\sum_s c_s t_s / N$. */
  readonly mean: number
  /** Exact variance (from the integer counts). */
  readonly variance: number
  readonly sd: number
  /**
   * Variance if every call were scored against an independent draw with the
   * pack's symbol frequencies (an "open deck"): $\sum_s c_s \frac{t_s}{N}(1 - \frac{t_s}{N})$.
   * For the Zener pack this is the binomial 4; the exact closed-deck value is 25/6.
   */
  readonly openDeckVariance: number
}

/** Options for {@link closedDeckTest}. */
export interface ClosedDeckTestOptions {
  /** Call composition (default: same as the pack, i.e. balanced calls). */
  readonly callCounts?: readonly number[]
  /** Independent runs (reshuffled packs) the total `hits` is summed over. Default 1. */
  readonly runs?: number
}

/** Exact closed-deck test of a total hit count. */
export interface ClosedDeckTest {
  readonly hits: number
  readonly runs: number
  /** Cards per run. */
  readonly cards: number
  /** Chance expectation over all runs. */
  readonly mean: number
  /** Exact SD over all runs, $\sqrt{R}\,\sigma_{run}$. */
  readonly sd: number
  /** `(hits − mean) / sd` with the exact closed-deck SD. */
  readonly criticalRatio: number
  /** The same ratio with the open-deck (binomial-style) SD — Epstein's 2 % inflation for Zener packs. */
  readonly openDeckCriticalRatio: number
  /** Exact $P(\text{total} \ge \text{hits})$. */
  readonly pOneSided: number
  /** Exact $P(\text{total} \le \text{hits})$. */
  readonly pLower: number
  /** The run-level distribution the test is built on. */
  readonly distribution: ClosedDeckDistribution
}

function composition(argument: string, value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    invalidInput(argument, `${argument} must be a non-empty array of symbol counts`)
  }
  return (value as unknown[]).map((c, i) => integerAtLeast(`${argument}[${i}]`, c, 0))
}

/**
 * Exact distribution of the number of matches between a fixed call sequence
 * with composition $c$ and a uniformly shuffled target pack with composition
 * $t$ (same symbols, same total $N$). Only the compositions matter.
 *
 * With cards labelled, position–card "match cells" form one complete
 * $c_s \times t_s$ block per symbol, whose rook numbers are
 * $r^{(s)}_j = \binom{c_s}{j}\binom{t_s}{j} j!$. The board's rook polynomial
 * is the product $R(x) = \prod_s \sum_j r^{(s)}_j x^j$, and the number of
 * labelled permutations with exactly $k$ matches is
 * $$L_k = \sum_{j \ge k} (-1)^{j-k}\binom{j}{k}\, r_j\, (N-j)!.$$
 * Dividing by $\prod_s t_s!$ gives distinct target orders. For the 25-card
 * Zener pack with balanced calls this reproduces Epstein's Table 11-1
 * (623 360 743 125 120 orders; $P(0) = 4.286\times10^{-3}$, $P(24) = 0$,
 * $P(25) = 1.604\times10^{-15}$; SD 2.0412 against the binomial 2.000).
 *
 * @param symbolCounts copies of each symbol in the target pack
 * @param callCounts copies of each symbol among the calls; default
 *   `symbolCounts`. A symbol never called has count 0.
 * @throws {JudgingError} `invalid_input` for non-integer or negative counts,
 *   mismatched lengths or totals, or an empty pack; `too_large` above
 *   {@link MAX_CLOSED_DECK_CARDS} cards.
 */
export function closedDeckMatchDistribution(
  symbolCounts: readonly number[],
  callCounts?: readonly number[],
): ClosedDeckDistribution {
  const t = composition('symbolCounts', symbolCounts)
  const c = callCounts === undefined ? t.slice() : composition('callCounts', callCounts)
  if (c.length !== t.length) {
    invalidInput(
      'callCounts',
      `callCounts needs ${t.length} entries (one per symbol), got ${c.length}`,
    )
  }
  const cards = t.reduce((sum, x) => sum + x, 0)
  const calls = c.reduce((sum, x) => sum + x, 0)
  if (cards === 0) invalidInput('symbolCounts', 'the pack must hold at least one card')
  if (calls !== cards) {
    invalidInput('callCounts', `calls (${calls}) and cards (${cards}) must have the same total`)
  }
  if (cards > MAX_CLOSED_DECK_CARDS) {
    tooLarge(
      'symbolCounts',
      `closed-deck enumeration is limited to ${MAX_CLOSED_DECK_CARDS} cards, got ${cards}`,
    )
  }
  // rook polynomial of the match board
  let rook: bigint[] = [1n]
  t.forEach((ts, s) => {
    const cs = c[s] as number
    const degree = Math.min(cs, ts)
    const block = new Array<bigint>(degree + 1)
    for (let j = 0; j <= degree; j++) {
      block[j] =
        (factorial(cs) * factorial(ts)) / (factorial(cs - j) * factorial(ts - j) * factorial(j))
    }
    const next = new Array<bigint>(rook.length + degree).fill(0n)
    rook.forEach((r, i) => {
      if (r === 0n) return
      block.forEach((b, j) => {
        next[i + j] = (next[i + j] as bigint) + r * b
      })
    })
    rook = next
  })
  const maxMatches = rook.length - 1
  const divisor = t.reduce((prod, ts) => prod * factorial(ts), 1n)
  const arrangements = factorial(cards) / divisor
  const countsOut = new Array<bigint>(cards + 1).fill(0n)
  // inclusion–exclusion with binomial(j, k) built incrementally per k
  for (let k = 0; k <= maxMatches; k++) {
    let sum = 0n
    let choose = 1n // C(j, k) at j = k
    for (let j = k; j <= maxMatches; j++) {
      if (j > k) choose = (choose * BigInt(j)) / BigInt(j - k)
      const term = choose * (rook[j] as bigint) * factorial(cards - j)
      sum = (j - k) % 2 === 0 ? sum + term : sum - term
    }
    countsOut[k] = sum / divisor
  }
  let first = 0n
  let second = 0n
  const pmf = new Float64Array(cards + 1)
  countsOut.forEach((count, k) => {
    first += BigInt(k) * count
    second += BigInt(k * k) * count
    pmf[k] = ratioToNumber(count, arrangements)
  })
  const mean = ratioToNumber(first, arrangements)
  const varianceNumerator = second * arrangements - first * first
  const variance = ratioToNumber(varianceNumerator, arrangements * arrangements)
  let openDeckVariance = 0
  t.forEach((ts, s) => {
    const f = ts / cards
    openDeckVariance += (c[s] as number) * f * (1 - f)
  })
  return Object.freeze({
    symbolCounts: Object.freeze(t),
    callCounts: Object.freeze(c),
    cards,
    arrangements,
    counts: Object.freeze(countsOut),
    pmf,
    mean,
    variance,
    sd: Math.sqrt(variance),
    openDeckVariance,
  })
}

/** Distribution of the sum of `runs` independent copies of a pmf (positive-term convolution). */
function convolvePower(pmf: Float64Array, runs: number): Float64Array {
  let out = pmf
  for (let r = 1; r < runs; r++) {
    const next = new Float64Array(out.length + pmf.length - 1)
    for (let i = 0; i < out.length; i++) {
      const a = out[i] as number
      if (a === 0) continue
      for (let j = 0; j < pmf.length; j++)
        next[i + j] = (next[i + j] as number) + a * (pmf[j] as number)
    }
    out = next
  }
  return out
}

/**
 * Exact test of a closed-deck hit total: `hits` summed over `runs` separately
 * shuffled packs, each scored against calls with composition `callCounts`.
 * For one run the tails are exact rationals; for several runs the run pmf is
 * convolved (sums of positive terms only, so tails keep relative precision).
 *
 * The comparison `openDeckCriticalRatio` shows the classic error of treating
 * a closed Zener pack as Binomial(25, 1/5): the SD is understated (2.000 vs
 * 2.0412), inflating critical ratios by about 2 % in favour of ESP
 * (Epstein 2009, ch. 11). The exact null also requires that calls are
 * made without trial-by-trial feedback; with feedback see
 * `readFeedbackExpectation`.
 *
 * @throws {JudgingError} as {@link closedDeckMatchDistribution};
 *   `invalid_input` for `hits` outside `[0, runs × cards]`;
 *   `invalid_options` for `runs` not an integer ≥ 1; `too_large` above
 *   {@link MAX_CLOSED_DECK_RUN_CARDS} total cards.
 */
export function closedDeckTest(
  hits: number,
  symbolCounts: readonly number[],
  options?: ClosedDeckTestOptions,
): ClosedDeckTest {
  const opts = optionsObject(options)
  const runs = opts.runs === undefined ? 1 : optionInteger('runs', opts.runs, 1)
  const distribution = closedDeckMatchDistribution(symbolCounts, opts.callCounts)
  const total = runs * distribution.cards
  if (total > MAX_CLOSED_DECK_RUN_CARDS) {
    tooLarge('runs', `runs × cards is limited to ${MAX_CLOSED_DECK_RUN_CARDS}, got ${total}`)
  }
  if (typeof hits !== 'number' || !Number.isInteger(hits) || hits < 0 || hits > total) {
    invalidInput('hits', `hits must be an integer in [0, ${total}], got ${String(hits)}`)
  }
  let pOneSided: number
  let pLower: number
  if (runs === 1) {
    let upper = 0n
    let lower = 0n
    distribution.counts.forEach((count, k) => {
      if (k >= hits) upper += count
      if (k <= hits) lower += count
    })
    pOneSided = ratioToNumber(upper, distribution.arrangements)
    pLower = ratioToNumber(lower, distribution.arrangements)
  } else {
    const pmf = convolvePower(distribution.pmf, runs)
    let upper = 0
    for (let k = pmf.length - 1; k >= hits; k--) upper += pmf[k] as number
    let lower = 0
    for (let k = 0; k <= hits; k++) lower += pmf[k] as number
    pOneSided = Math.min(1, upper)
    pLower = Math.min(1, lower)
  }
  const mean = runs * distribution.mean
  const sd = Math.sqrt(runs * distribution.variance)
  return Object.freeze({
    hits,
    runs,
    cards: distribution.cards,
    mean,
    sd,
    criticalRatio: (hits - mean) / sd,
    openDeckCriticalRatio: (hits - mean) / Math.sqrt(runs * distribution.openDeckVariance),
    pOneSided,
    pLower,
    distribution,
  })
}

/**
 * Probability that $N$ independent uniform draws over $K$ symbols produce
 * exactly the composition `counts`: the multinomial
 * $\frac{N!}{\prod_s n_s!}\,K^{-N}$, exact. For the Zener composition (five of
 * each of five symbols) it is 0.0020917 (Epstein): an "IID deck" almost never
 * matches a real pack, so the two nulls are genuinely different designs.
 *
 * @throws {JudgingError} `invalid_input` for non-integer or negative counts or
 *   an empty composition; `too_large` above {@link MAX_CLOSED_DECK_CARDS} draws.
 */
export function compositionProbability(counts: readonly number[]): number {
  const n = composition('counts', counts)
  const total = n.reduce((sum, x) => sum + x, 0)
  if (total > MAX_CLOSED_DECK_CARDS) {
    tooLarge(
      'counts',
      `compositionProbability is limited to ${MAX_CLOSED_DECK_CARDS} draws, got ${total}`,
    )
  }
  const ways = factorial(total) / n.reduce((prod, x) => prod * factorial(x), 1n)
  return ratioToNumber(ways, BigInt(n.length) ** BigInt(total))
}
