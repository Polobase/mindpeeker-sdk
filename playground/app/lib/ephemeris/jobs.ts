// The messages exchanged with app/workers/ephemeris-lst.worker.ts.
//
// Type-only SDK imports: nothing of @mindpeeker/ephemeris survives here at
// runtime, so this module is safe for the worker and for the client alike.

import type { LstLabelledTrial, LstPeak, LstWindowTestResult } from '@mindpeeker/ephemeris'

/** How trials are grouped before effects are relabelled. */
export type StratumMode = 'none' | 'lab' | 'clock' | 'clock-season'

export const STRATUM_LABELS: Record<StratumMode, string> = {
  none: 'no strata — effects move anywhere',
  lab: 'by study (lab)',
  clock: 'by local clock hour',
  'clock-season': 'by clock hour × season',
}

export const STRATUM_NOTES: Record<StratumMode, string> = {
  none: 'Effects may move between studies that ran at different longitudes and times — the null Spottiswoode used, and the one the README shows rejecting in over 90 % of simulated study mixes.',
  lab: "Effects are exchanged only inside a lab, so between-study differences cannot pass as an LST effect. This is the cookbook recipe's null.",
  clock: 'Effects are exchanged only inside a local-clock-hour bin, so the test asks whether LST explains anything beyond time of day.',
  'clock-season':
    'Effects are exchanged only inside a (clock hour × season) cell. LST is a linear function of solar time and day of year, so this is the strictest honest null — and it leaves the least LST variation, so power falls.',
}

/** One generated data set, in transferable columns. */
export interface TrialColumns {
  /** Local sidereal time, hours in [0, 24). */
  readonly lstHours: Float64Array
  /** The per-trial effect size the analyses consume. */
  readonly effect: Float64Array
  /** Index into the lab list (the study stratum). */
  readonly labIndex: Int32Array
  /** Local mean solar time, hours in [0, 24) — the clock-time stratum. */
  readonly clockHours: Float64Array
  /** Day of the year 0…365 — the season stratum. */
  readonly dayOfYear: Int32Array
  /** 1 where the simulated shift was added, 0 elsewhere. */
  readonly planted: Uint8Array
}

export interface ScanShape {
  readonly windowHours: number
  readonly stepHours: number
  readonly minTrials: number
}

/** What a permutation run reports back (the 240 windows stay on the main thread). */
export interface PermutationSummary {
  readonly n: number
  readonly overallMean: number
  readonly peak: LstPeak
  readonly statistic: number
  readonly permutations: number
  readonly exceedances: number
  readonly pValue: number
  readonly stratified: boolean
  readonly strata: number
  readonly batches: number
  readonly elapsedMs: number
}

export interface PermutationPayload extends ScanShape {
  readonly trials: TrialColumns
  readonly stratum: StratumMode
  readonly permutations: number
  readonly seed: number
}

export interface WindowPayload {
  readonly trials: TrialColumns
  readonly stratum: StratumMode
  readonly centerHours: number
  readonly halfWidthHours: number
  readonly permutations: number
  readonly seed: number
}

export interface WindowSummary extends LstWindowTestResult {
  readonly elapsedMs: number
}

export interface ConfoundPayload extends ScanShape {
  readonly trials: TrialColumns
  readonly modes: readonly StratumMode[]
  readonly permutations: number
  readonly seed: number
}

export interface ConfoundRow {
  readonly mode: StratumMode
  readonly summary: PermutationSummary
}

export interface EphemerisJobs {
  permutation: { payload: PermutationPayload; result: PermutationSummary }
  window: { payload: WindowPayload; result: WindowSummary }
  confound: { payload: ConfoundPayload; result: readonly ConfoundRow[] }
}

export type EphemerisJobName = keyof EphemerisJobs

export interface EphemerisJobRequest {
  readonly id: number
  readonly job: EphemerisJobName
  readonly payload: EphemerisJobs[EphemerisJobName]['payload']
}

export type EphemerisJobResponse =
  | { readonly id: number; readonly progress: number }
  | { readonly id: number; readonly ok: true; readonly result: unknown }
  | {
      readonly id: number
      readonly ok: false
      readonly error: { name: string; message: string; code?: string; cause?: string }
    }

/**
 * Split `m` relabelings into batches so the worker can report progress.
 * Batch `b` runs with seed `seed + b` — an independent seeded stream, because
 * the SDK folds an integer seed through splitmix64 — and the exceedance counts
 * add up, so the add-one p is unchanged.
 */
export function permutationBatches(permutations: number): number[] {
  const batches = Math.max(1, Math.min(40, Math.ceil(permutations / 250)))
  const base = Math.floor(permutations / batches)
  const out = new Array<number>(batches).fill(base)
  out[batches - 1] = permutations - base * (batches - 1)
  return out.filter((v) => v > 0)
}

/** Season index 0–3 from the day of the year, for the (clock × season) cells. */
export function season(dayOfYear: number): number {
  return Math.min(3, Math.floor((((dayOfYear % 366) + 366) % 366) / 91.5))
}

/**
 * Columns → the SDK's trial objects, with the stratum the caller asked for.
 * Pure data shuffling; the SDK appears here only as a type.
 */
export function toTrials(columns: TrialColumns, mode: StratumMode): LstLabelledTrial[] {
  const { lstHours, effect, labIndex, clockHours, dayOfYear } = columns
  const out: LstLabelledTrial[] = new Array(lstHours.length)
  for (let i = 0; i < lstHours.length; i++) {
    const base = { lstHours: lstHours[i] as number, effect: effect[i] as number }
    if (mode === 'none') {
      out[i] = base
      continue
    }
    const stratum =
      mode === 'lab'
        ? `lab-${labIndex[i]}`
        : mode === 'clock'
          ? `h${Math.floor(clockHours[i] as number)}`
          : `h${Math.floor(clockHours[i] as number)}/s${season(dayOfYear[i] as number)}`
    out[i] = { ...base, stratum }
  }
  return out
}
