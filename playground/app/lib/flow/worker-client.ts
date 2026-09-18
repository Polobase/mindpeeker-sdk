// Talking to app/workers/flow-analysis.worker.ts.
//
// One worker per job kind, so cancelling a lag scan never kills a surrogate
// ensemble that is still running. A cancel terminates the worker — the only way
// to stop a synchronous estimator — and the next run starts a fresh one.

import type { FlowJobName, FlowJobRequest, FlowJobResponse, FlowJobs } from './jobs'

interface Pending {
  resolve: (value: never) => void
  reject: (reason: unknown) => void
}

interface Channel {
  worker: Worker
  pending: Map<number, Pending>
}

const channels = new Map<FlowJobName, Channel>()
let nextId = 1

function abortError(): DOMException {
  return new DOMException('the run was cancelled', 'AbortError')
}

function open(job: FlowJobName): Channel {
  const existing = channels.get(job)
  if (existing) return existing
  const worker = new Worker(new URL('../../workers/flow-analysis.worker.ts', import.meta.url), {
    type: 'module',
  })
  const channel: Channel = { worker, pending: new Map() }
  worker.onmessage = (event: MessageEvent<FlowJobResponse>) => {
    const message = event.data
    const entry = channel.pending.get(message.id)
    if (!entry) return
    channel.pending.delete(message.id)
    if (message.ok) {
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
    const error = new Error(event.message || 'the flow worker failed')
    error.name = 'WorkerError'
    for (const entry of channel.pending.values()) entry.reject(error)
    channel.pending.clear()
  }
  channels.set(job, channel)
  return channel
}

/** Terminate the worker for `job`, rejecting anything still in flight. */
export function closeFlowWorker(job: FlowJobName): void {
  const channel = channels.get(job)
  if (!channel) return
  channels.delete(job)
  for (const entry of channel.pending.values()) entry.reject(abortError())
  channel.pending.clear()
  channel.worker.terminate()
}

/** Terminate every flow worker — call it when the demo unmounts. */
export function closeFlowWorkers(): void {
  for (const job of [...channels.keys()]) closeFlowWorker(job)
}

/**
 * Run one job in its worker. Aborting the signal terminates that worker and
 * rejects with `AbortError`, which `useTask` treats as a cancellation.
 */
export function runFlowJob<K extends FlowJobName>(
  job: K,
  payload: FlowJobs[K]['payload'],
  signal?: AbortSignal,
): Promise<FlowJobs[K]['result']> {
  if (signal?.aborted) return Promise.reject(abortError())
  const channel = open(job)
  const id = nextId++
  const request: FlowJobRequest = { id, job, payload }
  return new Promise<FlowJobs[K]['result']>((resolve, reject) => {
    const onAbort = () => {
      // The estimator is synchronous inside the worker: terminating is the
      // only way to get the thread back before it finishes.
      closeFlowWorker(job)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    channel.pending.set(id, {
      resolve: ((value: FlowJobs[K]['result']) => {
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
