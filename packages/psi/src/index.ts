export type { BetaPrior } from './bayes/binomial.js'
export { binomialBayesFactor } from './bayes/binomial.js'
export type { PsiErrorCode, PsiErrorOptions } from './errors.js'
export { PsiError } from './errors.js'
export type { AnalyzeEventOptions, EventWindow, GcpEventResult } from './gcp/event.js'
export { analyzeEvent } from './gcp/event.js'
export type { RollingOptions, RollingPoint } from './monitor/rolling.js'
export { rollingNetvar, rollingStouffer } from './monitor/rolling.js'
export type {
  PresentimentAnalysis,
  PresentimentEpoch,
  PresentimentPlan,
  WindowEffect,
} from './protocol/presentiment.js'
export { analyzePresentiment, presentimentEpochs } from './protocol/presentiment.js'
export type {
  IntentionSummary,
  RunTripolarOptions,
  TripolarAnalysis,
  TripolarPlan,
  TripolarRun,
} from './protocol/tripolar.js'
export { analyzeTripolar, INTENTIONS, runTripolar } from './protocol/tripolar.js'
export type { RecordSessionOptions, SessionRecordLine } from './record/jsonl.js'
export {
  parseRecordLine,
  readSession,
  recordSession,
  serializeRecordLine,
} from './record/jsonl.js'
export type { LabelShuffleOptions, Surrogate, SurrogateOptions } from './resample/surrogates.js'
export {
  labelShuffleSurrogates,
  permutationP,
  timeOffsetSurrogates,
} from './resample/surrogates.js'
export type {
  Intention,
  StatResult,
  Stimulus,
  Trial,
  TrialSeries,
  TrialSource,
  TrialStreamOptions,
} from './types.js'
