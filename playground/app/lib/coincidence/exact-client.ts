// Talking to app/workers/coincidence-exact.worker.ts.
//
// One shared worker for every exact k-fold and clustering job on the page. The
// SDK's engines are synchronous, so a cancel can only land between streamed
// table rows; anything still running after the grace period loses its worker
// and the next job starts a fresh one. Errors cross the wire as plain objects
// and are rehydrated into `Error`s carrying `code`, which `~/lib/errors` and
// `ErrorAlert` already understand.

import type {
  CoincidenceRequest,
  CoincidenceResponse,
  InvertResult,
  PointResult,
  TableRow,
} from '~/workers/coincidence-exact.worker'
import type { SeriesClusteringResult, SeriesSpan } from '@mindpeeker/coincidence'

/** How long a cancelled job may keep the thread before the worker is replaced. */
const CANCEL_GRACE_MS = 1500

interface Pending {
  resolve: (value: never) => void
  reject: (reason: unknown) => void
  onRow?: (row: TableRow, done: number, total: number) => void
}

let worker: Worker | undefined
let pending = new Map<number, Pending>()
let nextId = 1

function abortError(): DOMException {
  return new DOMException('the run was cancelled', 'AbortError')
}

function open(): Worker {
  if (worker) return worker
  const instance = new Worker(new URL('../../workers/coincidence-exact.worker.ts', import.meta.url), {
    type: 'module',
  })
  instance.onmessage = (event: MessageEvent<CoincidenceResponse>) => {
    const message = event.data
    const entry = pending.get(message.id)
    if (!entry) return
    if (message.kind === 'row') {
      entry.onRow?.(message.row, message.done, message.total)
      return
    }
    pending.delete(message.id)
    if (message.kind === 'ok') {
      entry.resolve(message.result as never)
      return
    }
    const error = new Error(message.error.message)
    error.name = message.error.name
    Object.assign(error, {
      ...(message.error.code ? { code: message.error.code } : {}),
      ...(message.error.argument ? { argument: message.error.argument } : {}),
    })
    entry.reject(error)
  }
  instance.onerror = (event: ErrorEvent) => {
    const error = new Error(event.message || 'the coincidence worker failed')
    error.name = 'WorkerError'
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
  }
  worker = instance
  return instance
}

/** Terminate the worker, rejecting anything still in flight. Call it on unmount. */
export function closeCoincidenceWorker(): void {
  const instance = worker
  worker = undefined
  for (const entry of pending.values()) entry.reject(abortError())
  pending = new Map()
  instance?.terminate()
}

interface RunOptions {
  signal?: AbortSignal
  onRow?: (row: TableRow, done: number, total: number) => void
}

function run<T>(request: Omit<CoincidenceRequest, 'id'>, opts: RunOptions = {}): Promise<T> {
  const { signal, onRow } = opts
  if (signal?.aborted) return Promise.reject(abortError())
  const instance = open()
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    let watchdog: ReturnType<typeof setTimeout> | undefined
    const settle = () => {
      signal?.removeEventListener('abort', onAbort)
      if (watchdog !== undefined) clearTimeout(watchdog)
    }
    function onAbort(): void {
      instance.postMessage({ id, cancel: true })
      watchdog = setTimeout(() => {
        if (pending.has(id)) closeCoincidenceWorker()
      }, CANCEL_GRACE_MS)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    pending.set(id, {
      ...(onRow ? { onRow } : {}),
      resolve: ((value: T) => {
        settle()
        resolve(value)
      }) as (value: never) => void,
      reject: (error: unknown) => {
        settle()
        reject(error)
      },
    })
    instance.postMessage({ ...request, id } as CoincidenceRequest)
  })
}

/** Exact `kWayProbabilities(n, categories, k)` next to `kWayMatchApprox`. */
export function kWayPoint(
  n: number,
  categories: number | readonly number[],
  k: number,
  opts?: RunOptions,
): Promise<PointResult> {
  return run<PointResult>({ kind: 'point', n, categories, k }, opts)
}

/** Exact `peopleForKWayMatch(p, categories, k)` next to the D–M root. */
export function kWayInvert(
  p: number,
  categories: number | readonly number[],
  k: number,
  opts?: RunOptions,
): Promise<InvertResult> {
  return run<InvertResult>({ kind: 'invert', p, categories, k }, opts)
}

/** Levin's table, one fold size at a time — `onRow` fires as each row lands. */
export function kWayTable(
  ks: readonly number[],
  c: number,
  p: number,
  opts: RunOptions,
): Promise<null> {
  return run<null>({ kind: 'table', ks, c, p }, opts)
}

/** Exact `seriesClustering(times, options)`. */
export function clusterSeries(
  times: readonly number[],
  window: number,
  span: SeriesSpan,
  rate: number | undefined,
  opts?: RunOptions,
): Promise<SeriesClusteringResult> {
  return run<SeriesClusteringResult>(
    { kind: 'series', times, window, span, ...(rate === undefined ? {} : { rate }) },
    opts,
  )
}

export type { InvertResult, PointResult, TableRow }
