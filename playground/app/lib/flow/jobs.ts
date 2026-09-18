// The two jobs heavy enough to deserve a Web Worker: the surrogate ensemble and
// the lag scan. Type-only SDK imports — nothing of the SDK survives here at
// runtime, so this file is safe for the worker and the client alike.

import type {
  ChiSquareTestResult,
  EffectiveTransferEntropyResult,
  SurrogateInfo,
  TransferEntropyReport,
  TransferEntropyByLagResult,
} from '@mindpeeker/flow'
import type { SurrogateMethodName } from './types'

export interface SurrogateConfig {
  method: SurrogateMethodName
  /** Ensemble size; the smallest reachable p is 1/(surrogates + 1). */
  surrogates: number
  seed: number
  /** `blockShuffle` only. */
  blockSize?: number
  /** `stationaryBootstrap` only. */
  meanBlockSize?: number
  /** `markov` only. */
  markovOrder?: number
}

export interface EmbeddingConfig {
  k: number
  l: number
  lag: number
  millerMadow: boolean
}

export interface SignificancePayload {
  x: Uint8Array
  y: Uint8Array
  embedding: EmbeddingConfig
  surrogate: SurrogateConfig
  /** Shuffles averaged into `effectiveTransferEntropy`. */
  eteSurrogates: number
}

export interface SignificanceResult {
  te: number
  /** The surrogate TE ensemble, in generation order. */
  ensemble: Float64Array
  p: number
  mean: number
  sd: number
  z: number
  distinct: number
  info: SurrogateInfo
  chi: ChiSquareTestResult
  ete: EffectiveTransferEntropyResult
  report: TransferEntropyReport
  elapsedMs: number
}

export interface LagScanPayload {
  x: Uint8Array
  y: Uint8Array
  embedding: Omit<EmbeddingConfig, 'lag'>
  minLag: number
  maxLag: number
  alpha: number
  surrogate: SurrogateConfig
}

export interface LagScanResult {
  scan: TransferEntropyByLagResult
  elapsedMs: number
}

export interface FlowJobs {
  significance: { payload: SignificancePayload; result: SignificanceResult }
  lagScan: { payload: LagScanPayload; result: LagScanResult }
}

export type FlowJobName = keyof FlowJobs

export interface FlowJobRequest {
  id: number
  job: FlowJobName
  payload: SignificancePayload | LagScanPayload
}

export interface FlowJobFailure {
  name: string
  code?: string
  message: string
  cause?: string
}

export type FlowJobResponse =
  | { id: number; ok: true; result: SignificanceResult | LagScanResult }
  | { id: number; ok: false; error: FlowJobFailure }

/**
 * Method-specific options must not be passed without their method — the SDK
 * rejects that with `invalid_input`, on purpose.
 */
export function surrogateOptions(config: SurrogateConfig): Record<string, unknown> {
  const base: Record<string, unknown> = {
    surrogate: config.method,
    surrogates: config.surrogates,
    seed: config.seed,
  }
  if (config.method === 'blockShuffle' && config.blockSize) base.blockSize = config.blockSize
  if (config.method === 'stationaryBootstrap' && config.meanBlockSize) {
    base.meanBlockSize = config.meanBlockSize
  }
  if (config.method === 'markov' && config.markovOrder) base.markovOrder = config.markovOrder
  return base
}
