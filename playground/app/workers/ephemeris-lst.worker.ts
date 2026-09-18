/// <reference lib="webworker" />
/**
 * The permutation nulls of `@mindpeeker/ephemeris`. `lstPermutationTest`
 * repeats the whole 240-window scan for every relabeling, so 9 999
 * relabelings of 2 400 trials are ~10⁷ window evaluations — far too much for
 * the main thread, and synchronous inside the SDK, so cancellation can only be
 * observed between batches (the client terminates the worker to stop sooner).
 *
 * Progress comes from splitting the m relabelings into batches: batch b runs
 * with seed `seed + b` — the SDK folds an integer seed through splitmix64, so
 * consecutive integers give well-separated xoshiro128** streams — and the
 * exceedance counts add up, so the add-one p-value (1 + Σb) / (1 + m) is
 * exactly the one a single call of m relabelings reports for its own stream.
 */
import { lstPermutationTest, lstWindowTest } from '@mindpeeker/ephemeris'
import type {
  ConfoundPayload,
  ConfoundRow,
  EphemerisJobRequest,
  EphemerisJobResponse,
  PermutationPayload,
  PermutationSummary,
  WindowPayload,
  WindowSummary,
} from '../lib/ephemeris/jobs'
import { permutationBatches, toTrials } from '../lib/ephemeris/jobs'

const ctx = self as unknown as DedicatedWorkerGlobalScope

function runPermutation(
  payload: PermutationPayload,
  onProgress?: (fraction: number) => void,
  progressBase = 0,
  progressSpan = 1,
): PermutationSummary {
  const trials = toTrials(payload.trials, payload.stratum)
  const options = {
    windowHours: payload.windowHours,
    stepHours: payload.stepHours,
    minTrials: payload.minTrials,
  }
  const sizes = permutationBatches(payload.permutations)
  const started = performance.now()
  let exceedances = 0
  let done = 0
  let last: ReturnType<typeof lstPermutationTest> | undefined
  for (let b = 0; b < sizes.length; b++) {
    const size = sizes[b] as number
    last = lstPermutationTest(trials, {
      ...options,
      permutations: size,
      seed: sizes.length === 1 ? payload.seed : payload.seed + b,
    })
    exceedances += last.exceedances
    done += size
    onProgress?.(progressBase + (progressSpan * done) / payload.permutations)
  }
  const result = last as ReturnType<typeof lstPermutationTest>
  return {
    n: result.scan.n,
    overallMean: result.scan.overallMean,
    peak: result.scan.peak,
    statistic: result.statistic,
    permutations: payload.permutations,
    exceedances,
    pValue: (1 + exceedances) / (1 + payload.permutations),
    stratified: result.stratified,
    strata: result.strata,
    batches: sizes.length,
    elapsedMs: performance.now() - started,
  }
}

function runWindow(payload: WindowPayload): WindowSummary {
  const trials = toTrials(payload.trials, payload.stratum)
  const started = performance.now()
  const result = lstWindowTest(trials, {
    centerHours: payload.centerHours,
    halfWidthHours: payload.halfWidthHours,
    permutations: payload.permutations,
    seed: payload.seed,
  })
  return { ...result, elapsedMs: performance.now() - started }
}

function runConfound(
  payload: ConfoundPayload,
  onProgress: (fraction: number) => void,
): ConfoundRow[] {
  const rows: ConfoundRow[] = []
  const span = 1 / Math.max(1, payload.modes.length)
  payload.modes.forEach((mode, index) => {
    rows.push({
      mode,
      summary: runPermutation(
        {
          trials: payload.trials,
          stratum: mode,
          windowHours: payload.windowHours,
          stepHours: payload.stepHours,
          minTrials: payload.minTrials,
          permutations: payload.permutations,
          seed: payload.seed,
        },
        onProgress,
        index * span,
        span,
      ),
    })
  })
  return rows
}

ctx.onmessage = (event: MessageEvent<EphemerisJobRequest>) => {
  const { id, job, payload } = event.data
  const progress = (fraction: number) => {
    ctx.postMessage({ id, progress: Math.max(0, Math.min(1, fraction)) } as EphemerisJobResponse)
  }
  try {
    const result =
      job === 'permutation'
        ? runPermutation(payload as PermutationPayload, progress)
        : job === 'window'
          ? runWindow(payload as WindowPayload)
          : runConfound(payload as ConfoundPayload, progress)
    ctx.postMessage({ id, ok: true, result } as EphemerisJobResponse)
  } catch (error) {
    const err = error as Error & { code?: string; cause?: unknown }
    ctx.postMessage({
      id,
      ok: false,
      error: {
        name: err.name ?? 'Error',
        message: err.message ?? String(error),
        ...(err.code ? { code: err.code } : {}),
        ...(err.cause ? { cause: String((err.cause as Error)?.message ?? err.cause) } : {}),
      },
    } as EphemerisJobResponse)
  }
}
