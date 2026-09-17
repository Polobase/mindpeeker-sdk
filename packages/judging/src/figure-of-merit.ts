/**
 * Descriptor scoring for free-response trials: the fuzzy-set figure of merit
 * of May, Utts, Humphrey, Luke, Frivold & Trask (1990), with its null taken
 * from the design — the rank of the true target's figure among the decoys it
 * was randomly drawn with.
 *
 * Coding targets and responses into descriptor memberships is a human
 * judgment step. The arithmetic below is exact; the coding's blindness is not
 * something a library can guarantee.
 */
import { invalidInput, numberArray } from './internal/validate.js'

/** Accuracy, reliability and their product for one response–target pair. */
export interface FigureOfMerit {
  /** $\sum_i \min(\mu_{T,i}, \mu_{R,i})$ — the fuzzy intersection's size. */
  readonly overlap: number
  /** $\sum_i \mu_{T,i}$. */
  readonly targetMass: number
  /** $\sum_i \mu_{R,i}$. */
  readonly responseMass: number
  /** Fraction of the target described: overlap / targetMass. */
  readonly accuracy: number
  /** Fraction of the response that is correct: overlap / responseMass (0 for an empty response). */
  readonly reliability: number
  /** accuracy × reliability. */
  readonly figureOfMerit: number
}

/** The true target's figure of merit ranked among its decoys. */
export interface FigureOfMeritRank {
  /** Figure of merit of the true target. */
  readonly figureOfMerit: number
  /** Figures of merit of the decoys, in input order. */
  readonly decoys: Float64Array
  /** Candidates judged: decoys + 1. */
  readonly packetSize: number
  /** Conservative rank: 1 + number of decoys scoring at least as high (ties count against the target). */
  readonly rank: number
  /** Mid-rank: 1 + decoys scoring higher + ½ × decoys tying. */
  readonly midRank: number
  /** `rank / packetSize` — exact when no decoy ties the target, conservative otherwise. */
  readonly pValue: number
}

function memberships(argument: string, value: unknown, length?: number): number[] {
  const list = numberArray(argument, value)
  if (length !== undefined && list.length !== length) {
    invalidInput(
      argument,
      `${argument} must list ${length} descriptor memberships, got ${list.length}`,
    )
  }
  list.forEach((mu, i) => {
    if (!(mu >= 0 && mu <= 1)) {
      invalidInput(
        `${argument}[${i}]`,
        `${argument}[${i}] must be a membership in [0, 1], got ${mu}`,
      )
    }
  })
  return list
}

function score(response: readonly number[], target: readonly number[]): FigureOfMerit {
  let overlap = 0
  let targetMass = 0
  let responseMass = 0
  for (let i = 0; i < target.length; i++) {
    const t = target[i] as number
    const r = response[i] as number
    overlap += Math.min(t, r)
    targetMass += t
    responseMass += r
  }
  if (!(targetMass > 0)) {
    invalidInput('target', 'the target must have at least one descriptor with membership > 0')
  }
  const accuracy = overlap / targetMass
  const reliability = responseMass > 0 ? overlap / responseMass : 0
  return Object.freeze({
    overlap,
    targetMass,
    responseMass,
    accuracy,
    reliability,
    figureOfMerit: accuracy * reliability,
  })
}

/**
 * Figure of merit of a response against a target, both coded as memberships
 * $\mu \in [0,1]$ over the same descriptor list (binary 0/1 codes give the
 * crisp version):
 * $$\text{accuracy} = \frac{\sum_i \min(\mu_{T,i},\mu_{R,i})}{\sum_i \mu_{T,i}},\qquad
 *   \text{reliability} = \frac{\sum_i \min(\mu_{T,i},\mu_{R,i})}{\sum_i \mu_{R,i}},$$
 * figure of merit = accuracy × reliability (May et al. 1990; Utts 1996). A
 * response that lists everything scores accuracy 1 but low reliability; the
 * product penalizes "grass is green, sky is blue" descriptions.
 *
 * @throws {JudgingError} `invalid_input` for unequal lengths, memberships
 *   outside [0, 1], or a target with no descriptor.
 */
export function figureOfMerit(
  response: readonly number[],
  target: readonly number[],
): FigureOfMerit {
  const t = memberships('target', target)
  const r = memberships('response', response, t.length)
  return score(r, t)
}

/**
 * Score a response against the true target and every decoy of its packet and
 * rank the target's figure of merit. If the target was drawn uniformly from
 * the packet after the response was fixed, the target's rank is uniform on
 * $1…(D+1)$ whatever the response, so $P(\text{rank} \le r) = r/(D+1)$ is an
 * exact p-value (ties are counted against the target, making it
 * conservative). Several trials combine through `rankOrderStatistic`
 * on the ranks, or through direct hits (rank 1) — fixed in advance.
 *
 * @throws {JudgingError} `invalid_input` as {@link figureOfMerit}, or when
 *   `decoys` is empty or a decoy's length differs from the target's.
 */
export function figureOfMeritRank(
  response: readonly number[],
  target: readonly number[],
  decoys: readonly (readonly number[])[],
): FigureOfMeritRank {
  const t = memberships('target', target)
  const r = memberships('response', response, t.length)
  if (!Array.isArray(decoys) || decoys.length === 0) {
    invalidInput('decoys', 'decoys must be a non-empty array of membership vectors')
  }
  const observed = score(r, t).figureOfMerit
  const decoyScores = new Float64Array(decoys.length)
  let higher = 0
  let ties = 0
  ;(decoys as unknown[]).forEach((decoy, i) => {
    const d = memberships(`decoys[${i}]`, decoy, t.length)
    let targetMass = 0
    for (const mu of d) targetMass += mu
    if (!(targetMass > 0)) {
      invalidInput(
        `decoys[${i}]`,
        `decoys[${i}] must have at least one descriptor with membership > 0`,
      )
    }
    const value = score(r, d).figureOfMerit
    decoyScores[i] = value
    if (value > observed) higher++
    else if (value === observed) ties++
  })
  const packetSize = decoys.length + 1
  const rank = 1 + higher + ties
  return Object.freeze({
    figureOfMerit: observed,
    decoys: decoyScores,
    packetSize,
    rank,
    midRank: 1 + higher + ties / 2,
    pValue: rank / packetSize,
  })
}
