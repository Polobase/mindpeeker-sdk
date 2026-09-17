import { PsiError } from '../errors.js'
import { type Seed, Xoshiro128 } from '../internal/prng.js'
import { assertInteger } from '../internal/validate.js'
import type { TrialSeries } from '../types.js'
import {
  type AnalysisWindow,
  assertEventWindow,
  isStepWindow,
  type StepWindow,
  stepRange,
} from './window.js'

/** Options for {@link placeboWindows}. */
export interface PlaceboOptions {
  /** Length of every placebo window in steps — use the real event's length. Integer ≥ 1. */
  windowSteps: number
  /** Draw this many distinct random starts (seeded). Exactly one of `count` / `starts`. */
  count?: number
  /** Explicit placebo starts (validated against range and exclusions). */
  starts?: readonly number[]
  /**
   * Windows no placebo may overlap — at least the real event(s), plus any
   * known disturbances. Wall-clock windows exclude every step at which *any*
   * source's timestamp falls inside them.
   */
  exclude?: readonly AnalysisWindow[]
  /** PRNG seed for `count` draws — part of the pre-registration. Default `0`. */
  seed?: Seed
}

/**
 * GCP random-start placebo windows ("pseudo-events"): event-length windows at
 * seeded random (or explicit) start steps inside an off-event archive, never
 * overlapping an excluded window. Run the same analysis on each —
 * `analyzeEvent(archive, window).netvar.statistic` — and {@link permutationP}
 * ranks the real event among them: the random-start control the GCP formal
 * series and GCP 2.0 report (Bancel & Nelson 2008; Plonka et al. 2026), and
 * unlike {@link timeOffsetSurrogates}' circular `rotate: 'all'` it never
 * wraps the recording's end onto its start.
 *
 * `count` mode samples distinct starts uniformly without replacement from
 * every admissible start $s \in [0, T - w]$ with $[s, s+w)$ clear of
 * exclusions (placebos may overlap one another). Returned windows are sorted
 * by start. Deterministic for a given seed.
 *
 * @throws {PsiError} `invalid_plan` (bad options, a start that overlaps an
 *   exclusion or leaves the archive, duplicate starts), `source_mismatch`
 *   (series of unequal length), `bad_record` (a wall-clock exclusion without
 *   timestamps), `insufficient_data` (fewer admissible starts than `count`).
 */
export function placeboWindows(
  archive: readonly TrialSeries[],
  opts: PlaceboOptions,
): readonly StepWindow[] {
  if (!Array.isArray(archive as unknown) || archive.length === 0) {
    throw new PsiError('invalid_plan', 'placeboWindows needs at least one archive series')
  }
  const steps = (archive[0] as TrialSeries).sums.length
  for (const s of archive) {
    if (s.sums.length !== steps) {
      throw new PsiError(
        'source_mismatch',
        `archive series are not step-aligned: ${s.source} has ${s.sums.length} steps, expected ${steps}`,
        { source: s.source },
      )
    }
  }
  const w = assertInteger(opts?.windowSteps, 1, 'windowSteps')
  if (w > steps) {
    throw new PsiError('insufficient_data', `windowSteps ${w} exceeds the archive's ${steps} steps`)
  }
  if ((opts.count === undefined) === (opts.starts === undefined)) {
    throw new PsiError('invalid_plan', 'pass exactly one of count or starts')
  }
  const blocked = new Uint8Array(steps)
  for (const window of opts.exclude ?? []) {
    if (typeof window !== 'object' || window === null) {
      throw new PsiError('invalid_plan', 'exclude entries must be step or wall-clock windows')
    }
    if (isStepWindow(window)) {
      const { start, end } = stepRange(window, Number.MAX_SAFE_INTEGER)
      for (let i = start; i < Math.min(end, steps); i++) blocked[i] = 1
      continue
    }
    assertEventWindow(window)
    for (const s of archive) {
      const ts = s.timestamps
      if (!ts || ts.length !== steps) {
        throw new PsiError(
          'bad_record',
          `${s.source} has no per-trial timestamps for a wall-clock exclusion`,
          {
            source: s.source,
          },
        )
      }
      for (let i = 0; i < steps; i++) {
        const t = ts[i] as number
        if (t >= window.startMs && t < window.endMs) blocked[i] = 1
      }
    }
  }
  const prefix = new Int32Array(steps + 1)
  for (let i = 0; i < steps; i++) prefix[i + 1] = (prefix[i] as number) + (blocked[i] as number)
  const admissible = (start: number) => (prefix[start + w] as number) === (prefix[start] as number)

  let starts: number[]
  if (opts.starts !== undefined) {
    if (!Array.isArray(opts.starts as unknown) || opts.starts.length === 0) {
      throw new PsiError('invalid_plan', 'starts must be a non-empty array')
    }
    const seen = new Set<number>()
    starts = opts.starts.map((start) => {
      if (!Number.isInteger(start) || start < 0 || start + w > steps) {
        throw new PsiError(
          'invalid_plan',
          `placebo start ${start} does not fit a ${w}-step window in ${steps} steps`,
        )
      }
      if (!admissible(start)) {
        throw new PsiError('invalid_plan', `placebo start ${start} overlaps an excluded window`)
      }
      if (seen.has(start)) throw new PsiError('invalid_plan', `duplicate placebo start ${start}`)
      seen.add(start)
      return start
    })
    if (opts.seed !== undefined) {
      throw new PsiError('invalid_plan', 'seed applies only to count draws')
    }
  } else {
    const count = assertInteger(opts.count, 1, 'count')
    const candidates: number[] = []
    for (let s = 0; s + w <= steps; s++) if (admissible(s)) candidates.push(s)
    if (candidates.length < count) {
      throw new PsiError(
        'insufficient_data',
        `only ${candidates.length} admissible placebo starts for count ${count}`,
      )
    }
    const rng = new Xoshiro128(opts.seed ?? 0)
    for (let i = 0; i < count; i++) {
      const j = i + rng.uniformInt(candidates.length - i)
      const tmp = candidates[i] as number
      candidates[i] = candidates[j] as number
      candidates[j] = tmp
    }
    starts = candidates.slice(0, count)
  }
  return Object.freeze(
    starts
      .sort((a, b) => a - b)
      .map((startStep) => Object.freeze({ startStep, endStep: startStep + w })),
  )
}
