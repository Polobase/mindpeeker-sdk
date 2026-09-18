/// <reference lib="webworker" />
// Complete-spatial-randomness Monte Carlo off the main thread.
//
// A worker may import `@mindpeeker/*` directly (the Vite aliases and the
// js-to-ts plugin are applied to the worker build). Every job here simulates
// hundreds of CSR fields synchronously inside the SDK, which is far past the
// 200 ms budget of the UI thread — so it runs here, and a cancel terminates
// the worker rather than waiting for it.
//
// Three of the four jobs run in batches: each batch ranks the SAME observed
// statistic against fresh simulated fields, so the counts add up to exactly
// the rank one call with `runs` simulations would have produced,
// p = (1 + #{at least as extreme}) / (runs + 1). That buys real progress
// without changing the test. The envelope cannot be split that way (its
// global rank and MAD tests need every curve at once), so it runs in one call.

import {
  csrEnvelope,
  fieldSignificance,
  kdeAttractor,
  kdeSignificance,
  kdeVoid,
  kernelDensity,
  scanStatistic,
} from '@mindpeeker/field'
import {
  addAccounting,
  emptyAccounting,
  type EnvelopePayload,
  type EnvelopeResult,
  type FieldJobFailure,
  type FieldJobRequest,
  type FieldJobResponse,
  type FieldJobs,
  type KdePayload,
  type KdeResult,
  type ScanPayload,
  type ScanResult,
  type SignificancePayload,
  type SignificanceResult,
} from '../lib/field/jobs'
import { BYTES_PER_POINT, type DrawAccounting, runBatches } from '../lib/field/types'

const scope = self as unknown as DedicatedWorkerGlobalScope

function failure(error: unknown): FieldJobFailure {
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

/** The byte slice one batch of `m` simulated fields of `n` points consumes. */
function slice(bytes: Uint8Array, offset: number, m: number, n: number): Uint8Array {
  return bytes.slice(offset, offset + m * n * BYTES_PER_POINT)
}

function batchOf(m: number, n: number): number {
  return m * n * BYTES_PER_POINT
}

type Report = (done: number, total: number) => void

async function significance(
  payload: SignificancePayload,
  report: Report,
): Promise<SignificanceResult> {
  const started = performance.now()
  const { points, region, runs, bytes } = payload
  const n = points.length
  const radiusOpts = {
    ...(payload.radius !== undefined ? { radius: payload.radius } : {}),
    ...(payload.expectedNeighbours !== undefined
      ? { expectedNeighbours: payload.expectedNeighbours }
      : {}),
  }
  let offset = 0
  let done = 0
  let maxExtra = 0
  let minExtra = 0
  let accounting: DrawAccounting = emptyAccounting()
  let last: Awaited<ReturnType<typeof fieldSignificance>> | undefined
  for (const m of runBatches(runs)) {
    const result = await fieldSignificance(slice(bytes, offset, m, n), points, region, {
      ...radiusOpts,
      runs: m,
    })
    offset += batchOf(m, n)
    done += m
    maxExtra += result.attractor.rank - 1
    minExtra += result.void.rank - 1
    accounting = addAccounting(accounting, result.accounting)
    last = result
    report(done, runs)
  }
  if (!last) throw new Error('no simulation ran')
  return {
    attractor: { neighbours: last.attractor.neighbours, rank: 1 + maxExtra, p: (1 + maxExtra) / (runs + 1) },
    void: { neighbours: last.void.neighbours, rank: 1 + minExtra, p: (1 + minExtra) / (runs + 1) },
    radius: last.radius,
    expectedNeighbours: last.expectedNeighbours,
    runs,
    accounting,
    elapsedMs: performance.now() - started,
  }
}

async function envelope(payload: EnvelopePayload, report: Report): Promise<EnvelopeResult> {
  const started = performance.now()
  const { points, region, radii, runs, bytes, correction, denominator, alpha } = payload
  report(0, runs)
  const env = await csrEnvelope(points, bytes, region, [...radii], {
    runs,
    correction,
    denominator,
    alpha,
  })
  report(runs, runs)
  return {
    radii: env.radii,
    observed: env.observed,
    mean: env.mean,
    lo: env.lo,
    hi: env.hi,
    ...(env.global.rank.lower ? { globalLower: env.global.rank.lower } : {}),
    ...(env.global.rank.upper ? { globalUpper: env.global.rank.upper } : {}),
    pointwiseP: env.pointwiseP,
    globalP: env.global.p,
    globalRank: env.global.rank.rank,
    globalInterval: [env.global.rank.pInterval[0], env.global.rank.pInterval[1]],
    madStatistic: env.global.mad.statistic,
    madP: env.global.mad.p,
    alpha: env.global.rank.alpha,
    runs: env.runs,
    correction: env.correction,
    denominator: env.denominator,
    accounting: env.accounting,
    elapsedMs: performance.now() - started,
  }
}

async function kde(payload: KdePayload, report: Report): Promise<KdeResult> {
  const started = performance.now()
  const { points, region, runs, bytes, bandwidth, grid, extent } = payload
  const n = points.length
  const options = { bandwidth, grid, extent }
  // The surface the heatmap paints — computed once, whatever the run count.
  const surface = kernelDensity(points, region, options)
  const grids: KdeResult['grid'] = {
    gx: surface.gx,
    gy: surface.gy,
    xs: surface.xs,
    ys: surface.ys,
    values: surface.values,
    inside: surface.inside,
    covariance: [surface.covariance[0], surface.covariance[1], surface.covariance[2]],
  }
  if (runs === 0) {
    const peak = kdeAttractor(points, region, options)
    const hollow = kdeVoid(points, region, options)
    report(1, 1)
    return {
      grid: grids,
      attractor: { x: peak.point.x, y: peak.point.y, density: peak.density },
      void: { x: hollow.point.x, y: hollow.point.y, density: hollow.density },
      runs: 0,
      accounting: emptyAccounting(),
      elapsedMs: performance.now() - started,
    }
  }
  let offset = 0
  let done = 0
  let maxExtra = 0
  let minExtra = 0
  let accounting: DrawAccounting = emptyAccounting()
  let last: Awaited<ReturnType<typeof kdeSignificance>> | undefined
  for (const m of runBatches(runs, 8)) {
    const result = await kdeSignificance(slice(bytes, offset, m, n), points, region, {
      ...options,
      runs: m,
    })
    offset += batchOf(m, n)
    done += m
    maxExtra += result.attractor.rank - 1
    minExtra += result.void.rank - 1
    accounting = addAccounting(accounting, result.accounting)
    last = result
    report(done, runs)
  }
  if (!last) throw new Error('no simulation ran')
  return {
    grid: grids,
    attractor: {
      x: last.attractor.point.x,
      y: last.attractor.point.y,
      density: last.attractor.density,
      rank: 1 + maxExtra,
      p: (1 + maxExtra) / (runs + 1),
    },
    void: {
      x: last.void.point.x,
      y: last.void.point.y,
      density: last.void.density,
      rank: 1 + minExtra,
      p: (1 + minExtra) / (runs + 1),
    },
    runs,
    accounting,
    elapsedMs: performance.now() - started,
  }
}

async function scan(payload: ScanPayload, report: Report): Promise<ScanResult> {
  const started = performance.now()
  const { points, region, runs, bytes, maxFraction } = payload
  const n = points.length
  let offset = 0
  let done = 0
  let extra = 0
  let accounting: DrawAccounting = emptyAccounting()
  let last: Awaited<ReturnType<typeof scanStatistic>> | undefined
  for (const m of runBatches(runs, 8)) {
    const result = await scanStatistic(points, region, {
      runs: m,
      maxFraction,
      source: slice(bytes, offset, m, n),
    })
    offset += batchOf(m, n)
    done += m
    extra += result.rank - 1
    accounting = addAccounting(accounting, result.accounting)
    last = result
    report(done, runs)
  }
  if (!last) throw new Error('no simulation ran')
  return {
    ...(last.cluster ? { cluster: last.cluster } : {}),
    llr: last.llr,
    rank: 1 + extra,
    pValue: (1 + extra) / (runs + 1),
    runs,
    accounting,
    elapsedMs: performance.now() - started,
  }
}

scope.onmessage = (event: MessageEvent<FieldJobRequest>) => {
  const request = event.data
  const report: Report = (done, total) => {
    scope.postMessage({ id: request.id, progress: total > 0 ? done / total : 0 } as FieldJobResponse)
  }
  const run = async (): Promise<FieldJobs[keyof FieldJobs]['result']> => {
    switch (request.job) {
      case 'significance':
        return await significance(request.payload as SignificancePayload, report)
      case 'envelope':
        return await envelope(request.payload as EnvelopePayload, report)
      case 'kde':
        return await kde(request.payload as KdePayload, report)
      default:
        return await scan(request.payload as ScanPayload, report)
    }
  }
  run()
    .then((result) => {
      scope.postMessage({ id: request.id, ok: true, result } as FieldJobResponse)
    })
    .catch((error: unknown) => {
      scope.postMessage({ id: request.id, ok: false, error: failure(error) } as FieldJobResponse)
    })
}
