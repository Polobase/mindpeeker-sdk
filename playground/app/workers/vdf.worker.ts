/// <reference lib="webworker" />
// Verifiable-delay work off the main thread.
//
// A VDF is a deliberately slow computation: T sequential squarings of a
// 2048-bit integer. It cannot be made fast, so it must be made non-blocking —
// every job here runs in this worker and reports progress back. The SDK yields
// to the event loop every ~16k work units, so a `cancel` message posted from the
// page is received mid-run and turned into an AbortSignal the SDK honours
// (`VdfError('aborted')`).
//
// A worker may import `@mindpeeker/*` directly: the Vite aliases and the
// js-to-ts plugin are applied to the worker build.

import { VdfError } from '@mindpeeker/vdf'
import type {
  CalibratePayload,
  ForgeryPayload,
  JobFailure,
  ModulusPayload,
  PipelinePayload,
  SealPayload,
  VdfCancelRequest,
  VdfJobRequest,
  VdfJobResponse,
} from '../lib/vdf/jobs'
import { runCalibrate, runForgery, runModulusChecks, runPipeline, runSeal } from '../lib/vdf/run'

const scope = self as unknown as DedicatedWorkerGlobalScope

/** Progress posts are throttled: the SDK calls back every 1024 squarings. */
const PROGRESS_MS = 60

const controllers = new Map<number, AbortController>()

function failure(error: unknown): JobFailure {
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

function post(message: VdfJobResponse): void {
  scope.postMessage(message)
}

function reporter(id: number): (phase: string, fraction: number | null) => void {
  let last = 0
  let lastPhase = ''
  return (phase, fraction) => {
    const now = performance.now()
    if (phase === lastPhase && now - last < PROGRESS_MS) return
    last = now
    lastPhase = phase
    post({ id, kind: 'progress', phase, fraction })
  }
}

async function dispatch(request: VdfJobRequest, signal: AbortSignal): Promise<unknown> {
  const report = reporter(request.id)
  switch (request.job) {
    case 'pipeline':
      return runPipeline(request.payload as PipelinePayload, signal, report)
    case 'forgery':
      return runForgery(request.payload as ForgeryPayload, signal, report)
    case 'modulus':
      return runModulusChecks(request.payload as ModulusPayload, report)
    case 'seal':
      return runSeal(request.payload as SealPayload, signal, report)
    case 'calibrate':
      return runCalibrate(request.payload as CalibratePayload, signal, report)
    default:
      throw new VdfError('invalid_input', `unknown vdf job: ${String(request.job)}`)
  }
}

scope.onmessage = (event: MessageEvent<VdfJobRequest | VdfCancelRequest>) => {
  const message = event.data
  if ('cancel' in message) {
    controllers.get(message.id)?.abort(new DOMException('the run was cancelled', 'AbortError'))
    return
  }
  const controller = new AbortController()
  controllers.set(message.id, controller)
  void (async () => {
    try {
      const result = await dispatch(message, controller.signal)
      post({ id: message.id, kind: 'ok', result })
    } catch (error) {
      post({ id: message.id, kind: 'error', error: failure(error) })
    } finally {
      controllers.delete(message.id)
    }
  })()
}
