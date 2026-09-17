import {
  type Calibration,
  chiSquareP,
  cumulativeDeviation,
  devvar,
  netvar,
  normalP,
  significanceEnvelope,
  stoufferZ,
  zScores,
} from '@mindpeeker/negentropy'
import { PsiError } from '../errors.js'
import { assertOpenInterval, assertSeries } from '../internal/validate.js'
import type { StatResult, TrialSeries } from '../types.js'
import {
  type AnalysisWindow,
  assertEventWindow,
  type CalibrationOption,
  type EventWindow,
  isStepWindow,
  resolveCalibrations,
  roundTimestamps,
  stepRange,
} from './window.js'

export type { AnalysisWindow, CalibrationOption, EventWindow, StepWindow } from './window.js'

/** Options for {@link analyzeEvent}. */
export interface AnalyzeEventOptions {
  /** Pointwise p of the cumulative-deviation envelope. Default 0.05. */
  envelopeP?: number
  /**
   * How a wall-clock window selects trials (ignored for step windows):
   * - `'strict'` (default) — per-source timestamps; the window must select
   *   the identical index set from every source or `source_mismatch` is
   *   thrown. An edge that lands inside one round's stamp spread (sources
   *   stamp their own completion times) trips this guard.
   * - `'round'` — every lock-step round gets one canonical stamp, the latest
   *   of its per-source stamps, and the window selects whole rounds by it.
   *   Requires equal-length series with finite timestamps.
   */
  alignment?: 'strict' | 'round'
  /** Trial normalization — see {@link CalibrationOption}. Default `'theoretical'`. */
  calibration?: CalibrationOption
  /**
   * Also report netvar over wall-clock blocks of this many seconds (GCP
   * blocked analyses: 60 s, 15 min): per block the Stouffer
   * $Z_B = \sum_{t \in B} Z_s(t)/\sqrt{b}$ over its $b$ steps, and
   * $\sum_B Z_B^2 \sim \chi^2(\#\text{blocks})$. Blocks are anchored at the
   * window's first round stamp; needs finite timestamps.
   */
  blockSeconds?: number
}

/** Blocked netvar — see {@link AnalyzeEventOptions.blockSeconds}. */
export interface BlockedNetvar {
  readonly blockSeconds: number
  /** Per-block Stouffer $Z_B$ in chronological order. */
  readonly stouffer: Float64Array
  /** Steps per block. */
  readonly steps: Int32Array
  /** $\sum_B Z_B^2 \sim \chi^2(\#\text{blocks})$. */
  readonly netvar: StatResult
}

/**
 * The full formal-event bundle. Every field is a direct composition of
 * `@mindpeeker/negentropy` primitives over the same windowed z-matrix —
 * re-running those primitives on the same data reproduces each field
 * exactly (a property the test suite enforces).
 */
export interface GcpEventResult {
  readonly sources: readonly string[]
  /** Aligned trials per source inside the window. */
  readonly steps: number
  /** Per-trial Stouffer $Z_s(t) = \sum_i z_i(t)/\sqrt{N}$ across sources. */
  readonly stoufferPerTrial: Float64Array
  /** GCP standard event statistic $\sum_t Z_s(t)^2 \sim \chi^2(\text{steps})$. */
  readonly netvar: StatResult
  /** Device variance $\sum_t \sum_i z_i(t)^2 \sim \chi^2(\text{steps} \times N)$. */
  readonly devvar: StatResult
  /** Cumulative deviation $D(t) = \sum_{s \le t}(Z_s(s)^2 - 1)$ — the classic GCP plot. */
  readonly cumdev: Float64Array
  /** Pointwise envelope $\chi^2_{\mathrm{isf}}(p, t) - t$ to plot beside `cumdev`. */
  readonly envelope: Float64Array
  /**
   * Pooled mean-shift statistic: Stouffer over the per-trial Stouffers,
   * $Z = \sum_t Z_s(t)/\sqrt{T} \sim N(0,1)$, two-sided p. Complements
   * `netvar` (a variance test blind to sign) with a directional view.
   */
  readonly composite: StatResult
  /** The calibration applied to each source, aligned with `sources`. */
  readonly calibrations: readonly Calibration[]
  /** Present when `blockSeconds` was requested. */
  readonly blocked?: BlockedNetvar
}

const ENVELOPE_CACHE_SIZE = 8
const envelopeCache = new Map<string, Float64Array>()

/** significanceEnvelope depends only on (steps, p): memoize (surrogate loops recompute it). */
function envelopeFor(steps: number, p: number): Float64Array {
  const key = `${steps}:${p}`
  let cached = envelopeCache.get(key)
  if (!cached) {
    cached = significanceEnvelope(steps, p)
    if (envelopeCache.size >= ENVELOPE_CACHE_SIZE) {
      envelopeCache.delete(envelopeCache.keys().next().value as string)
    }
    envelopeCache.set(key, cached)
  }
  return cached.slice()
}

/** Kept indices per the window rules; also returns the stamps used for blocking. */
function selectSteps(
  seriesBySource: readonly TrialSeries[],
  window: AnalysisWindow,
  alignment: 'strict' | 'round',
  needStamps: boolean,
): { kept: number[]; stamps?: Float64Array } {
  if (isStepWindow(window)) {
    const available = Math.min(...seriesBySource.map((s) => s.sums.length))
    const { start, end } = stepRange(window, available)
    const kept = Array.from({ length: end - start }, (_, i) => start + i)
    return needStamps ? { kept, stamps: roundTimestamps(seriesBySource) } : { kept }
  }
  assertEventWindow(window)
  if (alignment === 'round') {
    const rounds = roundTimestamps(seriesBySource)
    const kept: number[] = []
    for (let i = 0; i < rounds.length; i++) {
      const t = rounds[i] as number
      if (t >= window.startMs && t < window.endMs) kept.push(i)
    }
    return { kept, stamps: rounds }
  }
  const keptBySource = seriesBySource.map((s) => {
    const timestamps = s.timestamps
    if (!timestamps || timestamps.length !== s.sums.length) {
      throw new PsiError(
        'bad_record',
        `${s.source} has no per-trial timestamps — time-windowed analysis needs recorded trial times`,
        { source: s.source },
      )
    }
    const kept: number[] = []
    for (let i = 0; i < timestamps.length; i++) {
      const t = timestamps[i] as number
      if (t >= window.startMs && t < window.endMs) kept.push(i)
    }
    return kept
  })
  // Step-alignment guard: for lock-step recordings a series index IS the
  // round, so the window must keep the identical index set from each source —
  // equal counts are not enough (an edge inside a round's stamp spread keeps
  // disjoint rounds and would silently pair round i with round j ≠ i).
  const reference = keptBySource[0] as number[]
  keptBySource.forEach((kept, s) => {
    if (kept.length !== reference.length || kept.some((idx, j) => idx !== reference[j])) {
      const name = (seriesBySource[s] as TrialSeries).source
      throw new PsiError(
        'source_mismatch',
        `window selects rounds [${kept.join(',')}] from ${name} but [${reference.join(',')}] from ${(seriesBySource[0] as TrialSeries).source} — sources are not step-aligned in this window (alignment: 'round' or a step window avoids this)`,
        { source: name },
      )
    }
  })
  return { kept: reference, stamps: (seriesBySource[0] as TrialSeries).timestamps }
}

function blockedNetvar(
  stoufferPerTrial: Float64Array,
  stamps: ArrayLike<number>,
  blockSeconds: number,
  sources: readonly string[],
): BlockedNetvar {
  const blockMs = blockSeconds * 1000
  const origin = stamps[0] as number
  const zs: number[] = []
  const sizes: number[] = []
  let current = Number.NaN
  let sum = 0
  let size = 0
  let previous = Number.NEGATIVE_INFINITY
  for (let t = 0; t < stoufferPerTrial.length; t++) {
    const stamp = stamps[t] as number
    if (!Number.isFinite(stamp) || stamp < previous) {
      throw new PsiError(
        'bad_record',
        `blockSeconds needs finite, non-decreasing timestamps (step ${t})`,
      )
    }
    previous = stamp
    const block = Math.floor((stamp - origin) / blockMs)
    if (block !== current && size > 0) {
      zs.push(sum / Math.sqrt(size))
      sizes.push(size)
      sum = 0
      size = 0
    }
    current = block
    sum += stoufferPerTrial[t] as number
    size++
  }
  zs.push(sum / Math.sqrt(size))
  sizes.push(size)
  const stouffer = Float64Array.from(zs)
  let statistic = 0
  for (const z of stouffer) statistic += z * z
  return Object.freeze({
    blockSeconds,
    stouffer,
    steps: Int32Array.from(sizes),
    netvar: Object.freeze({
      statistic,
      df: stouffer.length,
      pValue: chiSquareP(statistic, stouffer.length),
      n: stoufferPerTrial.length,
      sources: Object.freeze([...sources]),
    }),
  })
}

/**
 * GCP-style formal event analysis over recorded multi-source trial data.
 *
 * Conventions follow the Global Consciousness Project's formal series
 * (Nelson et al. 2002, "Correlations of continuous random data with major
 * world events"; Bancel & Nelson 2008): each device produces 200-bit trials
 * at 1 Hz; the event statistic is `netvar`, with `devvar`, the
 * cumulative-deviation trace, and its envelope as the standard companions.
 * The default normalization is the theoretical Binomial(200, ½)
 * $z = (x - 100)/\sqrt{50}$; the formal series itself normalized each device
 * by its *empirical* mean and variance (Nelson & Bancel 2011) and GCP 2.0 by
 * the previous 24 h — pass `calibration: { history }` or fitted calibrations
 * to follow that convention.
 *
 * This is deliberately a *thin, honest composition*: select the window, then
 * delegate every number to negentropy's `zScores`, `stoufferZ`, `netvar`,
 * `devvar`, `cumulativeDeviation`, and `significanceEnvelope` (memoized per
 * step count, since surrogate loops recompute it). The envelope is POINTWISE —
 * an H0 path crosses it *somewhere* far more often than p. For family-wise
 * honesty use {@link timeOffsetSurrogates}, {@link placeboWindows}, and
 * {@link globalRankEnvelope}.
 *
 * Windows: `{ startStep, endStep }` selects rounds by index (always aligned
 * for lock-step recordings); `{ startMs, endMs }` selects by timestamp under
 * `alignment` ('strict' throws `source_mismatch` rather than silently pairing
 * different rounds; 'round' windows on one canonical stamp per round).
 *
 * @throws {PsiError} `invalid_plan` (no series, malformed series, bad window
 *   or options), `source_mismatch` (duplicate names, mixed `bitsPerTrial`,
 *   misaligned strict window), `bad_record` (missing/non-finite timestamps
 *   where needed), `insufficient_data` (empty window, calibration history too short).
 */
export function analyzeEvent(
  seriesBySource: readonly TrialSeries[],
  window: AnalysisWindow,
  opts: AnalyzeEventOptions = {},
): GcpEventResult {
  if (!Array.isArray(seriesBySource as unknown) || seriesBySource.length === 0) {
    throw new PsiError('invalid_plan', 'analyzeEvent needs at least one series')
  }
  if (typeof window !== 'object' || window === null) {
    throw new PsiError('invalid_plan', 'analyzeEvent needs a window')
  }
  seriesBySource.forEach((s, i) => {
    assertSeries(s, `series ${i}`)
  })
  const envelopeP = assertOpenInterval(opts.envelopeP ?? 0.05, 0, 1, 'envelopeP')
  const alignment = opts.alignment ?? 'strict'
  if (alignment !== 'strict' && alignment !== 'round') {
    throw new PsiError(
      'invalid_plan',
      `alignment must be 'strict' or 'round', got ${String(alignment)}`,
    )
  }
  const blockSeconds = opts.blockSeconds
  if (blockSeconds !== undefined && !(Number.isFinite(blockSeconds) && blockSeconds > 0)) {
    throw new PsiError(
      'invalid_plan',
      `blockSeconds must be a finite number > 0, got ${blockSeconds}`,
    )
  }
  const names = new Set(seriesBySource.map((s) => s.source))
  if (names.size !== seriesBySource.length) {
    throw new PsiError('source_mismatch', 'series must have unique source names')
  }
  const first = seriesBySource[0] as TrialSeries
  for (const s of seriesBySource) {
    if (s.bitsPerTrial !== first.bitsPerTrial) {
      throw new PsiError(
        'source_mismatch',
        `mixed bitsPerTrial: ${s.source} has ${s.bitsPerTrial}, ${first.source} has ${first.bitsPerTrial}`,
        { source: s.source },
      )
    }
  }
  const { kept, stamps } = selectSteps(
    seriesBySource,
    window,
    alignment,
    blockSeconds !== undefined,
  )
  const steps = kept.length
  if (steps === 0) {
    const label = isStepWindow(window)
      ? `[${window.startStep}, ${window.endStep})`
      : `[${window.startMs}, ${window.endMs})`
    throw new PsiError('insufficient_data', `event window ${label} contains no trials`)
  }
  const calibrations = resolveCalibrations(
    seriesBySource,
    opts.calibration,
    isStepWindow(window) ? undefined : (window as EventWindow),
  )
  const sources = seriesBySource.map((s) => s.source)
  const zBySource = seriesBySource.map((s, i) => {
    const sums = new Float64Array(steps)
    for (let j = 0; j < steps; j++) sums[j] = s.sums[kept[j] as number] as number
    return zScores(
      { source: s.source, bitsPerTrial: s.bitsPerTrial, sums },
      calibrations[i] as Calibration,
    )
  })

  const stoufferPerTrial = new Float64Array(steps)
  const column = new Float64Array(zBySource.length)
  for (let t = 0; t < steps; t++) {
    for (let i = 0; i < zBySource.length; i++) {
      column[i] = (zBySource[i] as Float64Array)[t] as number
    }
    stoufferPerTrial[t] = stoufferZ(column)
  }

  let blocked: BlockedNetvar | undefined
  if (blockSeconds !== undefined) {
    if (!stamps) {
      throw new PsiError('bad_record', 'blockSeconds needs per-trial timestamps')
    }
    const windowStamps = Float64Array.from(kept, (idx) => stamps[idx] as number)
    blocked = blockedNetvar(stoufferPerTrial, windowStamps, blockSeconds, sources)
  }

  const grand = stoufferZ(stoufferPerTrial)
  return Object.freeze({
    sources: Object.freeze(sources),
    steps,
    stoufferPerTrial,
    netvar: netvar(zBySource, sources),
    devvar: devvar(zBySource, sources),
    cumdev: cumulativeDeviation(stoufferPerTrial),
    envelope: envelopeFor(steps, envelopeP),
    composite: Object.freeze({
      statistic: grand,
      df: steps,
      pValue: normalP(grand, 'two'),
      n: steps,
      sources: Object.freeze([...sources]),
    }),
    calibrations: Object.freeze(calibrations),
    ...(blocked && { blocked }),
  })
}
