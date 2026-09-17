import { NegentropyError } from '../errors.js'
import { normPpf } from '../internal/special.js'
import { calibrate, theoreticalCalibration } from '../stats/calibration.js'
import { P_FLOOR } from '../stats/pvalues.js'
import { trialsFromBytes, validateBitsPerTrial } from '../stats/trials.js'
import type { Calibration, TrialSeries } from '../types.js'
import { brownCompositeZ, compositeZ } from './composite.js'
import { validateCalibration, validateExperimentConfig } from './config.js'
import { eventCorrelations, sharedSteps } from './dependence.js'
import {
  presentCorrelation,
  presentCounts,
  presentCovar,
  presentCumulative,
  presentDevvar,
  presentNetvar,
  type WindowStat,
} from './present.js'
import type { RegisteredExperiment } from './registration.js'
import { assertRegistrationIntact, isRegistration } from './registration.js'
import type {
  EventResult,
  EventSpec,
  ExperimentComposite,
  ExperimentConfig,
  ExperimentResult,
  Reanalysis,
} from './types.js'
import { resolveWindow } from './windows.js'

interface ResolvedInput {
  config: ExperimentConfig
  registration?: string
  override?: readonly Calibration[]
}

function resolveInput(input: ExperimentConfig | RegisteredExperiment | Reanalysis): ResolvedInput {
  if (
    input !== null &&
    typeof input === 'object' &&
    (input as { registration?: unknown }).registration !== undefined
  ) {
    const { registration, calibration } = input as Reanalysis
    if (!isRegistration(registration) || !Array.isArray(calibration)) {
      throw new NegentropyError(
        'invalid_config',
        're-analysis takes { registration: RegisteredExperiment, calibration: Calibration[] }',
      )
    }
    assertRegistrationIntact(registration)
    return { config: registration.config, registration: registration.hash, override: calibration }
  }
  if (isRegistration(input)) {
    assertRegistrationIntact(input)
    return { config: input.config, registration: input.hash }
  }
  return { config: input as ExperimentConfig }
}

/** Normal-equivalent z of a one-sided p (normPpf(1−p) = −normPpf(p), full lower-tail precision). */
function pToZ(p: number): number {
  return -normPpf(Math.min(Math.max(p, P_FLOOR), 1 - 1e-16))
}

function validateSeries(series: readonly TrialSeries[], config: ExperimentConfig): number {
  if (!Array.isArray(series) || series.length === 0) {
    throw new NegentropyError('invalid_config', 'analyzeTrials needs at least one series')
  }
  const names = new Set<string>()
  let bitsPerTrial = 0
  for (const s of series) {
    if (s === null || typeof s !== 'object' || typeof s.source !== 'string' || s.source === '') {
      throw new NegentropyError('invalid_config', 'every series needs a non-empty source name')
    }
    if (names.has(s.source)) {
      throw new NegentropyError('invalid_config', `duplicate series source ${s.source}`)
    }
    names.add(s.source)
    const k = validateBitsPerTrial(s.bitsPerTrial ?? Number.NaN, s.source)
    if (bitsPerTrial !== 0 && k !== bitsPerTrial) {
      throw new NegentropyError(
        'invalid_config',
        `mixed bitsPerTrial: ${s.source} has ${k}, ${(series[0] as TrialSeries).source} has ${bitsPerTrial}`,
      )
    }
    bitsPerTrial = k
    if (!(s.sums instanceof Float64Array)) {
      throw new NegentropyError('invalid_config', `sums of ${s.source} must be a Float64Array`)
    }
    for (let t = 0; t < s.sums.length; t++) {
      const v = s.sums[t] as number
      if (Number.isNaN(v) ? config.missing !== 'skip' : !Number.isFinite(v)) {
        throw new NegentropyError(
          'invalid_config',
          `trial sums of ${s.source}[${t}] = ${v}: NaN (an absent trial) needs missing: 'skip'; ±Infinity is never valid`,
          { source: s.source },
        )
      }
    }
    if (
      s.timestamps !== undefined &&
      !(s.timestamps instanceof Float64Array && s.timestamps.length === s.sums.length)
    ) {
      throw new NegentropyError(
        'invalid_config',
        `timestamps of ${s.source} must be a Float64Array with one entry per trial`,
      )
    }
  }
  const registered = config.trial?.bitsPerTrial
  if (registered !== undefined && registered !== bitsPerTrial) {
    throw new NegentropyError(
      'invalid_config',
      `series carry ${bitsPerTrial}-bit trials but the config specifies ${registered}`,
    )
  }
  return bitsPerTrial
}

function findCalibration(
  calibrations: readonly Calibration[],
  s: TrialSeries,
  where: string,
): Calibration {
  const cal = calibrations.find((c) => c.source === s.source)
  if (!cal) {
    throw new NegentropyError('calibration_required', `no calibration provided for ${s.source}`, {
      source: s.source,
    })
  }
  validateCalibration(cal, `${where} for ${s.source}`)
  if (cal.bitsPerTrial !== s.bitsPerTrial) {
    throw new NegentropyError(
      'calibration_required',
      `calibration is for ${cal.source}@${cal.bitsPerTrial} bits, series is ${s.source}@${s.bitsPerTrial} bits`,
      { source: s.source },
    )
  }
  return cal
}

/** Re-analysis calibrations must be what the registered spec would have produced. */
function checkOverride(spec: ExperimentConfig['calibration'], cal: Calibration): void {
  const mismatch = (why: string): never => {
    throw new NegentropyError(
      'invalid_config',
      `calibration for ${cal.source} does not match the registration: ${why}`,
      { source: cal.source },
    )
  }
  if (spec === undefined || spec === 'theoretical') {
    const theory = theoreticalCalibration(cal.source, cal.bitsPerTrial)
    if (cal.basis !== 'theoretical' || cal.mean !== theory.mean || cal.sd !== theory.sd) {
      mismatch('the registration uses theoretical calibration')
    }
  } else if (Array.isArray(spec)) {
    const registered = (spec as readonly Calibration[]).find((c) => c.source === cal.source)
    const same =
      registered !== undefined &&
      registered.bitsPerTrial === cal.bitsPerTrial &&
      registered.trials === cal.trials &&
      registered.mean === cal.mean &&
      registered.sd === cal.sd &&
      registered.basis === cal.basis
    if (!same) mismatch('it differs from the registered calibration')
  } else {
    const burn = (spec as { trials: number }).trials
    if (cal.basis !== 'empirical' || cal.trials < 2 || cal.trials > burn) {
      mismatch(`the registration burns ${burn} trials — expected an empirical fit on ≤ ${burn}`)
    }
  }
}

function incompleteEvent(
  spec: EventSpec,
  sources: readonly string[],
  reason: string,
  cumulative: Float64Array,
): EventResult {
  return {
    id: spec.id,
    ...(spec.label !== undefined && { label: spec.label }),
    statistic: spec.statistic,
    status: 'incomplete',
    reason,
    value: Number.NaN,
    df: Number.NaN,
    pValue: Number.NaN,
    z: Number.NaN,
    steps: cumulative.length,
    cumulative,
    sources,
  }
}

/** Result for an archive with nothing to analyse yet (e.g. a session stopped during burn-in). */
export function unanalysedResult(
  events: readonly EventSpec[],
  series: readonly TrialSeries[],
  calibration: readonly Calibration[],
  reason: string,
  registration?: string,
): ExperimentResult {
  const sources = series.map((s) => s.source)
  return {
    events: events.map((spec) => incompleteEvent(spec, sources, reason, new Float64Array(0))),
    composite: emptyComposite('no complete events'),
    calibration,
    series,
    analysedSteps: 0,
    ...(registration !== undefined && { registration }),
  }
}

function emptyComposite(reason: string): ExperimentComposite {
  const nan = Number.NaN
  return {
    z: nan,
    pValue: nan,
    events: 0,
    independent: true,
    method: 'stouffer',
    variance: 0,
    reason,
  }
}

function windowStatistic(
  spec: EventSpec,
  zBySource: readonly Float64Array[],
  start: number,
  end: number,
  bitsPerTrial: number,
): WindowStat | null {
  switch (spec.statistic) {
    case 'netvar':
      return presentNetvar(zBySource, start, end)
    case 'devvar':
      return presentDevvar(zBySource, start, end)
    case 'correlation':
      return zBySource.length < 2 ? null : presentCorrelation(zBySource, start, end)
    case 'covar':
      return zBySource.length < 2 ? null : presentCovar(zBySource, start, end, bitsPerTrial)
  }
}

/** The pairwise statistics (correlation, covar) need at least two sources. */
function isPairwise(statistic: EventSpec['statistic']): boolean {
  return statistic === 'correlation' || statistic === 'covar'
}

/**
 * The pure analysis core: recorded trial series in, ExperimentResult out.
 * Series must have unique non-empty source names, one trial width (matching
 * `trial.bitsPerTrial` when the config sets it), Float64Array sums (NaN =
 * absent, only under missing:'skip') and optional per-trial timestamps.
 * Under 'skip' the archive is step-aligned by index: each step combines the
 * sources present there, and a shorter series is absent past its end; under
 * 'error' lengths must agree. `result.series` is the full archive (never
 * truncated) and `analysedSteps` its step count.
 *
 * Events whose window extends past the data (or whose Date window has not
 * closed), or whose statistic has no data, come back `status: 'incomplete'`
 * instead of throwing; malformed windows still throw `invalid_window`.
 * Overlapping complete events make the composite `independent: false` and
 * switch it to Brown's correction (see `brownCompositeZ`).
 *
 * Input forms: a plain config; a `RegisteredExperiment` (hash embedded); or
 * `{ registration, calibration }` — re-analysis with the given calibrations
 * and no burn-in, validated against the registered calibration spec. A live
 * `session` result is reproduced exactly by
 * `analyzeTrials(result.series, { registration, calibration: result.calibration })`
 * (unregistered: `{ ...config, calibration: result.calibration }`).
 */
export function analyzeTrials(
  series: readonly TrialSeries[],
  configOrRegistration: ExperimentConfig | RegisteredExperiment | Reanalysis,
): ExperimentResult {
  const { config, registration, override } = resolveInput(configOrRegistration)
  validateExperimentConfig(config)
  const bitsPerTrial = validateSeries(series, config)
  const missing = config.missing ?? 'error'

  const lengths = series.map((s) => s.sums.length)
  if (missing === 'error' && new Set(lengths).size > 1) {
    throw new NegentropyError(
      'invalid_config',
      `series lengths differ (${lengths.join(', ')}) — align them or use missing: 'skip' (a shorter series is then absent past its end)`,
    )
  }

  // calibration: override (no burn), theoretical, provided, or burn the first n steps
  const spec = config.calibration ?? 'theoretical'
  let archive: readonly TrialSeries[] = series
  let calibrations: Calibration[]
  if (override) {
    calibrations = series.map((s) => findCalibration(override, s, 'calibration'))
    for (const cal of calibrations) checkOverride(config.calibration, cal)
  } else if (spec === 'theoretical') {
    calibrations = series.map((s) => theoreticalCalibration(s.source, bitsPerTrial))
  } else if (Array.isArray(spec)) {
    calibrations = series.map((s) => findCalibration(spec, s, 'calibration'))
  } else {
    const burn = (spec as { trials: number }).trials
    calibrations = series.map((s) => {
      const window = s.sums.subarray(0, burn)
      const present = missing === 'skip' ? window.filter((v) => !Number.isNaN(v)) : window
      if (Math.max(...lengths) <= burn || (missing === 'error' && s.sums.length <= burn)) {
        throw new NegentropyError(
          'insufficient_data',
          `${s.source} has ${s.sums.length} trials — not enough to burn ${burn} for calibration`,
          { source: s.source },
        )
      }
      return calibrate(
        { source: s.source, bitsPerTrial, sums: Float64Array.from(present) },
        { minTrials: missing === 'skip' ? 2 : burn },
      )
    })
    archive = series.map((s) => ({
      source: s.source,
      bitsPerTrial,
      sums: s.sums.slice(burn),
      ...(s.timestamps !== undefined && { timestamps: s.timestamps.slice(burn) }),
      ...(s.leftoverBits !== undefined && { leftoverBits: s.leftoverBits }),
    }))
  }

  const steps = Math.max(...archive.map((s) => s.sums.length))
  const sources = archive.map((s) => s.source)
  const zBySource = archive.map((s, i) => {
    const cal = calibrations[i] as Calibration
    const zs = new Float64Array(steps).fill(Number.NaN)
    for (let t = 0; t < s.sums.length; t++) zs[t] = ((s.sums[t] as number) - cal.mean) / cal.sd
    return zs
  })
  const timeline = archive.find((s) => s.timestamps?.length === steps)?.timestamps

  const events: EventResult[] = []
  const windows: { statistic: EventSpec['statistic']; start: number; end: number }[] = []
  for (const eventSpec of config.events ?? []) {
    const window = resolveWindow(eventSpec, steps, timeline)
    const cumulative = presentCumulative(zBySource, window.start, window.end)
    const stat =
      window.closed && window.end > window.start
        ? windowStatistic(eventSpec, zBySource, window.start, window.end, bitsPerTrial)
        : null
    if (!window.closed || stat === null) {
      const reason =
        window.reason ??
        (isPairwise(eventSpec.statistic) && sources.length < 2
          ? `${eventSpec.statistic} needs at least 2 sources`
          : `no usable ${eventSpec.statistic} data inside the window`)
      events.push(incompleteEvent(eventSpec, sources, reason, cumulative))
      continue
    }
    events.push({
      id: eventSpec.id,
      ...(eventSpec.label !== undefined && { label: eventSpec.label }),
      statistic: eventSpec.statistic,
      status: 'complete',
      value: stat.statistic,
      df: stat.df,
      pValue: stat.pValue,
      z: pToZ(stat.pValue),
      steps: window.end - window.start,
      cumulative,
      sources,
    })
    windows.push({ statistic: eventSpec.statistic, start: window.start, end: window.end })
  }

  return {
    events,
    composite: composite(
      events.filter((e) => e.status === 'complete'),
      windows,
      zBySource,
      steps,
      bitsPerTrial,
    ),
    calibration: calibrations,
    series: archive,
    analysedSteps: steps,
    ...(registration !== undefined && { registration }),
  }
}

function composite(
  complete: readonly EventResult[],
  windows: readonly { statistic: EventSpec['statistic']; start: number; end: number }[],
  zBySource: readonly Float64Array[],
  steps: number,
  bitsPerTrial: number,
): ExperimentComposite {
  if (complete.length === 0) return emptyComposite('no complete events')
  const overlaps: string[] = []
  for (let i = 0; i < windows.length; i++) {
    for (let j = i + 1; j < windows.length; j++) {
      const shared = sharedSteps(
        windows[i] as (typeof windows)[number],
        windows[j] as (typeof windows)[number],
      )
      if (shared > 0) overlaps.push(`${complete[i]?.id}∩${complete[j]?.id}: ${shared} steps`)
    }
  }
  if (overlaps.length === 0) return compositeZ(complete)
  const correlation = eventCorrelations(windows, presentCounts(zBySource, steps), -2 / bitsPerTrial)
  return {
    ...brownCompositeZ(complete, correlation),
    reason: `overlapping windows (${overlaps.join('; ')}) — Brown's covariance correction applied`,
  }
}

/**
 * Convenience wrapper: recorded raw bytes per source → `trialsFromBytes`
 * (count clock) → `analyzeTrials`. Raw bytes carry no timing, so a config or
 * registration with an interval clock throws `invalid_config`, as do
 * recordings without a non-empty source name or Uint8Array bytes.
 */
export function analyzeBytes(
  recordings: ReadonlyArray<{ source: string; bytes: Uint8Array }>,
  configOrRegistration: ExperimentConfig | RegisteredExperiment | Reanalysis,
): ExperimentResult {
  const { config } = resolveInput(configOrRegistration)
  if (config.trial?.clock?.mode === 'interval') {
    throw new NegentropyError(
      'invalid_config',
      "analyzeBytes cannot apply an interval clock — raw bytes carry no timing; record trials live (session) or use clock mode 'count'",
    )
  }
  if (!Array.isArray(recordings)) {
    throw new NegentropyError('invalid_config', 'recordings must be an array')
  }
  const series = recordings.map((r) => {
    if (r === null || typeof r !== 'object' || !(r.bytes instanceof Uint8Array)) {
      throw new NegentropyError(
        'invalid_config',
        'each recording needs { source, bytes: Uint8Array }',
      )
    }
    return trialsFromBytes(r.bytes, r.source, config.trial)
  })
  return analyzeTrials(series, configOrRegistration)
}
