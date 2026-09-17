/**
 * Forced-choice scoring: direct hits against a known chance rate, the Rhine–Pratt
 * run conventions, and the effect-size scales used by the ganzfeld and card
 * literatures. Every p-value here is an exact binomial tail.
 *
 * The null these tests assume is a design fact, not a statistical one: each
 * trial's target is drawn uniformly and independently from `choices`
 * alternatives (for ganzfeld, the decoys are the other members of a randomly
 * chosen packet), and the response is recorded before any feedback. Closed
 * decks and trial-by-trial feedback break it — see `closedDeckTest` and
 * `readFeedbackExpectation`.
 */
import { clopperPearson, lowerTail, twoSidedP, upperTail } from './internal/binomial.js'
import { normSf } from './internal/numerics.js'
import {
  integerAtLeast,
  invalidInput,
  invalidOptions,
  openUnit,
  optionInteger,
  optionsObject,
} from './internal/validate.js'
import type { ConfidenceInterval, RunConvention } from './types.js'

/** Options for {@link forcedChoiceTest}, {@link directHits} and {@link runsScore}. */
export interface ForcedChoiceOptions {
  /** Coverage of the Clopper–Pearson interval. Default 0.95. */
  readonly confidence?: number
}

/** Scores of `hits` successes in `trials` trials against chance rate `p0`. */
export interface ForcedChoiceScore {
  readonly hits: number
  readonly trials: number
  /** Chance hit probability per trial. */
  readonly p0: number
  /** Observed hit rate `hits / trials`. */
  readonly hitRate: number
  /** Mean chance expectation $n p_0$ (Rhine–Pratt "MCE"). */
  readonly mce: number
  /** Deviation from chance, `hits − mce`. */
  readonly deviation: number
  /** Binomial standard deviation $\sqrt{n p_0 (1-p_0)}$. */
  readonly sd: number
  /** Critical ratio `deviation / sd` (a z-score without continuity correction). */
  readonly criticalRatio: number
  /** Two-sided normal-table reading of the critical ratio, $2(1-\Phi(|CR|))$ — the Rhine–Pratt convention; prefer the exact values. */
  readonly pCriticalRatio: number
  /** Exact one-sided p for hitting, $P(X \ge \text{hits})$. */
  readonly pOneSided: number
  /** Exact one-sided p for missing, $P(X \le \text{hits})$. */
  readonly pLower: number
  /** Exact two-sided p (minimum-likelihood rule, as SciPy `binomtest`). */
  readonly pTwoSided: number
  /** Effect size $z/\sqrt{n}$ with $z$ the critical ratio (Bem & Honorton 1994; Utts 1991). */
  readonly effectSize: number
  /** Cohen's $h = 2\arcsin\sqrt{\hat p} - 2\arcsin\sqrt{p_0}$. */
  readonly cohensH: number
  /** Clopper–Pearson interval for the hit probability. */
  readonly confidenceInterval: ConfidenceInterval
}

/** {@link ForcedChoiceScore} plus the k-alternative effect-size scale. */
export interface DirectHitsScore extends ForcedChoiceScore {
  /** Number of equiprobable alternatives per trial (4 for a ganzfeld packet). */
  readonly choices: number
  /** Rosenthal & Rubin's (1989) $\pi$ — see {@link rosenthalRubinPi}. */
  readonly rosenthalRubinPi: number
}

/** {@link ForcedChoiceScore} over whole runs of a {@link RunConvention}. */
export interface RunsScore extends ForcedChoiceScore {
  readonly convention: RunConvention
  readonly runs: number
  /** Mean hits per run. */
  readonly meanPerRun: number
  /** Chance expectation per run. */
  readonly mcePerRun: number
  /** Standard deviation of one run's score; `sd = sdPerRun·√runs`. */
  readonly sdPerRun: number
}

/** Hits and runs of one condition in {@link runsDifference}. */
export interface RunGroup {
  readonly hits: number
  readonly runs: number
}

/** Rhine–Pratt comparison of two conditions scored in runs. */
export interface RunsDifference {
  readonly meanA: number
  readonly meanB: number
  /** `meanA − meanB` (hits per run). */
  readonly difference: number
  /** $SD_{run}\sqrt{1/R_A + 1/R_B}$. */
  readonly sdDifference: number
  readonly criticalRatio: number
  /** Two-sided normal p of the critical ratio. */
  readonly pTwoSided: number
}

/**
 * Rhine's ESP run: 25 calls of a 5-symbol Zener pack, chance 1/5, MCE 5,
 * SD 2 per run (Rhine & Pratt 1957). The binomial SD assumes independent
 * targets (an open deck); a shuffled closed pack has SD 2.0412
 * (`closedDeckTest`).
 */
export const ESP_RUN: RunConvention = Object.freeze({
  name: 'esp',
  trialsPerRun: 25,
  choices: 5,
  p0: 1 / 5,
})

/**
 * Rhine's PK run: 24 die throws aimed at one face, chance 1/6, MCE 4,
 * SD $\sqrt{24 \cdot 5/36} = 1.8257$ per run (Rhine & Pratt 1957). Targets
 * must rotate over all six faces so die bias cancels (Radin & Ferrari 1991).
 */
export const PK_RUN: RunConvention = Object.freeze({
  name: 'pk',
  trialsPerRun: 24,
  choices: 6,
  p0: 1 / 6,
})

function counts(hits: unknown, trials: unknown): { hits: number; trials: number } {
  const n = integerAtLeast('trials', trials, 1)
  if (typeof hits !== 'number' || !Number.isInteger(hits) || hits < 0 || hits > n) {
    invalidInput('hits', `hits must be an integer in [0, ${n}], got ${String(hits)}`)
  }
  return { hits, trials: n }
}

function confidenceOf(options: ForcedChoiceOptions | undefined): number {
  const opts = optionsObject(options)
  return opts.confidence === undefined ? 0.95 : openUnit('confidence', opts.confidence)
}

function score(hits: number, n: number, p0: number, confidence: number): ForcedChoiceScore {
  const mce = n * p0
  const sd = Math.sqrt(n * p0 * (1 - p0))
  const deviation = hits - mce
  const criticalRatio = deviation / sd
  const hitRate = hits / n
  return {
    hits,
    trials: n,
    p0,
    hitRate,
    mce,
    deviation,
    sd,
    criticalRatio,
    pCriticalRatio: Math.min(1, 2 * normSf(Math.abs(criticalRatio))),
    pOneSided: upperTail(hits, n, p0),
    pLower: lowerTail(hits, n, p0),
    pTwoSided: twoSidedP(hits, n, p0),
    effectSize: criticalRatio / Math.sqrt(n),
    cohensH: 2 * Math.asin(Math.sqrt(hitRate)) - 2 * Math.asin(Math.sqrt(p0)),
    confidenceInterval: clopperPearson(hits, n, confidence),
  }
}

/**
 * Score `hits` successes in `trials` independent trials against an arbitrary
 * chance rate `p0` (½ for a placement test, ¼ for a four-clip ganzfeld set,
 * 1/5 for Zener calls, 1/6 for a die face).
 *
 * Rhine & Pratt's statistics are reported alongside exact ones: MCE $= np_0$,
 * deviation, SD $= \sqrt{np_0(1-p_0)}$, critical ratio $CR = (x - np_0)/SD$
 * and its two-sided normal p. The exact tails are
 * $P(X \ge x) = I_{p_0}(x, n-x+1)$ and $P(X \le x)$ via negentropy's
 * incomplete beta, with no normal approximation.
 *
 * @example
 * // Carter's autoganzfeld total: 122 direct hits in 354 sessions at p0 = 1/4
 * forcedChoiceTest(122, 354, 0.25).criticalRatio // 4.11
 *
 * @throws {JudgingError} `invalid_input` for non-integer or out-of-range
 *   counts; `invalid_options` for `p0` or `confidence` outside (0, 1).
 */
export function forcedChoiceTest(
  hits: number,
  trials: number,
  p0: number,
  options?: ForcedChoiceOptions,
): ForcedChoiceScore {
  const c = counts(hits, trials)
  const chance = openUnit('p0', p0)
  return Object.freeze(score(c.hits, c.trials, chance, confidenceOf(options)))
}

/**
 * Rosenthal & Rubin's (1989) $\pi$: the hit rate $P$ of a k-alternative
 * design mapped onto the two-alternative scale,
 * $$\pi = \frac{P(k-1)}{1 + P(k-2)},$$
 * so chance is always $\pi = \tfrac12$ and a perfect score $\pi = 1$. For
 * $k = 4$ and $P = 0.32$ (the ganzfeld meta-analytic rate), $\pi = 0.585$.
 *
 * @throws {JudgingError} `invalid_input` for a hit rate outside [0, 1];
 *   `invalid_options` for `choices` not an integer ≥ 2.
 */
export function rosenthalRubinPi(hitRate: number, choices: number): number {
  const k = optionInteger('choices', choices, 2)
  if (typeof hitRate !== 'number' || !(hitRate >= 0 && hitRate <= 1)) {
    invalidInput('hitRate', `hitRate must be in [0, 1], got ${String(hitRate)}`)
  }
  return (hitRate * (k - 1)) / (1 + hitRate * (k - 2))
}

/**
 * Direct-hit scoring for a design with `choices` equiprobable alternatives
 * (ganzfeld: the receiver or a blind judge picks the target out of a packet
 * of 4). Equivalent to {@link forcedChoiceTest} at $p_0 = 1/k$, plus
 * {@link rosenthalRubinPi}. Bem & Honorton (1994) and Storm et al. (2010)
 * test direct hits with exactly this binomial.
 *
 * @throws {JudgingError} as {@link forcedChoiceTest}; `invalid_options` for
 *   `choices` not an integer ≥ 2.
 */
export function directHits(
  hits: number,
  trials: number,
  choices: number,
  options?: ForcedChoiceOptions,
): DirectHitsScore {
  const k = optionInteger('choices', choices, 2)
  const c = counts(hits, trials)
  const base = score(c.hits, c.trials, 1 / k, confidenceOf(options))
  return Object.freeze({
    ...base,
    choices: k,
    rosenthalRubinPi: rosenthalRubinPi(base.hitRate, k),
  })
}

function convention(value: RunConvention): RunConvention {
  if (value === null || typeof value !== 'object') {
    invalidOptions('convention', 'convention must be a RunConvention object')
  }
  const trialsPerRun = optionInteger('convention.trialsPerRun', value.trialsPerRun, 1)
  const choices = optionInteger('convention.choices', value.choices, 2)
  const p0 = openUnit('convention.p0', value.p0)
  const name = typeof value.name === 'string' ? value.name : 'custom'
  return Object.freeze({ name, trialsPerRun, choices, p0 })
}

/**
 * Score a series of complete runs (e.g. `ESP_RUN`, `PK_RUN`): `hits` is the
 * total over `runs` runs, so the trial count is `runs × trialsPerRun` and the
 * run-level SD scales as $SD_{series} = SD_{run}\sqrt{R}$.
 *
 * @throws {JudgingError} as {@link forcedChoiceTest}; `invalid_input` for
 *   `runs` not an integer ≥ 1; `invalid_options` for a malformed convention.
 */
export function runsScore(
  hits: number,
  runs: number,
  runConvention: RunConvention,
  options?: ForcedChoiceOptions,
): RunsScore {
  const conv = convention(runConvention)
  const r = integerAtLeast('runs', runs, 1)
  const c = counts(hits, r * conv.trialsPerRun)
  const base = score(c.hits, c.trials, conv.p0, confidenceOf(options))
  return Object.freeze({
    ...base,
    convention: conv,
    runs: r,
    meanPerRun: c.hits / r,
    mcePerRun: conv.trialsPerRun * conv.p0,
    sdPerRun: Math.sqrt(conv.trialsPerRun * conv.p0 * (1 - conv.p0)),
  })
}

/**
 * Rhine & Pratt's (1957) critical ratio of the difference between two
 * conditions scored in runs: $SD_{diff} = SD_{run}\sqrt{1/R_A + 1/R_B}$ and
 * $CR = (\bar x_A - \bar x_B)/SD_{diff}$. With equal groups this equals the
 * pooled-trials rule $CR = (x_A - x_B)/\sqrt{N p_0 q_0}$. The normal reading
 * assumes independent binomial runs; with fewer than ~30 runs per group
 * Rhine & Pratt switch to a t-test on run scores.
 *
 * @throws {JudgingError} `invalid_input` for bad hits/runs; `invalid_options`
 *   for a malformed convention.
 */
export function runsDifference(
  a: RunGroup,
  b: RunGroup,
  runConvention: RunConvention,
): RunsDifference {
  const conv = convention(runConvention)
  const group = (value: RunGroup, label: string): { hits: number; runs: number } => {
    if (value === null || typeof value !== 'object') {
      invalidInput(label, `${label} must be { hits, runs }`)
    }
    const runs = integerAtLeast(`${label}.runs`, value.runs, 1)
    const n = runs * conv.trialsPerRun
    if (
      typeof value.hits !== 'number' ||
      !Number.isInteger(value.hits) ||
      value.hits < 0 ||
      value.hits > n
    ) {
      invalidInput(
        `${label}.hits`,
        `${label}.hits must be an integer in [0, ${n}], got ${String(value.hits)}`,
      )
    }
    return { hits: value.hits, runs }
  }
  const ga = group(a, 'a')
  const gb = group(b, 'b')
  const sdRun = Math.sqrt(conv.trialsPerRun * conv.p0 * (1 - conv.p0))
  const meanA = ga.hits / ga.runs
  const meanB = gb.hits / gb.runs
  const sdDifference = sdRun * Math.sqrt(1 / ga.runs + 1 / gb.runs)
  const criticalRatio = (meanA - meanB) / sdDifference
  return Object.freeze({
    meanA,
    meanB,
    difference: meanA - meanB,
    sdDifference,
    criticalRatio,
    pTwoSided: Math.min(1, 2 * normSf(Math.abs(criticalRatio))),
  })
}
