/**
 * The two exact computations of `@mindpeeker/coincidence` that are long enough
 * to freeze a tab: the k-fold engine (categories × n × k operations — Levin's
 * whole Table 3 costs over a second) and `seriesClustering`, whose conditional
 * p-value runs the same engine.
 *
 * Everything the SDK does here is synchronous, so cancellation can only be
 * observed between table rows; the client terminates the worker when a job
 * does not stop in time.
 */
import {
  type KWayResult,
  kWayMatchApprox,
  kWayProbabilities,
  peopleForKWayMatch,
  peopleForKWayMatchApprox,
  type SeriesClusteringResult,
  type SeriesSpan,
  seriesClustering,
} from '@mindpeeker/coincidence'

/** One exact k-fold probability at a given n. */
export interface PointRequest {
  readonly id: number
  readonly kind: 'point'
  readonly n: number
  readonly categories: number | readonly number[]
  readonly k: number
}

/** The smallest n reaching probability p — an exact inversion. */
export interface InvertRequest {
  readonly id: number
  readonly kind: 'invert'
  readonly p: number
  readonly categories: number | readonly number[]
  readonly k: number
}

/** Levin's table: one row per fold size, streamed as it lands. */
export interface TableRequest {
  readonly id: number
  readonly kind: 'table'
  readonly ks: readonly number[]
  readonly c: number
  readonly p: number
}

export interface SeriesRequest {
  readonly id: number
  readonly kind: 'series'
  readonly times: readonly number[]
  readonly window: number
  readonly span: SeriesSpan
  readonly rate?: number
}

export interface CancelRequest {
  readonly id: number
  readonly cancel: true
}

export type CoincidenceRequest =
  | PointRequest
  | InvertRequest
  | TableRequest
  | SeriesRequest
  | CancelRequest

/** One row of the reproduced Levin table. */
export interface TableRow {
  readonly k: number
  /** Smallest n with exact P(k-fold match) ≥ p. */
  readonly n: number
  /** The exact probability at that n. */
  readonly match: number
  readonly method: KWayResult['method']
  /** Diaconis–Mosteller eq. 7.5 root at the same p. */
  readonly approxN: number
  /** Their curve fit 47(k − 1.5)^{3/2}. */
  readonly fitN: number
  /** Milliseconds this row cost. */
  readonly ms: number
}

export interface PointResult extends KWayResult {
  /** `kWayMatchApprox` at the same (n, c, k), or null for a probability vector. */
  readonly approx: number | null
  readonly ms: number
}

export interface InvertResult {
  readonly n: number
  readonly match: number
  readonly method: KWayResult['method']
  readonly approxN: number | null
  readonly ms: number
}

export type CoincidenceResponse =
  | { readonly id: number; readonly kind: 'row'; readonly row: TableRow; readonly done: number; readonly total: number }
  | { readonly id: number; readonly kind: 'ok'; readonly result: unknown }
  | {
      readonly id: number
      readonly kind: 'error'
      readonly error: { name: string; code?: string; message: string; argument?: string }
    }

const cancelled = new Set<number>()

function post(message: CoincidenceResponse): void {
  ;(self as unknown as Worker).postMessage(message)
}

function describe(err: unknown): { name: string; code?: string; message: string; argument?: string } {
  if (err instanceof Error) {
    const record = err as Error & { code?: unknown; argument?: unknown }
    return {
      name: err.name || 'Error',
      ...(typeof record.code === 'string' ? { code: record.code } : {}),
      message: err.message,
      ...(typeof record.argument === 'string' ? { argument: record.argument } : {}),
    }
  }
  return { name: 'Error', message: String(err) }
}

/** Hand the worker's own event loop back so a `cancel` message can be read. */
function drain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function equalCategories(categories: number | readonly number[]): number | null {
  return typeof categories === 'number' ? categories : null
}

async function runTable(request: TableRequest): Promise<void> {
  const total = request.ks.length
  let done = 0
  for (const k of request.ks) {
    if (cancelled.has(request.id)) return
    const started = performance.now()
    const n = peopleForKWayMatch(request.p, request.c, k)
    const match = kWayProbabilities(n, request.c, k)
    post({
      id: request.id,
      kind: 'row',
      row: {
        k,
        n,
        match: match.match,
        method: match.method,
        approxN: peopleForKWayMatchApprox(request.p, request.c, k),
        fitN: 47 * (k - 1.5) ** 1.5,
        ms: performance.now() - started,
      },
      done: ++done,
      total,
    })
    await drain()
  }
  if (!cancelled.has(request.id)) post({ id: request.id, kind: 'ok', result: null })
}

self.onmessage = (event: MessageEvent<CoincidenceRequest>) => {
  const request = event.data
  if ('cancel' in request) {
    cancelled.add(request.id)
    return
  }
  void (async () => {
    try {
      const started = performance.now()
      if (request.kind === 'table') {
        await runTable(request)
        return
      }
      if (request.kind === 'point') {
        const exact = kWayProbabilities(request.n, request.categories, request.k)
        const c = equalCategories(request.categories)
        const result: PointResult = {
          ...exact,
          approx: c === null ? null : kWayMatchApprox(request.n, c, request.k),
          ms: performance.now() - started,
        }
        post({ id: request.id, kind: 'ok', result })
        return
      }
      if (request.kind === 'invert') {
        const n = peopleForKWayMatch(request.p, request.categories, request.k)
        const at = kWayProbabilities(n, request.categories, request.k)
        const c = equalCategories(request.categories)
        const result: InvertResult = {
          n,
          match: at.match,
          method: at.method,
          approxN: c === null ? null : peopleForKWayMatchApprox(request.p, c, request.k),
          ms: performance.now() - started,
        }
        post({ id: request.id, kind: 'ok', result })
        return
      }
      const result: SeriesClusteringResult = seriesClustering(request.times as number[], {
        window: request.window,
        span: request.span,
        ...(request.rate === undefined ? {} : { rate: request.rate }),
      })
      post({ id: request.id, kind: 'ok', result })
    } catch (error) {
      if (!cancelled.has(request.id)) post({ id: request.id, kind: 'error', error: describe(error) })
    } finally {
      cancelled.delete(request.id)
    }
  })()
}
