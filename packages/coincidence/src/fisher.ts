/**
 * Fisher's (1924) method of scoring coincidences: partial credit for partial
 * agreement, priced by how rare that agreement (or a better one) is.
 *
 * R. A. Fisher, "A Method of Scoring Coincidences in Tests with Playing
 * Cards", Proceedings of the Society for Psychical Research 34 (1924),
 * 181–185; reviewed in Diaconis & Mosteller (1989), Table 2.
 */
import { CoincidenceError } from './errors.js'
import { NeumaierSum } from './internal/numerics.js'
import { nonNegativeInteger, positiveInteger, probability } from './internal/validate.js'
import type {
  CardSuit,
  FisherAttribute,
  FisherMatchScore,
  FisherObservation,
  FisherScheme,
  FisherSeriesResult,
  PlayingCard,
} from './types.js'

const SUM_TOLERANCE = 1e-9

function invalid(argument: string, message: string): never {
  throw new CoincidenceError('invalid_input', message, { argument })
}

/**
 * Validate a list of independent graded attributes and compute Fisher's
 * scores and their exact null moments.
 *
 * For an attribute whose grades (worst → best) have null probabilities
 * $\pi_0, \dots, \pi_{G-1}$, reaching grade g scores
 * $$a(g) = -\log_{10} P(\text{grade} \ge g) = -\log_{10}\sum_{h \ge g}\pi_h,$$
 * so "no agreement or better" scores 0. Scores add over independent
 * attributes; the null mean and variance of the sum are exact sums of the
 * per-attribute moments.
 *
 * @param attributes non-empty list; each needs a name and ≥ 1 grade whose
 *   probabilities are in (0, 1] and sum to 1 (within 1e-9), with distinct labels
 */
export function fisherScheme(attributes: readonly FisherAttribute[]): FisherScheme {
  if (!Array.isArray(attributes) || attributes.length === 0) {
    invalid('attributes', 'attributes must be a non-empty array')
  }
  const copies: FisherAttribute[] = []
  const scores: number[][] = []
  const mean = new NeumaierSum()
  const variance = new NeumaierSum()
  attributes.forEach((attribute: FisherAttribute, a) => {
    const where = `attributes[${a}]`
    if (attribute === null || typeof attribute !== 'object')
      invalid(where, `${where} must be an object`)
    if (typeof attribute.name !== 'string')
      invalid(`${where}.name`, `${where}.name must be a string`)
    if (!Array.isArray(attribute.grades) || attribute.grades.length === 0) {
      invalid(`${where}.grades`, `${where}.grades must be a non-empty array`)
    }
    const labels = new Set<string>()
    const total = new NeumaierSum()
    const grades = attribute.grades.map((grade, g) => {
      const at = `${where}.grades[${g}]`
      if (grade === null || typeof grade !== 'object' || typeof grade.label !== 'string') {
        invalid(at, `${at} must be { label: string, probability: number }`)
      }
      if (labels.has(grade.label)) invalid(at, `${at}.label ${grade.label} is not unique`)
      labels.add(grade.label)
      if (probability(`${at}.probability`, grade.probability) === 0) {
        invalid(`${at}.probability`, `${at}.probability must be > 0 (every grade must be possible)`)
      }
      total.add(grade.probability)
      return Object.freeze({ label: grade.label, probability: grade.probability })
    })
    if (!(Math.abs(total.value - 1) <= SUM_TOLERANCE)) {
      invalid(`${where}.grades`, `${where}.grades probabilities must sum to 1, got ${total.value}`)
    }
    // tail sums from the best grade down
    const tails = new Array<number>(grades.length)
    const tail = new NeumaierSum()
    for (let g = grades.length - 1; g >= 0; g--) {
      tail.add((grades[g] as { probability: number }).probability)
      tails[g] = g === 0 ? 1 : Math.min(1, tail.value)
    }
    const row = tails.map((t) => 0 - Math.log10(t)) // 0 − 0 keeps the worst grade at +0
    let m = 0
    let second = 0
    grades.forEach((grade, g) => {
      const s = row[g] as number
      m += grade.probability * s
      second += grade.probability * s * s
    })
    mean.add(m)
    variance.add(Math.max(0, second - m * m))
    copies.push(Object.freeze({ name: attribute.name, grades: Object.freeze(grades) }))
    scores.push(row)
  })
  const sd = Math.sqrt(variance.value)
  return Object.freeze({
    attributes: Object.freeze(copies),
    scores: Object.freeze(scores.map((row) => Object.freeze(row))),
    mean: mean.value,
    sd,
  })
}

function schemeOf(scheme: FisherScheme | readonly FisherAttribute[]): FisherScheme {
  if (Array.isArray(scheme)) return fisherScheme(scheme)
  const s = scheme as FisherScheme
  if (s === null || typeof s !== 'object' || !Array.isArray(s.attributes)) {
    invalid('scheme', 'scheme must be a FisherScheme or an array of attributes')
  }
  return s
}

function gradeIndex(scheme: FisherScheme, a: number, value: unknown): number {
  const attribute = scheme.attributes[a] as FisherAttribute
  const at = `observed[${a}]`
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value >= attribute.grades.length) {
      invalid(at, `${at} must be a grade index in [0, ${attribute.grades.length - 1}]`)
    }
    return value
  }
  if (typeof value === 'string') {
    const index = attribute.grades.findIndex((g) => g.label === value)
    if (index < 0)
      invalid(at, `${at}: unknown grade ${JSON.stringify(value)} for ${attribute.name}`)
    return index
  }
  return invalid(at, `${at} must be a grade label or index`)
}

/**
 * Fisher's score of one observed agreement. `observed` lists one grade per
 * attribute (label or index, in attribute order). Returns the raw score
 * $\sum_a a(g_a)$, Fisher's standardized score $10(\text{raw} - \mu)/\sigma$
 * (null mean 0, SD 10) and the joint tail probability $10^{-\text{raw}}$.
 *
 * With {@link PLAYING_CARD_SCHEME} this reproduces Fisher's nine card scores
 * (suit O/C/S × value O/R/N): −11.18, −6.11, +18.50, −3.16, +1.91, +26.53,
 * +4.86, +9.94, +34.55.
 *
 * The null assumes both cards are drawn at random. With a guesser naming
 * cards against a shuffled deck the guesses are not random; Fisher (1928)
 * conditioned on the guess instead (Diaconis & Mosteller 1989, §6 and Remark 2).
 */
export function fisherMatchScore(
  scheme: FisherScheme | readonly FisherAttribute[],
  observed: FisherObservation,
): FisherMatchScore {
  const s = schemeOf(scheme)
  if (!Array.isArray(observed) || observed.length !== s.attributes.length) {
    invalid(
      'observed',
      `observed must list one grade for each of ${s.attributes.length} attributes`,
    )
  }
  if (!(s.sd > 0))
    invalid('scheme', 'scheme has zero null variance, so scores cannot be standardized')
  const grades = observed.map((value, a) => gradeIndex(s, a, value))
  const raw = new NeumaierSum()
  grades.forEach((g, a) => {
    raw.add((s.scores[a] as readonly number[])[g] as number)
  })
  return Object.freeze({
    grades: Object.freeze(grades),
    raw: raw.value,
    score: (10 * (raw.value - s.mean)) / s.sd,
    tailProbability: 10 ** -raw.value,
  })
}

/**
 * Fisher's test for a series of n independent observations: the mean
 * standardized score has null standard error $10/\sqrt n$, and Fisher held it
 * unsafe to infer anything beyond chance unless the mean exceeds twice that.
 * `z` is reported for convenience; no p-value is claimed (the score's null
 * distribution is discrete and only approximately normal for small n).
 */
export function fisherSeries(
  scheme: FisherScheme | readonly FisherAttribute[],
  observations: readonly FisherObservation[],
): FisherSeriesResult {
  const s = schemeOf(scheme)
  if (!Array.isArray(observations) || observations.length === 0) {
    invalid('observations', 'observations must be a non-empty array')
  }
  const total = new NeumaierSum()
  for (const observed of observations) total.add(fisherMatchScore(s, observed).score)
  const n = observations.length
  const meanScore = total.value / n
  const standardError = 10 / Math.sqrt(n)
  return Object.freeze({
    n,
    total: total.value,
    meanScore,
    standardError,
    z: meanScore / standardError,
    exceedsTwoStandardErrors: meanScore > 2 * standardError,
  })
}

/**
 * Fisher's playing-card scheme: suit agreement O (different colour, ½),
 * C (same colour, other suit, ¼), S (same suit, ¼); value agreement
 * O (one spot card and one picture card, 60/169), R (both spot cards A–10 or
 * both pictures J/Q/K, different value, 96/169), N (same value, 13/169).
 */
export const PLAYING_CARD_SCHEME: FisherScheme = fisherScheme([
  {
    name: 'suit',
    grades: [
      { label: 'O', probability: 1 / 2 },
      { label: 'C', probability: 1 / 4 },
      { label: 'S', probability: 1 / 4 },
    ],
  },
  {
    name: 'value',
    grades: [
      { label: 'O', probability: 60 / 169 },
      { label: 'R', probability: 96 / 169 },
      { label: 'N', probability: 13 / 169 },
    ],
  },
])

const SUITS: readonly CardSuit[] = ['spades', 'hearts', 'diamonds', 'clubs']
const RED: ReadonlySet<CardSuit> = new Set<CardSuit>(['hearts', 'diamonds'])

function card(argument: string, value: PlayingCard): PlayingCard {
  if (value === null || typeof value !== 'object' || !SUITS.includes(value.suit)) {
    invalid(argument, `${argument}.suit must be one of ${SUITS.join(', ')}`)
  }
  positiveInteger(`${argument}.rank`, value.rank)
  if (value.rank > 13) invalid(`${argument}.rank`, `${argument}.rank must be 1 (ace) … 13 (king)`)
  return value
}

/**
 * Grade labels of two cards under {@link PLAYING_CARD_SCHEME}, ready for
 * {@link fisherMatchScore}: the jack of hearts against the queen of diamonds
 * is `['C', 'R']`.
 */
export function playingCardGrades(a: PlayingCard, b: PlayingCard): [string, string] {
  const x = card('a', a)
  const y = card('b', b)
  const suit = x.suit === y.suit ? 'S' : RED.has(x.suit) === RED.has(y.suit) ? 'C' : 'O'
  const value = x.rank === y.rank ? 'N' : x.rank > 10 === y.rank > 10 ? 'R' : 'O'
  return [suit, value]
}

/**
 * Fisher's closeness score on a circle of c positions (Diaconis & Mosteller
 * 1989, §6 Remark 5, for birthdays and deathdays): $-\log_{10}\bigl((1 + 2d)/c\bigr)$,
 * the surprisal of two random points being at least as close as the observed
 * circular distance d. It avoids choosing a cutoff for "near". Returns 0 once
 * $1 + 2d \ge c$ (every pair is that close).
 *
 * @param distance observed circular distance d, a non-negative safe integer ≤ c/2
 * @param c positions on the circle, a positive safe integer
 */
export function fisherClosenessScore(distance: number, c: number): number {
  nonNegativeInteger('distance', distance)
  positiveInteger('c', c)
  if (2 * distance > c) invalid('distance', `distance must be at most c/2 on a circle of ${c}`)
  return Math.max(0, -Math.log10(Math.min(1, (1 + 2 * distance) / c)))
}
