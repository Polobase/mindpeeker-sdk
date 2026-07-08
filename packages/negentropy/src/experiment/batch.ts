import { NegentropyError } from '../errors.js'
import { normPpf } from '../internal/special.js'
import { calibrate, theoreticalCalibration } from '../stats/calibration.js'
import { cumulativeDeviation } from '../stats/cumdev.js'
import { devvar, interSourceCorrelation, netvar } from '../stats/network.js'
import { P_FLOOR } from '../stats/pvalues.js'
import { trialsFromBytes } from '../stats/trials.js'
import { stoufferZ, zScores } from '../stats/zscores.js'
import type { Calibration, StatResult, TrialSeries } from '../types.js'
import { compositeZ } from './composite.js'
import type { RegisteredExperiment } from './registration.js'
import type {
  EventResult,
  EventSpec,
  EventStatistic,
  ExperimentConfig,
  ExperimentResult,
} from './types.js'

function resolveConfig(config: ExperimentConfig | RegisteredExperiment): {
  config: ExperimentConfig
  registration?: string
} {
  if ('hash' in config && 'config' in config) {
    return { config: config.config, registration: config.hash }
  }
  return { config: config as ExperimentConfig }
}

/**
 * Normal-equivalent z of a one-sided p, via normPpf(1−p) = −normPpf(p) —
 * the lower tail keeps full precision where 1−p would round to exactly 1.
 */
function pToZ(p: number): number {
  return -normPpf(Math.min(Math.max(p, P_FLOOR), 1 - 1e-16))
}

function resolveWindow(
  spec: EventSpec,
  steps: number,
  timestamps: Float64Array | undefined,
): { start: number; end: number } {
  let start: number
  let end: number
  if (spec.start instanceof Date || spec.end instanceof Date) {
    if (!timestamps) {
      throw new NegentropyError(
        'invalid_window',
        `event ${spec.id} uses Date bounds but the trial data has no timestamps`,
      )
    }
    const startMs = spec.start instanceof Date ? spec.start.getTime() : Number.NaN
    const endMs = spec.end instanceof Date ? spec.end.getTime() : Number.NaN
    if (!(spec.start instanceof Date) || !(spec.end instanceof Date)) {
      throw new NegentropyError(
        'invalid_window',
        `event ${spec.id} mixes Date and step-index bounds`,
      )
    }
    start = timestamps.findIndex((t) => t >= startMs)
    if (start === -1) start = steps
    end = timestamps.findIndex((t) => t >= endMs)
    if (end === -1) end = steps
  } else {
    start = spec.start
    end = spec.end
  }
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end > steps ||
    start >= end
  ) {
    throw new NegentropyError(
      'invalid_window',
      `event ${spec.id}: window [${String(spec.start)}, ${String(spec.end)}) resolves to [${start}, ${end}) outside the ${steps} available steps`,
    )
  }
  return { start, end }
}

function eventStatistic(
  statistic: EventStatistic,
  zSlices: readonly Float64Array[],
  sources: readonly string[],
): StatResult {
  switch (statistic) {
    case 'netvar':
      return netvar(zSlices, sources)
    case 'devvar':
      return devvar(zSlices, sources)
    case 'correlation':
      return interSourceCorrelation(zSlices, sources)
  }
}

/**
 * The pure analysis core: recorded trial series in, ExperimentResult out.
 * Live sessions delegate here on stop(), so a re-analysis of the archived
 * series reproduces the live result exactly.
 */
export function analyzeTrials(
  series: readonly TrialSeries[],
  configOrRegistration: ExperimentConfig | RegisteredExperiment,
): ExperimentResult {
  const { config, registration } = resolveConfig(configOrRegistration)
  if (series.length === 0) {
    throw new NegentropyError('invalid_config', 'analyzeTrials needs at least one series')
  }
  const bitsPerTrial = (series[0] as TrialSeries).bitsPerTrial
  for (const s of series) {
    if (s.bitsPerTrial !== bitsPerTrial) {
      throw new NegentropyError(
        'invalid_config',
        `mixed bitsPerTrial: ${s.source} has ${s.bitsPerTrial}, ${(series[0] as TrialSeries).source} has ${bitsPerTrial}`,
      )
    }
  }
  const missing = config.missing ?? 'error'

  // resolve calibration (possibly burning a leading window off each series)
  const calibrationSpec = config.calibration ?? 'theoretical'
  let analysisSeries: TrialSeries[]
  let calibrations: Calibration[]
  if (calibrationSpec === 'theoretical') {
    analysisSeries = [...series]
    calibrations = series.map((s) => theoreticalCalibration(s.source, bitsPerTrial))
  } else if (Array.isArray(calibrationSpec)) {
    analysisSeries = [...series]
    calibrations = series.map((s) => {
      const cal = (calibrationSpec as readonly Calibration[]).find((c) => c.source === s.source)
      if (!cal) {
        throw new NegentropyError(
          'calibration_required',
          `no calibration provided for ${s.source}`,
          {
            source: s.source,
          },
        )
      }
      return cal
    })
  } else {
    const burn = (calibrationSpec as { trials: number }).trials
    if (!Number.isInteger(burn) || burn < 2) {
      throw new NegentropyError(
        'invalid_config',
        `calibration.trials must be an integer ≥ 2, got ${burn}`,
      )
    }
    calibrations = []
    analysisSeries = series.map((s) => {
      if (s.sums.length <= burn) {
        throw new NegentropyError(
          'insufficient_data',
          `${s.source} has ${s.sums.length} trials — not enough to burn ${burn} for calibration`,
          { source: s.source },
        )
      }
      calibrations.push(
        calibrate(
          { source: s.source, bitsPerTrial, sums: s.sums.slice(0, burn) },
          { minTrials: burn },
        ),
      )
      return {
        source: s.source,
        bitsPerTrial,
        sums: s.sums.slice(burn),
        timestamps: s.timestamps?.slice(burn),
      }
    })
  }

  // align lengths
  const lengths = analysisSeries.map((s) => s.sums.length)
  const steps = Math.min(...lengths)
  if (missing === 'error' && new Set(lengths).size > 1) {
    throw new NegentropyError(
      'invalid_config',
      `series lengths differ (${lengths.join(', ')}) — align them or use missing: 'skip' to truncate to ${steps}`,
    )
  }
  const aligned = analysisSeries.map((s) =>
    s.sums.length === steps
      ? s
      : {
          source: s.source,
          bitsPerTrial,
          sums: s.sums.slice(0, steps),
          timestamps: s.timestamps?.slice(0, steps),
        },
  )

  const sources = aligned.map((s) => s.source)
  const zBySource = aligned.map((s, i) => zScores(s, calibrations[i] as Calibration))
  const timeline = (aligned[0] as TrialSeries).timestamps

  const events: EventResult[] = []
  for (const spec of config.events ?? []) {
    const { start, end } = resolveWindow(spec, steps, timeline)
    const slices = zBySource.map((zs) => zs.slice(start, end))
    const stat = eventStatistic(spec.statistic, slices, sources)
    const windowSteps = end - start
    const stouffers = new Float64Array(windowSteps)
    const column = new Float64Array(slices.length)
    for (let t = 0; t < windowSteps; t++) {
      for (let i = 0; i < slices.length; i++) column[i] = (slices[i] as Float64Array)[t] as number
      stouffers[t] = stoufferZ(column)
    }
    events.push({
      id: spec.id,
      ...(spec.label !== undefined && { label: spec.label }),
      statistic: spec.statistic,
      value: stat.statistic,
      df: stat.df,
      pValue: stat.pValue,
      z: pToZ(stat.pValue),
      steps: windowSteps,
      cumulative: cumulativeDeviation(stouffers),
      sources,
    })
  }

  const composite =
    events.length > 0 ? compositeZ(events) : { z: Number.NaN, pValue: Number.NaN, events: 0 }

  return {
    events,
    composite,
    calibration: calibrations,
    series: aligned,
    ...(registration !== undefined && { registration }),
  }
}

/** Convenience wrapper: recorded raw bytes per source → trials → analyzeTrials. */
export function analyzeBytes(
  recordings: ReadonlyArray<{ source: string; bytes: Uint8Array }>,
  configOrRegistration: ExperimentConfig | RegisteredExperiment,
): ExperimentResult {
  const { config } = resolveConfig(configOrRegistration)
  const series = recordings.map((r) => trialsFromBytes(r.bytes, r.source, config.trial))
  return analyzeTrials(series, configOrRegistration)
}
