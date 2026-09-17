/**
 * @mindpeeker/judging — exact scoring and null distributions for forced-choice
 * and free-response psi experiments.
 *
 * Every null here comes from the randomization of targets (uniform draws, a
 * shuffled pack, a random pairing of transcripts to targets), not from any
 * assumption about the responder. The mathematics is exact and verifiable; the
 * hypothesis these experiments test is contested, and a small p-value is a
 * fact about calls versus targets under the stated design, not evidence of a
 * mechanism.
 */

export {
  type ForcedChoiceBayesFactor,
  type ForcedChoiceBayesOptions,
  forcedChoiceBayesFactor,
} from './bayes.js'
export {
  type ClosedDeckDistribution,
  type ClosedDeckTest,
  type ClosedDeckTestOptions,
  closedDeckMatchDistribution,
  closedDeckTest,
  compositionProbability,
  MAX_CLOSED_DECK_CARDS,
  MAX_CLOSED_DECK_RUN_CARDS,
} from './closed-deck.js'
export {
  type DiagonalScore,
  type DisplacementOptions,
  type DisplacementPattern,
  type DisplacementScore,
  displacementMatrix,
  displacementScore,
  MAX_DISPLACEMENT_WORK,
  type OffsetScore,
} from './displacement.js'
export { JudgingError, type JudgingErrorCode, type JudgingErrorOptions } from './errors.js'
export {
  type FeedbackExpectation,
  guessingCapacity,
  MAX_FEEDBACK_CELLS,
  MAX_FEEDBACK_STATES,
  readFeedbackExpectation,
} from './feedback.js'
export {
  type FigureOfMerit,
  type FigureOfMeritRank,
  figureOfMerit,
  figureOfMeritRank,
} from './figure-of-merit.js'
export {
  type DirectHitsScore,
  directHits,
  ESP_RUN,
  type ForcedChoiceOptions,
  type ForcedChoiceScore,
  forcedChoiceTest,
  PK_RUN,
  type RunGroup,
  type RunsDifference,
  type RunsScore,
  rosenthalRubinPi,
  runsDifference,
  runsScore,
} from './forced-choice.js'
export {
  type DeflatedCriticalValue,
  deflatedCriticalValue,
  type ExpectedMaxOfLooks,
  expectedMaxOfLooks,
  expectedMaxOfPmf,
  type LooksOptions,
  MAX_OPTIONAL_STOPPING_WORK,
  maxOfLooksPValue,
  type OptionalStoppingOptions,
  type OptionalStoppingRisk,
  optionalStoppingRisk,
} from './multiplicity.js'
export {
  MAX_ENUMERATION_SIZE,
  MAX_SUBSET_DP_CELLS,
  type RankMatrixOptions,
  type RankMatrixTest,
  rankMatrixPermutationTest,
} from './rank-matrix.js'
export {
  type ConsensusRank,
  consensusRank,
  MAX_SUM_OF_RANKS_WORK,
  type RankOrderScore,
  rankOrderStatistic,
  type SumOfRanksDistribution,
  sumOfRanksDistribution,
} from './ranks.js'
export type {
  Alternative,
  BetaPrior,
  ConfidenceInterval,
  RunConvention,
  Seed,
} from './types.js'
