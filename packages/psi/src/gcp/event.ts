import {
  cumulativeDeviation,
  devvar,
  netvar,
  normalP,
  significanceEnvelope,
  stoufferZ,
  theoreticalCalibration,
  zScores,
} from '@mindpeeker/negentropy'
import { PsiError } from '../errors.js'
import type { StatResult, TrialSeries } from '../types.js'

/** A wall-clock event window over recorded trial timestamps: `[startMs, endMs)`. */
export interface EventWindow {
  startMs: number
  endMs: number
}

/** Options for {@link analyzeEvent}. */
export interface AnalyzeEventOptions {
  /** Pointwise p of the cumulative-deviation envelope. Default 0.05. */
  envelopeP?: number
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
  /** Pointwise envelope $\chi^2_{\mathrm{ppf}}(1-p, t) - t$ to plot beside `cumdev`. */
  readonly envelope: Float64Array
  /**
   * Pooled mean-shift statistic: Stouffer over the per-trial Stouffers,
   * $Z = \sum_t Z_s(t)/\sqrt{T} \sim N(0,1)$, two-sided p. Complements
   * `netvar` (a variance test blind to sign) with a directional view.
   */
  readonly composite: StatResult
}

/**
 * GCP-style formal event analysis over recorded multi-source trial data.
 *
 * Conventions follow the Global Consciousness Project's formal series
 * (Nelson et al. 2002, "Correlations of continuous random data with major
 * world events"; Bancel & Nelson 2008): each device produces 200-bit trials
 * at 1 Hz, normalized as $z = (x - 100)/\sqrt{50}$ — the theoretical
 * $\mathrm{Binomial}(200, \tfrac12)$ calibration, which negentropy's
 * `theoreticalCalibration` generalizes to any `bitsPerTrial`. The event
 * statistic is `netvar`; `devvar`, the cumulative-deviation trace, and its
 * envelope are the standard companions.
 *
 * This is deliberately a *thin, honest composition*: window the series by
 * timestamp, then delegate every number to negentropy's `zScores`,
 * `stoufferZ`, `netvar`, `devvar`, `cumulativeDeviation`, and
 * `significanceEnvelope`. The envelope is POINTWISE — an H0 path crosses it
 * *somewhere* far more often than p. For family-wise honesty use the
 * time-offset surrogates in `resample/surrogates`.
 *
 * Requirements: every series carries timestamps (recordings from
 * `recordSession` do); all series share one `bitsPerTrial`; the window
 * selects the same number of trials from each source (lock-step recordings
 * guarantee this) — otherwise `source_mismatch` is thrown rather than
 * silently truncating misaligned data.
 */
export function analyzeEvent(
  seriesBySource: readonly TrialSeries[],
  window: EventWindow,
  opts: AnalyzeEventOptions = {},
): GcpEventResult {
  if (seriesBySource.length === 0) {
    throw new PsiError('invalid_plan', 'analyzeEvent needs at least one series')
  }
  if (
    !Number.isFinite(window.startMs) ||
    !Number.isFinite(window.endMs) ||
    window.startMs >= window.endMs
  ) {
    throw new PsiError(
      'invalid_plan',
      `event window [${window.startMs}, ${window.endMs}) is empty or inverted`,
    )
  }
  const envelopeP = opts.envelopeP ?? 0.05
  if (!(envelopeP > 0 && envelopeP < 1)) {
    throw new PsiError('invalid_plan', `envelopeP must be in (0, 1), got ${envelopeP}`)
  }
  const names = new Set(seriesBySource.map((s) => s.source))
  if (names.size !== seriesBySource.length) {
    throw new PsiError('source_mismatch', 'series must have unique source names')
  }
  const bitsPerTrial = (seriesBySource[0] as TrialSeries).bitsPerTrial
  for (const s of seriesBySource) {
    if (s.bitsPerTrial !== bitsPerTrial) {
      throw new PsiError(
        'source_mismatch',
        `mixed bitsPerTrial: ${s.source} has ${s.bitsPerTrial}, ${(seriesBySource[0] as TrialSeries).source} has ${bitsPerTrial}`,
        { source: s.source },
      )
    }
  }

  const sliced = seriesBySource.map((s) => {
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
    const sums = new Float64Array(kept.length)
    const ts = new Float64Array(kept.length)
    for (let j = 0; j < kept.length; j++) {
      sums[j] = s.sums[kept[j] as number] as number
      ts[j] = timestamps[kept[j] as number] as number
    }
    return { source: s.source, bitsPerTrial, sums, timestamps: ts, kept }
  })

  // Step-alignment guard. For lock-step recordings (recordSession) a series
  // index IS the round number across every source, so the window must keep the
  // identical index set from each — otherwise round i of one source would be
  // paired with round j!=i of another. Comparing only the COUNT is not enough:
  // per-source trial timestamps differ by milliseconds (each source stamps its
  // own completion time), so a window edge can cut inside a round in opposite
  // order across sources, keeping equal counts but disjoint rounds. That would
  // silently pair mismatched trials and report correlated sources as chance.
  const reference = sliced[0] as { source: string; kept: number[] }
  const steps = reference.kept.length
  for (const s of sliced) {
    const misaligned =
      s.kept.length !== steps || s.kept.some((idx, j) => idx !== (reference.kept[j] as number))
    if (misaligned) {
      throw new PsiError(
        'source_mismatch',
        `window selects rounds [${s.kept.join(',')}] from ${s.source} but [${reference.kept.join(',')}] from ${reference.source} — sources are not step-aligned in this window`,
        { source: s.source },
      )
    }
  }
  if (steps === 0) {
    throw new PsiError(
      'insufficient_data',
      `event window [${window.startMs}, ${window.endMs}) contains no trials`,
    )
  }

  const sources = sliced.map((s) => s.source)
  const zBySource = sliced.map((s) => zScores(s, theoreticalCalibration(s.source, bitsPerTrial)))

  const stoufferPerTrial = new Float64Array(steps)
  const column = new Float64Array(zBySource.length)
  for (let t = 0; t < steps; t++) {
    for (let i = 0; i < zBySource.length; i++) {
      column[i] = (zBySource[i] as Float64Array)[t] as number
    }
    stoufferPerTrial[t] = stoufferZ(column)
  }

  const grand = stoufferZ(stoufferPerTrial)
  return Object.freeze({
    sources: Object.freeze(sources),
    steps,
    stoufferPerTrial,
    netvar: netvar(zBySource, sources),
    devvar: devvar(zBySource, sources),
    cumdev: cumulativeDeviation(stoufferPerTrial),
    envelope: significanceEnvelope(steps, envelopeP),
    composite: Object.freeze({
      statistic: grand,
      df: steps,
      pValue: normalP(grand, 'two'),
      n: steps,
      sources: Object.freeze([...sources]),
    }),
  })
}
