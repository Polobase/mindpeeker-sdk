export type { NegentropyErrorCode, NegentropyErrorOptions } from './errors.js'

export { NegentropyError } from './errors.js'
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
