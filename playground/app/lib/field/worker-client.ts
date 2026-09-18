// Talking to app/workers/field-mc.worker.ts.
//
// One worker per job kind, so cancelling a scan statistic never kills an
// envelope that is still simulating. A cancel terminates the worker — the only
// way to stop a synchronous estimator mid-batch — and the next run starts a
// fresh one. Every worker is terminated when the page unmounts.

import type { FieldJobName, FieldJobRequest, FieldJobResponse, FieldJobs } from './jobs'

interface Pending {
  resolve: (value: never) => void
  reject: (reason: unknown) => void
  onProgress?: (fraction: number) => void
}

interface Channel {
  worker: Worker
  pending: Map<number, Pending>
}

const channels = new Map<FieldJobName, Channel>()
let nextId = 1

function abortError(): DOMException {
  return new DOMException('the run was cancelled', 'AbortError')
}

function open(job: FieldJobName): Channel {
  const existing = channels.get(job)
  if (existing) return existing
  const worker = new Worker(new URL('../../workers/field-mc.worker.ts', import.meta.url), {
    type: 'module',
  })
  const channel: Channel = { worker, pending: new Map() }
  worker.onmessage = (event: MessageEvent<FieldJobResponse>) => {
    const message = event.data
    const entry = channel.pending.get(message.id)
    if (!entry) return
    if ('progress' in message) {
      entry.onProgress?.(message.progress)
      return
    }
    channel.pending.delete(message.id)
    if (message.ok) {
      entry.resolve(message.result as never)
      return
    }
    // Rebuild the typed SDK error so ErrorAlert can show "FieldError (code)".
    const error = new Error(message.error.message)
    error.name = message.error.name
    Object.assign(error, {
      ...(message.error.code ? { code: message.error.code } : {}),
      ...(message.error.cause ? { cause: message.error.cause } : {}),
    })
    entry.reject(error)
  }
  worker.onerror = (event: ErrorEvent) => {
    const error = new Error(event.message || 'the field worker failed')
    error.name = 'WorkerError'
    for (const entry of channel.pending.values()) entry.reject(error)
    channel.pending.clear()
  }
  channels.set(job, channel)
  return channel
}

/** Terminate the worker for `job`, rejecting anything still in flight. */
export function closeFieldWorker(job: FieldJobName): void {
  const channel = channels.get(job)
  if (!channel) return
  channels.delete(job)
  for (const entry of channel.pending.values()) entry.reject(abortError())
  channel.pending.clear()
  channel.worker.terminate()
}

/** Terminate every field worker — call it when the demo unmounts. */
export function closeFieldWorkers(): void {
  for (const job of [...channels.keys()]) closeFieldWorker(job)
}

/**
 * Run one job in its worker. Aborting the signal terminates that worker and
 * rejects with `AbortError`, which `useTask` treats as a cancellation, not a
 * failure. `onProgress` receives the fraction of simulated fields finished.
 */
export function runFieldJob<K extends FieldJobName>(
  job: K,
  payload: FieldJobs[K]['payload'],
  signal?: AbortSignal,
  onProgress?: (fraction: number) => void,
): Promise<FieldJobs[K]['result']> {
  if (signal?.aborted) return Promise.reject(abortError())
  const channel = open(job)
  const id = nextId++
  const request: FieldJobRequest = { id, job, payload }
  return new Promise<FieldJobs[K]['result']>((resolve, reject) => {
    const onAbort = () => {
      closeFieldWorker(job)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    channel.pending.set(id, {
      ...(onProgress ? { onProgress } : {}),
      resolve: ((value: FieldJobs[K]['result']) => {
        signal?.removeEventListener('abort', onAbort)
        resolve(value)
      }) as (value: never) => void,
      reject: (error: unknown) => {
        signal?.removeEventListener('abort', onAbort)
        reject(error)
      },
    })
    channel.worker.postMessage(request)
  })
}
