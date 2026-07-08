export type { NegentropyErrorCode, NegentropyErrorOptions } from './errors.js'

export { NegentropyError } from './errors.js'
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
export { negentropyVasicek, vasicekEntropy } from './estimators/vasicek.js'
export type {
  WindowedEstimator,
  WindowedNegentropyOptions,
  WindowedNegentropyPoint,
} from './estimators/windowed.js'
export { windowedNegentropy } from './estimators/windowed.js'
export type {
  AccountedBytes,
  EntropyClaim,
  PipelineOp,
  PipelineStep,
} from './extract/accounting.js'
export {
  claimBytes,
  conditionAccounted,
  debiasAccounted,
  extractAccounted,
  vettedOutputEntropy,
} from './extract/accounting.js'
export type { ConditionStreamOptions } from './extract/condition.js'
export { conditionStream, hmacCondition, sha256Condition } from './extract/condition.js'
export { peres, peresRate, vonNeumann } from './extract/debias.js'
export type { HealthAlarm, HealthConfig } from './extract/health.js'
export { aptCutoff, ContinuousHealth, rctCutoff } from './extract/health.js'
export type { ToeplitzExtractor } from './extract/toeplitz.js'
export { toeplitzExtractor, toeplitzOutputBits } from './extract/toeplitz.js'
export type { CalibrateOptions } from './stats/calibration.js'
export { calibrate, theoreticalCalibration } from './stats/calibration.js'
export { cumulativeDeviation, significanceEnvelope } from './stats/cumdev.js'
export type { PairCorrelation } from './stats/network.js'
export { devvar, interSourceCorrelation, netvar } from './stats/network.js'
export type { Tail } from './stats/pvalues.js'
export { chiSquareP, normalP, P_FLOOR } from './stats/pvalues.js'
export type { TrialStreamConfig } from './stats/trials.js'
export { DEFAULT_BITS_PER_TRIAL, trialStream, trialsFromBytes } from './stats/trials.js'
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
