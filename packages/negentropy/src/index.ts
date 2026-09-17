export type { NegentropyErrorCode, NegentropyErrorOptions } from './errors.js'

export { NegentropyError } from './errors.js'
export { autocorrelation } from './estimators/autocorrelation.js'
export {
  markovMinEntropyPerBit,
  mcvMinEntropy,
  shannonEntropy,
  toBits,
} from './estimators/entropy.js'
export { chiSquareBytes, monobit, runsTest, serialCorrelation } from './estimators/frequency.js'
export type { ContrastNegentropy, MomentNegentropy } from './estimators/negentropy.js'
export {
  EXP_GAUSSIAN_MEAN,
  EXP_GAUSSIAN_VARIANCE,
  EXP_NULL_VARIANCE,
  LOGCOSH_GAUSSIAN_MEAN,
  LOGCOSH_GAUSSIAN_VARIANCE,
  LOGCOSH_NULL_VARIANCE,
  negentropyExp,
  negentropyKurtosis,
  negentropyLogcosh,
} from './estimators/negentropy.js'
export type { DitherOptions } from './estimators/pipeline.js'
export { ditheredTrialZ, probitBytes } from './estimators/pipeline.js'
export { approximateEntropy, sampleEntropy } from './estimators/sample-entropy.js'
export type { SpectralEntropyOptions, SpectralTestOptions } from './estimators/spectral.js'
export { spectralEntropy, spectralTest } from './estimators/spectral.js'
export { negentropyVasicek, vasicekEntropy } from './estimators/vasicek.js'
export type {
  WindowedEstimator,
  WindowedNegentropyOptions,
  WindowedNegentropyPoint,
} from './estimators/windowed.js'
export { windowedNegentropy } from './estimators/windowed.js'
export { analyzeBytes, analyzeTrials } from './experiment/batch.js'
export { bonferroni, brownCompositeZ, compositeZ } from './experiment/composite.js'
export type { RegisteredExperiment } from './experiment/registration.js'
export {
  canonicalJson,
  EXPERIMENT_SCHEMA,
  registerExperiment,
} from './experiment/registration.js'
export type { Session, SessionOptions, SessionTick } from './experiment/session.js'
export { session } from './experiment/session.js'
export type {
  BeaconAnchor,
  EventResult,
  EventSpec,
  EventStatistic,
  EventStatus,
  ExperimentComposite,
  ExperimentConfig,
  ExperimentResult,
  Reanalysis,
  RegistrationAnchors,
  ResolvedExperimentConfig,
} from './experiment/types.js'
export type {
  AccountedBytes,
  DebiasAccountingOptions,
  EntropyClaim,
  PipelineOp,
  PipelineStep,
} from './extract/accounting.js'
export {
  claimBytes,
  conditionAccounted,
  debiasAccounted,
  extractAccounted,
  outputEntropy,
  vettedOutputEntropy,
} from './extract/accounting.js'
export type { ConditionStreamOptions } from './extract/condition.js'
export { conditionStream, hmacCondition, sha256Condition } from './extract/condition.js'
export { peres, peresRate, vonNeumann } from './extract/debias.js'
export type { BitDebiaser, DebiasMethod, DebiasStreamOptions } from './extract/debias-stream.js'
export { createDebiaser, debiasStream } from './extract/debias-stream.js'
export type { HealthAlarm, HealthConfig } from './extract/health.js'
export { aptCutoff, ContinuousHealth, rctCutoff } from './extract/health.js'
export type { ToeplitzExtractor } from './extract/toeplitz.js'
export { toeplitzExtractor, toeplitzOutputBits } from './extract/toeplitz.js'
export type { NetworkAutocorrelation } from './stats/autocorr-network.js'
export { networkAutocorrelation } from './stats/autocorr-network.js'
export type { BlockedResult, BlockingPoint, BlockOptions } from './stats/blocked.js'
export {
  blockedDevvar,
  blockedNetvar,
  blockingDecomposition,
  blockZ,
} from './stats/blocked.js'
export type { CalibrateOptions } from './stats/calibration.js'
export { calibrate, theoreticalCalibration } from './stats/calibration.js'
export type { CovarOptions } from './stats/covar.js'
export { covar } from './stats/covar.js'
export { cumulativeDeviation, significanceEnvelope } from './stats/cumdev.js'
export type { NormalMixtureOptions } from './stats/drift-martingale.js'
export { driftBoundary, driftLogM, driftMartingale } from './stats/drift-martingale.js'
export type { EpochOptions } from './stats/epoch.js'
export { epochAverage } from './stats/epoch.js'
export type { EProcessSide } from './stats/eprocess.js'
export { anytimeP, villeCrossing } from './stats/eprocess.js'
export type {
  DeviationBoundary,
  DeviationEnvelope,
  GammaMixtureOptions,
} from './stats/netvar-martingale.js'
export {
  anytimeEnvelope,
  netvarBoundary,
  netvarLogM,
  netvarMartingale,
} from './stats/netvar-martingale.js'
export type { PairCorrelation } from './stats/network.js'
export {
  clusteredNetvar,
  devvar,
  interSourceCorrelation,
  netvar,
  networkCoherence,
  onsiteVsGlobal,
} from './stats/network.js'
export type { Tail } from './stats/pvalues.js'
export { chiSquareP, normalP, P_FLOOR } from './stats/pvalues.js'
export type { TrialStreamConfig } from './stats/trials.js'
export { DEFAULT_BITS_PER_TRIAL, trialStream, trialsFromBytes } from './stats/trials.js'
export type { VarianceRatioResult } from './stats/variance-ratio.js'
export { varianceRatio } from './stats/variance-ratio.js'
export { stoufferZ, zScores } from './stats/zscores.js'
export type {
  Calibration,
  StatResult,
  Trial,
  TrialClock,
  TrialConfig,
  TrialSeries,
  TrialSource,
  TrialStreamOptions,
} from './types.js'
