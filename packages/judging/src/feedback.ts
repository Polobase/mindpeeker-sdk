/**
 * Chance baselines that change when the guesser learns something: Read's
 * optimal strategy under trial-by-trial feedback on a closed pack, and the
 * Shannon capacity a hit rate would represent.
 */
import { integerAtLeast, invalidInput, optionInteger, tooLarge } from './internal/validate.js'

/** Largest number of distinct deck states {@link readFeedbackExpectation} memoizes. */
export const MAX_FEEDBACK_STATES = 200_000

/** Largest number of stored pmf cells (Σ over states of cards left + 1) {@link readFeedbackExpectation} allows. */
export const MAX_FEEDBACK_CELLS = 8_000_000

/** Read's optimal-feedback baseline for a closed pack. */
export interface FeedbackExpectation {
  /** Pack composition as given. */
  readonly deck: readonly number[]
  readonly cards: number
  /** Expected hits of the optimal no-psi strategy with full feedback. */
  readonly expected: number
  readonly variance: number
  readonly sd: number
  /** `pmf[k]` = probability of exactly k hits under that strategy. */
  readonly pmf: Float64Array
  /**
   * Best expected hits without feedback: every call sequence scores
   * $\sum_s c_s t_s/N \le \max_s t_s$, attained by always calling the most
   * frequent symbol (5 for the Zener pack).
   */
  readonly withoutFeedback: number
  /** Distinct (sorted) count vectors visited by the recursion. */
  readonly states: number
}

/**
 * Exact size of the recursion before running it: the non-empty sorted count
 * vectors $y_1 \ge \dots \ge y_K$ with $y_i \le c_i$ (c sorted descending) are
 * exactly the reachable states; `cells` sums their stored pmf lengths.
 */
function census(sortedDesc: readonly number[]): { states: number; cells: number } {
  const top = sortedDesc[0] as number
  let count = new Float64Array(top + 1).fill(1) // one empty suffix under any bound
  let sum = new Float64Array(top + 1)
  for (let i = sortedDesc.length - 1; i >= 0; i--) {
    const cap = sortedDesc[i] as number
    const nextCount = new Float64Array(top + 1)
    const nextSum = new Float64Array(top + 1)
    let accCount = 0
    let accSum = 0
    for (let bound = 0; bound <= top; bound++) {
      if (bound <= cap) {
        accCount += count[bound] as number
        accSum += (sum[bound] as number) + bound * (count[bound] as number)
      }
      nextCount[bound] = accCount
      nextSum[bound] = accSum
    }
    count = nextCount
    sum = nextSum
  }
  const all = count[top] as number
  // drop the all-zero vector (never memoized)
  return { states: all - 1, cells: (sum[top] as number) + all - 1 }
}

/**
 * Expected hits (and their full distribution) of the best possible strategy
 * when each card is shown to the guesser after the call — the correct chance
 * baseline for open-feedback card guessing (Read 1962; Epstein's Theory of
 * Gambling, ch. 11). With remaining symbol counts $c$ the optimal call is any
 * most-represented symbol, and
 * $$E(c) = \frac{\max_j c_j}{\sum c} + \sum_j \frac{c_j}{\sum c}\,E(c - e_j), \qquad E(0) = 0.$$
 * The hit distribution follows the same recursion as a generating function
 * (ties between equally frequent symbols do not change it). For the 25-card
 * Zener pack $E = 8.6468$ hits (Epstein prints 8.647) against 5 without
 * feedback — so any "above chance" claim for a feedback design must be
 * measured against this, not against 5 (cf. Diaconis & Graham 1981).
 *
 * State is memoized on the sorted count vector; the number of states is the
 * number of sub-multisets of the pack's counts (252 for 5 × 5, 2380 for a
 * 52-card deck).
 *
 * @param deck copies of each symbol, e.g. `[5, 5, 5, 5, 5]`
 * @throws {JudgingError} `invalid_input` for non-integer or negative counts or
 *   an empty pack; `too_large` beyond {@link MAX_FEEDBACK_STATES} states or
 *   {@link MAX_FEEDBACK_CELLS} stored pmf cells.
 */
export function readFeedbackExpectation(deck: readonly number[]): FeedbackExpectation {
  if (!Array.isArray(deck) || deck.length === 0) {
    invalidInput('deck', 'deck must be a non-empty array of symbol counts')
  }
  const counts = (deck as unknown[]).map((c, i) => integerAtLeast(`deck[${i}]`, c, 0))
  const cards = counts.reduce((sum, x) => sum + x, 0)
  if (cards === 0) invalidInput('deck', 'the pack must hold at least one card')
  const start = counts.filter((c) => c > 0).sort((x, y) => y - x)
  const size = census(start)
  if (size.states > MAX_FEEDBACK_STATES) {
    tooLarge(
      'deck',
      `the feedback recursion needs ${size.states} states (limit ${MAX_FEEDBACK_STATES})`,
    )
  }
  if (size.cells > MAX_FEEDBACK_CELLS) {
    tooLarge(
      'deck',
      `the feedback distribution needs ${size.cells} cells (limit ${MAX_FEEDBACK_CELLS})`,
    )
  }
  const memo = new Map<string, Float64Array>()

  // pmf of future hits from state `state` (sorted descending, zeros dropped)
  const solve = (state: number[]): Float64Array => {
    const remaining = state.reduce((sum, x) => sum + x, 0)
    if (remaining === 0) return new Float64Array([1])
    const key = state.join(',')
    const hit = memo.get(key)
    if (hit !== undefined) return hit
    const out = new Float64Array(remaining + 1)
    // the call is state[0] (a most frequent symbol); symbols with equal counts
    // lead to the same sorted successor, so group them
    let j = 0
    while (j < state.length) {
      const value = state[j] as number
      let run = j
      while (run < state.length && state[run] === value) run++
      const multiplicity = run - j
      // removing one card from the last member of the run keeps the order sorted
      const successor = state.slice()
      successor[run - 1] = value - 1
      if (value - 1 === 0) successor.pop()
      const sub = solve(successor)
      if (j === 0) {
        // one member of the group is the called symbol (a hit), the rest are misses
        const pHit = value / remaining
        const pMiss = ((multiplicity - 1) * value) / remaining
        for (let k = 0; k < sub.length; k++) {
          const s = sub[k] as number
          out[k + 1] = (out[k + 1] as number) + pHit * s
          out[k] = (out[k] as number) + pMiss * s
        }
      } else {
        const p = (multiplicity * value) / remaining
        for (let k = 0; k < sub.length; k++) out[k] = (out[k] as number) + p * (sub[k] as number)
      }
      j = run
    }
    memo.set(key, out)
    return out
  }

  const pmf = solve(start)
  let mean = 0
  let second = 0
  for (let k = 0; k < pmf.length; k++) {
    const p = pmf[k] as number
    mean += k * p
    second += k * k * p
  }
  const variance = Math.max(0, second - mean * mean)
  return Object.freeze({
    deck: Object.freeze(counts),
    cards,
    expected: mean,
    variance,
    sd: Math.sqrt(variance),
    pmf,
    withoutFeedback: Math.max(...counts),
    states: memo.size,
  })
}

/**
 * Shannon capacity, in bits per trial, of the symmetric channel implied by a
 * k-alternative hit rate $p$ (misses spread evenly over the $k-1$ wrong
 * symbols):
 * $$C = \log_2 k + p\log_2 p + (1-p)\log_2\frac{1-p}{k-1},$$
 * which is 0 at chance ($p = 1/k$) and $\log_2 k$ at $p = 1$. It puts an
 * effect in information units: 6 or 7 Zener hits per 25 carry 0.0069 or
 * 0.026 bits per call (Epstein, ch. 11). The capacity is the most such a
 * channel could transmit with ideal coding, not what a guesser conveys.
 *
 * @throws {JudgingError} `invalid_input` for a hit rate outside [0, 1];
 *   `invalid_options` for `choices` not an integer ≥ 2.
 */
export function guessingCapacity(hitRate: number, choices: number): number {
  const k = optionInteger('choices', choices, 2)
  if (typeof hitRate !== 'number' || !(hitRate >= 0 && hitRate <= 1)) {
    invalidInput('hitRate', `hitRate must be in [0, 1], got ${String(hitRate)}`)
  }
  const p = hitRate
  const hitTerm = p === 0 ? 0 : p * Math.log2(p)
  const missTerm = p === 1 ? 0 : (1 - p) * Math.log2((1 - p) / (k - 1))
  return Math.max(0, Math.log2(k) + hitTerm + missTerm)
}
