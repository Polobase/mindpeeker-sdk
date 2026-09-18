// The four Monte-Carlo jobs heavy enough to deserve a Web Worker, and the
// messages that carry them. Type-only SDK imports — nothing of the SDK
// survives here at runtime, so the file is safe for the worker and the client.

import type {
  Bandwidth,
  FieldRegion,
  KCorrection,
  KDenominator,
  Point,
  ScanCluster,
} from '@mindpeeker/field'
import type { DrawAccounting } from './types'

export interface RadiusChoice {
  /** Explicit neighbourhood radius, or undefined to derive it from `expectedNeighbours`. */
  radius?: number
  /** Target interior CSR expectation (n−1)πr²/A. Default 4. */
  expectedNeighbours?: number
}

interface BasePayload {
  points: readonly Point[]
  region: FieldRegion
  runs: number
  /** runs × points × 8 bytes for the simulated CSR fields. */
  bytes: Uint8Array
}

export interface SignificancePayload extends BasePayload, RadiusChoice {}

export interface ExtremeResult {
  neighbours: number
  rank: number
  p: number
}

export interface SignificanceResult {
  attractor: ExtremeResult
  void: ExtremeResult
  radius: number
  expectedNeighbours: number
  runs: number
  accounting: DrawAccounting
  elapsedMs: number
}

export interface EnvelopePayload extends BasePayload {
  radii: readonly number[]
  correction: KCorrection
  denominator: KDenominator
  alpha: number
}

export interface EnvelopeResult {
  radii: Float64Array
  observed: Float64Array
  mean: Float64Array
  lo: Float64Array
  hi: Float64Array
  globalLower?: Float64Array
  globalUpper?: Float64Array
  pointwiseP: Float64Array
  globalP: number
  globalRank: number
  globalInterval: [number, number]
  madStatistic: number
  madP: number
  alpha: number
  runs: number
  correction: KCorrection
  denominator: KDenominator
  accounting: DrawAccounting
  elapsedMs: number
}

export interface KdePayload extends BasePayload {
  bandwidth: Bandwidth
  grid: number
  extent: 'region' | 'data'
}

/** The density surface, as `kernelDensity` returns it. */
export interface KdeGrid {
  gx: number
  gy: number
  xs: Float64Array
  ys: Float64Array
  values: Float64Array
  inside: Uint8Array
  covariance: [number, number, number]
}

export interface KdeExtremeResult {
  x: number
  y: number
  density: number
  /** Only present when `runs > 0`. */
  rank?: number
  p?: number
}

export interface KdeResult {
  grid: KdeGrid
  attractor: KdeExtremeResult
  void: KdeExtremeResult
  /** 0 when only the surface was asked for. */
  runs: number
  accounting: DrawAccounting
  elapsedMs: number
}

export interface ScanPayload extends BasePayload {
  maxFraction: number
}

export interface ScanResult {
  cluster?: ScanCluster
  llr: number
  rank: number
  pValue: number
  runs: number
  accounting: DrawAccounting
  elapsedMs: number
}

export interface FieldJobs {
  significance: { payload: SignificancePayload; result: SignificanceResult }
  envelope: { payload: EnvelopePayload; result: EnvelopeResult }
  kde: { payload: KdePayload; result: KdeResult }
  scan: { payload: ScanPayload; result: ScanResult }
}

export type FieldJobName = keyof FieldJobs

export interface FieldJobRequest {
  id: number
  job: FieldJobName
  payload: FieldJobs[FieldJobName]['payload']
}

export interface FieldJobFailure {
  name: string
  code?: string
  message: string
  cause?: string
}

export type FieldJobResponse =
  | { id: number; ok: true; result: FieldJobs[FieldJobName]['result'] }
  | { id: number; ok: false; error: FieldJobFailure }
  | { id: number; progress: number }

/** Zero accounting, for the running total a batched job sums into. */
export function emptyAccounting(): DrawAccounting {
  return { bytesConsumed: 0, bitsUsed: 0, bytesFetched: 0 }
}

export function addAccounting(total: DrawAccounting, part: DrawAccounting): DrawAccounting {
  return {
    bytesConsumed: total.bytesConsumed + part.bytesConsumed,
    bitsUsed: total.bitsUsed + part.bitsUsed,
    bytesFetched: (total.bytesFetched ?? 0) + (part.bytesFetched ?? part.bytesConsumed),
  }
}
