/**
 * Rank scoring for free-response judging: a judge (or the receiver) ranks the
 * true target among `choices` candidates, 1 = best match. Under $H_0$ the
 * target's rank is uniform on $1…k$ because the target was drawn at random
 * from the judged set — not because the judge is unbiased.
 */
import { chi2Sf, normSf } from './internal/numerics.js'
import {
  integerAtLeast,
  invalidInput,
  numberMatrix,
  optionInteger,
  tooLarge,
} from './internal/validate.js'

/** Largest convolution work (≈ n²k²/4 float additions) {@link sumOfRanksDistribution} performs. */
export const MAX_SUM_OF_RANKS_WORK = 250_000_000

/** Exact null distribution of a sum of independent uniform ranks. */
export interface SumOfRanksDistribution {
  readonly trials: number
  readonly choices: number
  /** Smallest possible sum, `trials`. */
  readonly min: number
  /** Largest possible sum, `trials × choices`. */
  readonly max: number
  /** `pmf[i]` = P(sum = min + i). */
  readonly pmf: Float64Array
}

/** Rank-order scoring of a series of trials. */
export interface RankOrderScore {
  readonly trials: number
  readonly choices: number
  /** Trials whose target was ranked 1 (direct hits). */
  readonly hits: number
  readonly sumOfRanks: number
  readonly meanRank: number
  /** Chance mean rank $(k+1)/2$. */
  readonly expectedMeanRank: number
  /** SD of one uniform rank, $\sqrt{(k^2-1)/12}$. */
  readonly rankSd: number
  /** Utts' rank effect size $((k+1)/2 - \bar r)/\sqrt{(k^2-1)/12}$; positive = better than chance. */
  readonly effectSize: number
  /** Exact $P(S \le \text{sumOfRanks})$ — the one-sided p for better-than-chance ranks. */
  readonly pExact: number
  /** Exact $P(S \ge \text{sumOfRanks})$ — the one-sided p for worse-than-chance ranks. */
  readonly pExactUpper: number
  /** Normal z with continuity correction, $(\mu - S - \tfrac12)/\sigma$ (Solfvin, Kelly & Burdick 1978). */
  readonly z: number
  /** $1 - \Phi(z)$. */
  readonly pNormal: number
}

/** Consensus ranking across several judges of the same candidates. */
export interface ConsensusRank {
  readonly judges: number
  readonly candidates: number
  /** Rank sum per candidate across judges. */
  readonly sums: Float64Array
  /** Mean rank per candidate. */
  readonly meanRanks: Float64Array
  /** Consensus ranks of the sums (1 = best, ties get mid-ranks). */
  readonly consensus: Float64Array
  /**
   * Kendall's coefficient of concordance W with the tie correction (0 = no
   * agreement, 1 = identical rankings); 0 when every row is one full tie.
   */
  readonly kendallW: number
  /** Friedman statistic $m(k-1)W$. */
  readonly friedmanChi2: number
  /**
   * Large-sample $\chi^2_{k-1}$ p-value of the Friedman statistic. It is an
   * approximation: with few judges or candidates use a permutation test of
   * the rankings instead.
   */
  readonly friedmanP: number
}

/**
 * Exact distribution of $S = \sum_{i=1}^n R_i$ for independent ranks
 * $R_i \sim \mathrm{Uniform}\{1,\dots,k\}$ — the $n$-fold convolution of the
 * discrete uniform (Solfvin, Kelly & Burdick 1978). The distribution is
 * symmetric and log-concave, so only the lower half is convolved (sums of
 * positive terms, no subtraction: tail probabilities keep relative
 * precision) and mirrored. Probabilities below ~1e-308 underflow to 0.
 *
 * @throws {JudgingError} `invalid_input` for `trials` < 1;
 *   `invalid_options` for `choices` < 2; `too_large` beyond
 *   {@link MAX_SUM_OF_RANKS_WORK}.
 */
export function sumOfRanksDistribution(trials: number, choices: number): SumOfRanksDistribution {
  const n = integerAtLeast('trials', trials, 1)
  const k = optionInteger('choices', choices, 2)
  const work = (n * n * k * (k - 1)) / 4
  if (work > MAX_SUM_OF_RANKS_WORK) {
    tooLarge(
      'trials',
      `sum-of-ranks convolution work ${work.toExponential(2)} exceeds ${MAX_SUM_OF_RANKS_WORK}`,
    )
  }
  let dist = new Float64Array([1]) // sum of 0 ranks, offset 0
  const inv = 1 / k
  for (let step = 0; step < n; step++) {
    const len = dist.length
    const nextLen = len + k - 1
    const next = new Float64Array(nextLen)
    const half = Math.floor((nextLen - 1) / 2)
    for (let i = 0; i <= half; i++) {
      let acc = 0
      const from = Math.max(0, i - k + 1)
      const to = Math.min(i, len - 1)
      for (let j = from; j <= to; j++) acc += dist[j] as number
      next[i] = acc * inv
    }
    for (let i = half + 1; i < nextLen; i++) next[i] = next[nextLen - 1 - i] as number
    dist = next
  }
  return Object.freeze({ trials: n, choices: k, min: n, max: n * k, pmf: dist })
}

function rankList(ranks: readonly number[], k: number): number[] {
  if (!Array.isArray(ranks) || ranks.length === 0) {
    invalidInput('ranks', 'ranks must be a non-empty array of integers in [1, choices]')
  }
  return (ranks as unknown[]).map((r, i) => {
    if (typeof r !== 'number' || !Number.isInteger(r) || r < 1 || r > k) {
      invalidInput(`ranks[${i}]`, `ranks[${i}] must be an integer in [1, ${k}], got ${String(r)}`)
    }
    return r
  })
}

/**
 * Score the ranks the true targets received, one per trial, when each target
 * was ranked among `choices` candidates (1 = best). Reports the mean rank,
 * Utts' (1996) effect size $ES = ((k+1)/2 - \bar r)/\sqrt{(k^2-1)/12}$, the
 * exact sum-of-ranks p from {@link sumOfRanksDistribution}, and the
 * continuity-corrected normal approximation.
 *
 * Direct hits (rank 1) are counted too; Bem & Honorton (1994) and Milton
 * (1997) note that the design must fix *before* the data whether direct hits
 * or ranks are the primary score — reporting whichever is better is a
 * multiplicity error.
 *
 * @throws {JudgingError} `invalid_input` for ranks that are not integers in
 *   `[1, choices]`; `invalid_options` for `choices` < 2; `too_large` as
 *   {@link sumOfRanksDistribution}.
 */
export function rankOrderStatistic(ranks: readonly number[], choices: number): RankOrderScore {
  const k = optionInteger('choices', choices, 2)
  const list = rankList(ranks, k)
  const n = list.length
  const sum = list.reduce((acc, r) => acc + r, 0)
  const hits = list.filter((r) => r === 1).length
  const dist = sumOfRanksDistribution(n, k)
  const index = sum - n
  let lower = 0
  for (let i = 0; i <= index; i++) lower += dist.pmf[i] as number
  let upper = 0
  for (let i = dist.pmf.length - 1; i >= index; i--) upper += dist.pmf[i] as number
  const meanRank = sum / n
  const expectedMeanRank = (k + 1) / 2
  const rankSd = Math.sqrt((k * k - 1) / 12)
  const z = (n * expectedMeanRank - sum - 0.5) / (rankSd * Math.sqrt(n))
  return Object.freeze({
    trials: n,
    choices: k,
    hits,
    sumOfRanks: sum,
    meanRank,
    expectedMeanRank,
    rankSd,
    effectSize: (expectedMeanRank - meanRank) / rankSd,
    pExact: Math.min(1, lower),
    pExactUpper: Math.min(1, upper),
    z,
    pNormal: normSf(z),
  })
}

/** Mid-ranks (1 = smallest value) with ties averaged. */
function midRanks(values: Float64Array): Float64Array {
  const order = Array.from(values.keys()).sort(
    (a, b) => (values[a] as number) - (values[b] as number),
  )
  const out = new Float64Array(values.length)
  let i = 0
  while (i < order.length) {
    let j = i
    while (j + 1 < order.length && values[order[j + 1] as number] === values[order[i] as number])
      j++
    const rank = (i + j) / 2 + 1
    for (let m = i; m <= j; m++) out[order[m] as number] = rank
    i = j + 1
  }
  return out
}

/**
 * Combine several judges' rankings of the same candidates (a dream-telepathy
 * or remote-viewing panel) into a consensus: rank sums per candidate, their
 * mid-ranks (1 = best), Kendall's W with the tie correction
 * $$W = \frac{12\sum_i (R_i - \bar R)^2}{m^2(k^3-k) - m\sum_j T_j},\quad T_j = \sum (t^3 - t)$$
 * over each judge's tie groups, and Friedman's $\chi^2 = m(k-1)W$ with its
 * large-sample p. The consensus rank of the true target can then be scored
 * with {@link rankOrderStatistic} — but only if the consensus rule was fixed
 * before judging.
 *
 * @param judgeRanks one row per judge; each row ranks the same k candidates
 *   (1 = best). Tied candidates may share a mid-rank (multiples of ½); every
 *   row must sum to $k(k+1)/2$.
 * @throws {JudgingError} `invalid_input` for a ragged matrix, fewer than 2
 *   candidates, ranks outside `[1, k]`, non-half-integer ranks, or a row that
 *   does not sum to $k(k+1)/2$.
 */
export function consensusRank(judgeRanks: readonly (readonly number[])[]): ConsensusRank {
  const rows = numberMatrix('judgeRanks', judgeRanks)
  const m = rows.length
  const k = (rows[0] as number[]).length
  if (k < 2) invalidInput('judgeRanks', 'at least 2 candidates are needed')
  const target = (k * (k + 1)) / 2
  const sums = new Float64Array(k)
  let tieTerm = 0
  rows.forEach((row, j) => {
    let total = 0
    const seen = new Map<number, number>()
    row.forEach((r, i) => {
      if (r < 1 || r > k || !Number.isInteger(2 * r)) {
        invalidInput(
          `judgeRanks[${j}][${i}]`,
          `ranks must be multiples of ½ in [1, ${k}], got ${r}`,
        )
      }
      total += r
      sums[i] = (sums[i] as number) + r
      seen.set(r, (seen.get(r) ?? 0) + 1)
    })
    if (Math.abs(total - target) > 1e-9) {
      invalidInput(`judgeRanks[${j}]`, `judgeRanks[${j}] must sum to ${target}, got ${total}`)
    }
    for (const t of seen.values()) tieTerm += t * t * t - t
  })
  const meanSum = (m * (k + 1)) / 2
  let ss = 0
  for (const s of sums) ss += (s - meanSum) * (s - meanSum)
  const denominator = m * m * (k * k * k - k) - m * tieTerm
  // every judge tied every candidate: no ranking information, so no concordance to show
  const kendallW = denominator > 0 ? (12 * ss) / denominator : 0
  const friedmanChi2 = m * (k - 1) * kendallW
  return Object.freeze({
    judges: m,
    candidates: k,
    sums,
    meanRanks: sums.map((s) => s / m),
    consensus: midRanks(sums),
    kendallW,
    friedmanChi2,
    friedmanP: chi2Sf(friedmanChi2, k - 1),
  })
}
