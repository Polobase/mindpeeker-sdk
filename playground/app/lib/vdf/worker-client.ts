// Talking to app/workers/vdf.worker.ts.
//
// One worker per job kind, so cancelling a 2^18 pipeline never disturbs a
// calibration that is still measuring. Cancelling posts a `cancel` message and
// the worker aborts the SDK's AbortSignal — the run really ends in
// `VdfError('aborted')` rather than being killed. `checkModulus` and the forgery
// folds are synchronous inside the SDK, so a watchdog terminates the worker when
// it does not acknowledge in time and the next run starts a fresh one.

import type { VdfCancelRequest, VdfJobName, VdfJobRequest, VdfJobResponse, VdfJobs } from './jobs'

/** How long a cancelled job may keep running before its worker is terminated. */
const CANCEL_GRACE_MS = 1200

interface Pending {
  resolve: (value: never) => void
  reject: (reason: unknown) => void
  onProgress?: (phase: string, fraction: number | null) => void
}

interface Channel {
  worker: Worker
  pending: Map<number, Pending>
}

const channels = new Map<VdfJobName, Channel>()
let nextId = 1

function abortError(): DOMException {
  return new DOMException('the run was cancelled', 'AbortError')
}

function open(job: VdfJobName): Channel {
  const existing = channels.get(job)
  if (existing) return existing
  const worker = new Worker(new URL('../../workers/vdf.worker.ts', import.meta.url), {
    type: 'module',
  })
  const channel: Channel = { worker, pending: new Map() }
  worker.onmessage = (event: MessageEvent<VdfJobResponse>) => {
    const message = event.data
    const entry = channel.pending.get(message.id)
    if (!entry) return
    if (message.kind === 'progress') {
      entry.onProgress?.(message.phase, message.fraction)
      return
    }
    channel.pending.delete(message.id)
    if (message.kind === 'ok') {
      entry.resolve(message.result as never)
      return
    }
    const error = new Error(message.error.message)
    error.name = message.error.name
    Object.assign(error, {
      ...(message.error.code ? { code: message.error.code } : {}),
      ...(message.error.cause ? { cause: message.error.cause } : {}),
    })
    entry.reject(error)
  }
  worker.onerror = (event: ErrorEvent) => {
    const error = new Error(event.message || 'the vdf worker failed')
    error.name = 'WorkerError'
    for (const entry of channel.pending.values()) entry.reject(error)
    channel.pending.clear()
  }
  channels.set(job, channel)
  return channel
}

/** Terminate the worker for `job`, rejecting anything still in flight. */
export function closeVdfWorker(job: VdfJobName): void {
  const channel = channels.get(job)
  if (!channel) return
  channels.delete(job)
  for (const entry of channel.pending.values()) entry.reject(abortError())
  channel.pending.clear()
  channel.worker.terminate()
}

/** Terminate every vdf worker — call it when the demo unmounts. */
export function closeVdfWorkers(): void {
  for (const job of [...channels.keys()]) closeVdfWorker(job)
}

export interface RunJobOptions {
  signal?: AbortSignal
  onProgress?: (phase: string, fraction: number | null) => void
}

/**
 * Run one job in its worker. Aborting the signal asks the worker to abort the
 * SDK's signal and rejects with `AbortError`, which `useTask` treats as a
 * cancellation rather than a failure.
 */
export function runVdfJob<K extends VdfJobName>(
  job: K,
  payload: VdfJobs[K]['payload'],
  opts: RunJobOptions = {},
): Promise<VdfJobs[K]['result']> {
  const { signal, onProgress } = opts
  if (signal?.aborted) return Promise.reject(abortError())
  const channel = open(job)
  const id = nextId++
  const request: VdfJobRequest = { id, job, payload }
  return new Promise<VdfJobs[K]['result']>((resolve, reject) => {
    let watchdog: ReturnType<typeof setTimeout> | undefined
    const settle = () => {
      signal?.removeEventListener('abort', onAbort)
      if (watchdog !== undefined) clearTimeout(watchdog)
    }
    function onAbort(): void {
      const cancel: VdfCancelRequest = { id, cancel: true }
      channel.worker.postMessage(cancel)
      // Synchronous stretches inside the SDK cannot observe the signal: if the
      // job has not ended by then, take the thread back the only other way.
      watchdog = setTimeout(() => {
        if (channel.pending.has(id)) closeVdfWorker(job)
      }, CANCEL_GRACE_MS)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    channel.pending.set(id, {
      ...(onProgress ? { onProgress } : {}),
      resolve: ((value: VdfJobs[K]['result']) => {
        settle()
        resolve(value)
      }) as (value: never) => void,
      reject: (error: unknown) => {
        settle()
        reject(error)
      },
    })
    channel.worker.postMessage(request)
  })
}
