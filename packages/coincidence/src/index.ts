/**
 * @mindpeeker/coincidence — exact probabilities of coincidences.
 *
 * The honest denominator for synchronicity logs, gematria value matches,
 * oracle draw repeats and field hits: how often chance alone produces the
 * coincidence that was noticed. Nothing here is evidence of meaning.
 */

export {
  birthdayApprox,
  birthdayMatch,
  birthdayNoMatch,
  peopleForMatch,
  peopleForMatchApprox,
} from './birthday.js'
export {
  CoincidenceError,
  type CoincidenceErrorCode,
  type CoincidenceErrorOptions,
} from './errors.js'
export {
  fisherClosenessScore,
  fisherMatchScore,
  fisherScheme,
  fisherSeries,
  PLAYING_CARD_SCHEME,
  playingCardGrades,
} from './fisher.js'
export {
  type Categories,
  KWAY_WORK_LIMIT,
  kWayMatch,
  kWayMatchApprox,
  kWayNoMatch,
  kWayProbabilities,
  peopleForKWayMatch,
  peopleForKWayMatchApprox,
} from './kway.js'
export { expectedCoincidences, probabilityAtLeastOne } from './large-numbers.js'
export { multiCategory, multiCategoryMatch, multiCategoryNoMatch } from './multi.js'
export {
  nearMatch,
  nearNoMatch,
  peopleForNearMatch,
  peopleForNearMatchApprox,
} from './near.js'
export {
  collisionProbability,
  NONUNIFORM_EXACT_LIMIT,
  noMatchNonUniform,
  probabilitiesFromCounts,
} from './nonuniform.js'
export { MAX_WINDOWS, seriesClustering } from './seriality.js'
export type {
  CardSuit,
  DispersionSummary,
  FisherAttribute,
  FisherGrade,
  FisherMatchScore,
  FisherObservation,
  FisherScheme,
  FisherSeriesResult,
  KWayMethod,
  KWayResult,
  MatchProbabilities,
  MultiCategoryOptions,
  MultiCategorySummary,
  NearMatchOptions,
  NearTopology,
  NonUniformMethod,
  NonUniformOptions,
  NonUniformResult,
  PlayingCard,
  SeriesClusteringOptions,
  SeriesClusteringResult,
  SeriesSpan,
} from './types.js'
