import { type Calibration, chiSquareP, normalP, stoufferZ, zScores } from '@mindpeeker/negentropy'
import { PsiError } from '../errors.js'
import { assertInteger, assertSeries } from '../internal/validate.js'
import type { StatResult, TrialSeries } from '../types.js'
import {
  type AnalysisWindow,
  assertEventWindow,
  type CalibrationOption,
  isStepWindow,
  resolveCalibrations,
  stepRange,
} from './window.js'

/** One pre-declared FieldREG segment (session, presentation, day) — step or wall-clock bounds. */
export type FieldRegSegment = AnalysisWindow & { readonly id: string; readonly label?: string }

/** Options for {@link analyzeFieldReg}. */
export interface AnalyzeFieldRegOptions {
  /**
   * Per-segment statistic: `'mean'` (default) — the segment's Stouffer z,
   * two-sided p; `'variance'` — $\sum z^2 \sim \chi^2(n)$, upper-tail p.
   */
  statistic?: 'mean' | 'variance'
  /** Multiplicity correction for the extreme segment and the scales. Default `'sidak'`. */
  correction?: 'sidak' | 'bonferroni'
  /**
   * How many segmentations/analysis scales were examined in total (e.g.
   * sessions *and* days = 2). Integer ≥ 1, default 1 — register it.
   */
  scales?: number
  /** Trial normalization (`'theoretical'` default, a one-element `Calibration[]`, or `{ history }`). */
  calibration?: CalibrationOption
}

/** Per-segment FieldREG result. */
export interface FieldRegSegmentResult {
  readonly id: string
  readonly label?: string
  readonly startStep: number
  readonly endStep: number
  readonly trials: number
  /** Stouffer z of the segment's trial z-scores. */
  readonly z: number
  /** $\sum z^2 \sim \chi^2(\text{trials})$, upper-tail p. */
  readonly chiSquare: StatResult
  /** p of the chosen statistic (two-sided mean, or upper-tail variance). */
  readonly pValue: number
}

/** The FieldREG analysis — see {@link analyzeFieldReg}. */
export interface FieldRegAnalysis {
  readonly source: string
  readonly bitsPerTrial: number
  readonly statistic: 'mean' | 'variance'
  readonly correction: 'sidak' | 'bonferroni'
  /** Segments in chronological order. */
  readonly segments: readonly FieldRegSegmentResult[]
  /** The most extreme segment, corrected for S segments and then for the registered scales. */
  readonly extreme: {
    readonly id: string
    readonly pMin: number
    /** Šidák $1-(1-p_{\min})^S$ or Bonferroni $\min(1, S\,p_{\min})$. */
    readonly pCorrected: number
    readonly scales: number
    /** The same correction applied again over `scales`. */
    readonly pScale: number
  }
  /** Composites over all S segments (independent because segments are disjoint). */
  readonly composite: {
    /** Stouffer $\sum_s z_s/\sqrt S$, two-sided. */
    readonly stouffer: StatResult
    /** $\sum_s z_s^2 \sim \chi^2(S)$ — per-segment deviations in either direction. */
    readonly chiSquare: StatResult
    /** Fisher $-2\sum_s \ln p_s \sim \chi^2(2S)$ over the chosen per-segment p. */
    readonly fisher: StatResult
  }
}

function correct(p: number, m: number, method: 'sidak' | 'bonferroni'): number {
  return method === 'bonferroni' ? Math.min(1, m * p) : -Math.expm1(m * Math.log1p(-p))
}

/**
 * FieldREG segment analysis (Nelson, Bradish, Dobyns, Dunne & Jahn 1996,
 * "FieldREG anomalies in group situations"): one REG recorded through an
 * event that "subdivides naturally into temporal segments" — sessions,
 * presentations, days — declared *before* looking. Each segment gets its
 * Stouffer z and $\chi^2$; the claim statistic is the most extreme segment,
 * corrected for the number of segments $S$ and for the registered number of
 * analysis `scales` (the library-recorded report compounds such corrected
 * venue p-values across venues, e.g. with Fisher's method). The source says
 * only "appropriate correction for multiple sampling": Šidák (exact for
 * independent segments) is the default, Bonferroni the conservative option —
 * name the one you use in the registration.
 *
 * Segments must not overlap (they would not be independent) and must each
 * contain at least one trial.
 *
 * @throws {PsiError} `invalid_plan` (malformed series/segments/options,
 *   overlapping segments, duplicate ids), `bad_record` (wall-clock segments
 *   without timestamps), `insufficient_data` (no segments, an empty segment).
 */
export function analyzeFieldReg(
  series: TrialSeries,
  segments: readonly FieldRegSegment[],
  opts: AnalyzeFieldRegOptions = {},
): FieldRegAnalysis {
  assertSeries(series)
  if (!Array.isArray(segments as unknown) || segments.length === 0) {
    throw new PsiError('insufficient_data', 'analyzeFieldReg needs at least one segment')
  }
  const statistic = opts.statistic ?? 'mean'
  if (statistic !== 'mean' && statistic !== 'variance') {
    throw new PsiError(
      'invalid_plan',
      `statistic must be 'mean' or 'variance', got ${String(statistic)}`,
    )
  }
  const correction = opts.correction ?? 'sidak'
  if (correction !== 'sidak' && correction !== 'bonferroni') {
    throw new PsiError(
      'invalid_plan',
      `correction must be 'sidak' or 'bonferroni', got ${String(correction)}`,
    )
  }
  const scales = assertInteger(opts.scales ?? 1, 1, 'scales')
  const calibration = resolveCalibrations([series], opts.calibration)[0] as Calibration
  const ids = new Set<string>()
  const ranges = segments.map((segment) => {
    if (typeof segment !== 'object' || segment === null || typeof segment.id !== 'string') {
      throw new PsiError('invalid_plan', 'every segment needs a string id and bounds')
    }
    if (ids.has(segment.id))
      throw new PsiError('invalid_plan', `duplicate segment id '${segment.id}'`)
    ids.add(segment.id)
    if (isStepWindow(segment)) {
      const { start, end } = stepRange(segment, series.sums.length)
      return { segment, start, end }
    }
    assertEventWindow(segment)
    const ts = series.timestamps
    if (!ts || ts.length !== series.sums.length) {
      throw new PsiError(
        'bad_record',
        `${series.source} has no per-trial timestamps for wall-clock segments`,
        {
          source: series.source,
        },
      )
    }
    let start = -1
    let end = -1
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i] as number
      if (t >= segment.startMs && t < segment.endMs) {
        if (start < 0) start = i
        else if (i !== end) {
          throw new PsiError('bad_record', `segment '${segment.id}' selects non-contiguous trials`)
        }
        end = i + 1
      }
    }
    if (start < 0) {
      throw new PsiError('insufficient_data', `segment '${segment.id}' contains no trials`)
    }
    return { segment, start, end }
  })
  ranges.sort((a, b) => a.start - b.start)
  for (let i = 1; i < ranges.length; i++) {
    const prev = ranges[i - 1] as (typeof ranges)[number]
    const next = ranges[i] as (typeof ranges)[number]
    if (next.start < prev.end) {
      throw new PsiError(
        'invalid_plan',
        `segments '${prev.segment.id}' and '${next.segment.id}' overlap — segments must be disjoint`,
      )
    }
  }
  const z = zScores(series, calibration)
  const sources = Object.freeze([series.source])
  const results: FieldRegSegmentResult[] = ranges.map(({ segment, start, end }) => {
    const zs = z.subarray(start, end)
    let sumSq = 0
    for (const v of zs) sumSq += v * v
    const segZ = stoufferZ(zs)
    const chi: StatResult = Object.freeze({
      statistic: sumSq,
      df: end - start,
      pValue: chiSquareP(sumSq, end - start),
      n: end - start,
      sources,
    })
    return Object.freeze({
      id: segment.id,
      ...(segment.label !== undefined && { label: segment.label }),
      startStep: start,
      endStep: end,
      trials: end - start,
      z: segZ,
      chiSquare: chi,
      pValue: statistic === 'mean' ? normalP(segZ, 'two') : chi.pValue,
    })
  })
  const count = results.length
  let extremeIndex = 0
  results.forEach((r, i) => {
    if (r.pValue < (results[extremeIndex] as FieldRegSegmentResult).pValue) extremeIndex = i
  })
  const extreme = results[extremeIndex] as FieldRegSegmentResult
  const pCorrected = correct(extreme.pValue, count, correction)
  let zSum = 0
  let zSq = 0
  let fisher = 0
  for (const r of results) {
    zSum += r.z
    zSq += r.z * r.z
    fisher += -2 * Math.log(r.pValue)
  }
  const stouffer = zSum / Math.sqrt(count)
  return Object.freeze({
    source: series.source,
    bitsPerTrial: series.bitsPerTrial,
    statistic,
    correction,
    segments: Object.freeze(results),
    extreme: Object.freeze({
      id: extreme.id,
      pMin: extreme.pValue,
      pCorrected,
      scales,
      pScale: correct(pCorrected, scales, correction),
    }),
    composite: Object.freeze({
      stouffer: Object.freeze({
        statistic: stouffer,
        df: count,
        pValue: normalP(stouffer, 'two'),
        n: count,
        sources,
      }),
      chiSquare: Object.freeze({
        statistic: zSq,
        df: count,
        pValue: chiSquareP(zSq, count),
        n: count,
        sources,
      }),
      fisher: Object.freeze({
        statistic: fisher,
        df: 2 * count,
        pValue: chiSquareP(fisher, 2 * count),
        n: count,
        sources,
      }),
    }),
  })
}
