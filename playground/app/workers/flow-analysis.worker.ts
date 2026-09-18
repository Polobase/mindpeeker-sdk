/// <reference lib="webworker" />
// Surrogate ensembles and lag scans off the main thread.
//
// A worker may import `@mindpeeker/*` directly (the Vite aliases and the
// js-to-ts plugin are applied to the worker build). Both jobs are synchronous
// inside the SDK — hundreds of milliseconds at 999 surrogates — so they run
// here and a cancel terminates the worker rather than waiting for them.

import {
  chiSquareTest,
  effectiveTransferEntropy,
  permutationTest,
  transferEntropyByLag,
  transferEntropyReport,
} from '@mindpeeker/flow'
import type {
  FlowJobFailure,
  FlowJobRequest,
  FlowJobResponse,
  LagScanPayload,
  LagScanResult,
  SignificancePayload,
  SignificanceResult,
} from '../lib/flow/jobs'
import { surrogateOptions } from '../lib/flow/jobs'

const scope = self as unknown as DedicatedWorkerGlobalScope

function failure(error: unknown): FlowJobFailure {
  if (error instanceof Error) {
    const record = error as Error & { code?: unknown; cause?: unknown }
    return {
      name: error.name || 'Error',
      ...(typeof record.code === 'string' ? { code: record.code } : {}),
      message: error.message,
      ...(record.cause instanceof Error
        ? { cause: `${record.cause.name}: ${record.cause.message}` }
        : typeof record.cause === 'string'
          ? { cause: record.cause }
          : {}),
    }
  }
  return { name: 'Error', message: String(error) }
}

function significance(payload: SignificancePayload): SignificanceResult {
  const started = performance.now()
  const { x, y, embedding, surrogate } = payload
  // The page's series are binary; fixing the alphabet makes the validation and
  // the χ² degrees of freedom explicit instead of inferred.
  const base = {
    k: embedding.k,
    l: embedding.l,
    lag: embedding.lag,
    alphabet: 2,
    millerMadow: embedding.millerMadow,
  }
  const nullOptions = surrogateOptions(surrogate)
  const perm = permutationTest(x, y, { ...base, ...nullOptions })
  const chi = chiSquareTest(x, y, base)
  const ete = effectiveTransferEntropy(x, y, {
    ...base,
    surrogates: payload.eteSurrogates,
    seed: surrogate.seed,
  })
  const report = transferEntropyReport(x, y, { ...base, ...nullOptions })
  return {
    te: perm.te,
    ensemble: perm.surrogates,
    p: perm.p,
    mean: perm.mean,
    sd: perm.sd,
    z: perm.z,
    distinct: perm.distinct,
    info: perm.surrogate,
    chi,
    ete,
    report,
    elapsedMs: performance.now() - started,
  }
}

function lagScan(payload: LagScanPayload): LagScanResult {
  const started = performance.now()
  const { x, y, embedding, surrogate } = payload
  const scan = transferEntropyByLag(x, y, {
    k: embedding.k,
    l: embedding.l,
    alphabet: 2,
    millerMadow: embedding.millerMadow,
    minLag: payload.minLag,
    maxLag: payload.maxLag,
    alpha: payload.alpha,
    ...surrogateOptions(surrogate),
  })
  return { scan, elapsedMs: performance.now() - started }
}

scope.onmessage = (event: MessageEvent<FlowJobRequest>) => {
  const request = event.data
  let response: FlowJobResponse
  try {
    const result =
      request.job === 'significance'
        ? significance(request.payload as SignificancePayload)
        : lagScan(request.payload as LagScanPayload)
    response = { id: request.id, ok: true, result }
  } catch (error) {
    response = { id: request.id, ok: false, error: failure(error) }
  }
  scope.postMessage(response)
}
