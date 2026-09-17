import { NegentropyError } from '../errors.js'
import { DEFAULT_BITS_PER_TRIAL, validateBitsPerTrial } from '../stats/trials.js'
import type { Calibration, TrialClock } from '../types.js'
import type {
  BeaconAnchor,
  EventSpec,
  ExperimentConfig,
  RegistrationAnchors,
  ResolvedExperimentConfig,
} from './types.js'

/**
 * Experiment-config validation (shared by registerExperiment, session and the
 * batch core) and default resolution (registration only). Window-shape errors
 * throw `invalid_window`; everything else `invalid_config`.
 */

const STATISTICS: ReadonlySet<string> = new Set(['netvar', 'devvar', 'correlation', 'covar'])
const HEX = /^(?:[0-9a-fA-F]{2})+$/

function fail(message: string): never {
  throw new NegentropyError('invalid_config', message)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function validateClock(clock: unknown, where: string): void {
  if (clock === undefined) return
  if (!isObject(clock)) fail(`${where}.clock must be an object`)
  if (clock.mode === 'count') return
  if (clock.mode !== 'interval')
    fail(`${where}.clock.mode must be count|interval, got ${clock.mode}`)
  const ms = clock.intervalMs
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) {
    fail(`${where}.clock.intervalMs must be a finite number > 0, got ${ms}`)
  }
}

/** A provided calibration: named source, valid width, finite mean, finite sd > 0. */
export function validateCalibration(cal: unknown, where: string): asserts cal is Calibration {
  if (!isObject(cal)) fail(`${where} must be a Calibration object`)
  if (!isNonEmptyString(cal.source)) fail(`${where}.source must be a non-empty string`)
  if (cal.bitsPerTrial === undefined) fail(`${where}.bitsPerTrial is required`)
  validateBitsPerTrial(cal.bitsPerTrial as number, cal.source)
  if (!Number.isSafeInteger(cal.trials) || (cal.trials as number) < 0) {
    fail(`${where}.trials must be an integer ≥ 0, got ${cal.trials}`)
  }
  if (typeof cal.mean !== 'number' || !Number.isFinite(cal.mean)) {
    fail(`${where}.mean must be finite, got ${cal.mean}`)
  }
  if (typeof cal.sd !== 'number' || !Number.isFinite(cal.sd) || !(cal.sd > 0)) {
    fail(`${where}.sd must be a finite number > 0, got ${cal.sd}`)
  }
  if (cal.basis !== 'empirical' && cal.basis !== 'theoretical') {
    fail(`${where}.basis must be empirical|theoretical, got ${cal.basis}`)
  }
}

function validateCalibrationSpec(spec: unknown): void {
  if (spec === undefined || spec === 'theoretical') return
  if (Array.isArray(spec)) {
    const names = new Set<string>()
    spec.forEach((cal: unknown, i) => {
      validateCalibration(cal, `calibration[${i}]`)
      if (names.has(cal.source)) fail(`calibration lists source ${cal.source} twice`)
      names.add(cal.source)
    })
    return
  }
  if (!isObject(spec)) {
    fail(`calibration must be 'theoretical', a Calibration[] or { trials }, got ${String(spec)}`)
  }
  if (!Number.isSafeInteger(spec.trials) || (spec.trials as number) < 2) {
    fail(`calibration.trials must be an integer ≥ 2, got ${spec.trials}`)
  }
}

function windowError(id: string, message: string): never {
  throw new NegentropyError('invalid_window', `event ${id}: ${message}`)
}

function validateEvent(event: unknown, index: number, ids: Set<string>): void {
  if (!isObject(event)) fail(`events[${index}] must be an object`)
  if (!isNonEmptyString(event.id)) fail(`events[${index}].id must be a non-empty string`)
  const id = event.id
  if (ids.has(id)) fail(`duplicate event id ${id}`)
  ids.add(id)
  if (event.label !== undefined && typeof event.label !== 'string') {
    fail(`event ${id}: label must be a string`)
  }
  if (typeof event.statistic !== 'string' || !STATISTICS.has(event.statistic)) {
    fail(`event ${id}: statistic must be netvar|devvar|correlation|covar, got ${event.statistic}`)
  }
  const { start, end } = event
  if (start instanceof Date || end instanceof Date) {
    if (!(start instanceof Date && end instanceof Date)) {
      windowError(id, 'mixes Date and step-index bounds')
    }
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      windowError(id, 'has an invalid Date bound')
    }
    if (!(end.getTime() > start.getTime())) windowError(id, 'Date window is empty or inverted')
    return
  }
  if (typeof start !== 'number' || typeof end !== 'number') {
    windowError(id, 'bounds must both be step indices or both Dates')
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) {
    windowError(id, `step window [${start}, ${end}) must satisfy integers 0 ≤ start < end`)
  }
}

function validateBeacon(beacon: unknown, index: number): asserts beacon is BeaconAnchor {
  const where = `anchors.beacons[${index}]`
  if (!isObject(beacon)) fail(`${where} must be an object`)
  if (!isNonEmptyString(beacon.source)) fail(`${where}.source must be a non-empty string`)
  if (!isNonEmptyString(beacon.chainId)) fail(`${where}.chainId must be a non-empty string`)
  if (!Number.isSafeInteger(beacon.round) || (beacon.round as number) < 0) {
    fail(`${where}.round must be an integer ≥ 0, got ${beacon.round}`)
  }
  if (typeof beacon.timestamp !== 'string' || !Number.isFinite(Date.parse(beacon.timestamp))) {
    fail(`${where}.timestamp must be a parseable date string, got ${beacon.timestamp}`)
  }
  if (typeof beacon.valueHex !== 'string' || !HEX.test(beacon.valueHex)) {
    fail(`${where}.valueHex must be non-empty even-length hex`)
  }
  if (
    beacon.signatureHex !== undefined &&
    (typeof beacon.signatureHex !== 'string' || !HEX.test(beacon.signatureHex))
  ) {
    fail(`${where}.signatureHex must be non-empty even-length hex`)
  }
}

function validateAnchors(anchors: unknown): void {
  if (anchors === undefined) return
  if (!isObject(anchors) || !Array.isArray(anchors.beacons)) {
    fail('anchors must be { beacons: BeaconAnchor[] }')
  }
  anchors.beacons.forEach((beacon: unknown, i) => {
    validateBeacon(beacon, i)
  })
}

/**
 * Validate an experiment configuration without filling defaults: trial width
 * and clock, calibration spec (entries validated, unique sources), events
 * (unique ids, statistic, window shape), missing, anchors.
 */
export function validateExperimentConfig(config: ExperimentConfig): void {
  if (!isObject(config)) fail('experiment config must be an object')
  const trial: unknown = config.trial
  if (trial !== undefined) {
    if (!isObject(trial)) fail('trial must be an object')
    if (trial.bitsPerTrial !== undefined) validateBitsPerTrial(trial.bitsPerTrial as number)
    validateClock(trial.clock, 'trial')
  }
  validateCalibrationSpec(config.calibration)
  const events: unknown = config.events
  if (events !== undefined) {
    if (!Array.isArray(events)) fail('events must be an array')
    const ids = new Set<string>()
    events.forEach((event: unknown, i) => {
      validateEvent(event, i, ids)
    })
  }
  if (config.missing !== undefined && config.missing !== 'error' && config.missing !== 'skip') {
    fail(`missing must be error|skip, got ${String(config.missing)}`)
  }
  validateAnchors(config.anchors)
}

function rejectUnknownKeys(value: object, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`unknown key ${where}.${key} — registrations are strict`)
  }
}

const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Validate and fill every default (trial width 200, count clock, theoretical
 * calibration, missing 'error', no anchors). Registration is strict: unknown
 * keys anywhere in the config throw `invalid_config`, and provided
 * calibrations must match the resolved trial width. Returns fresh objects
 * (Dates copied, calibrations sorted by source, hex lower-cased).
 */
export function resolveExperimentConfig(config: ExperimentConfig): ResolvedExperimentConfig {
  validateExperimentConfig(config)
  rejectUnknownKeys(config, ['trial', 'calibration', 'events', 'missing', 'anchors'], 'config')
  if (config.trial) {
    rejectUnknownKeys(config.trial, ['bitsPerTrial', 'clock'], 'trial')
    if (config.trial.clock) {
      const keys = config.trial.clock.mode === 'interval' ? ['mode', 'intervalMs'] : ['mode']
      rejectUnknownKeys(config.trial.clock, keys, 'trial.clock')
    }
  }
  const bitsPerTrial = config.trial?.bitsPerTrial ?? DEFAULT_BITS_PER_TRIAL
  const given = config.trial?.clock
  const clock: TrialClock =
    given?.mode === 'interval'
      ? { mode: 'interval', intervalMs: given.intervalMs }
      : { mode: 'count' }

  const spec = config.calibration ?? 'theoretical'
  let calibration: ResolvedExperimentConfig['calibration']
  if (spec === 'theoretical') {
    calibration = 'theoretical'
  } else if (Array.isArray(spec)) {
    calibration = (spec as readonly Calibration[])
      .map((cal, i) => {
        rejectUnknownKeys(
          cal,
          ['source', 'bitsPerTrial', 'trials', 'mean', 'sd', 'basis'],
          `calibration[${i}]`,
        )
        if (cal.bitsPerTrial !== bitsPerTrial) {
          fail(
            `calibration for ${cal.source} is at ${cal.bitsPerTrial} bits but the registered trial width is ${bitsPerTrial} — set trial.bitsPerTrial`,
          )
        }
        const { source, trials, mean, sd, basis } = cal
        return { source, bitsPerTrial, trials, mean, sd, basis }
      })
      .sort((a, b) => byCodeUnits(a.source, b.source))
  } else {
    rejectUnknownKeys(spec, ['trials'], 'calibration')
    calibration = { trials: (spec as { trials: number }).trials }
  }

  const events = (config.events ?? []).map((event, i): EventSpec => {
    rejectUnknownKeys(event, ['id', 'label', 'statistic', 'start', 'end'], `events[${i}]`)
    const copy = (bound: number | Date) =>
      bound instanceof Date ? new Date(bound.getTime()) : bound
    return {
      id: event.id,
      ...(event.label !== undefined && { label: event.label }),
      statistic: event.statistic,
      start: copy(event.start),
      end: copy(event.end),
    }
  })

  let anchors: RegistrationAnchors = { beacons: [] }
  if (config.anchors) {
    rejectUnknownKeys(config.anchors, ['beacons'], 'anchors')
    anchors = {
      beacons: config.anchors.beacons.map((beacon, i) => {
        rejectUnknownKeys(
          beacon,
          ['source', 'chainId', 'round', 'timestamp', 'valueHex', 'signatureHex'],
          `anchors.beacons[${i}]`,
        )
        return {
          source: beacon.source,
          chainId: beacon.chainId,
          round: beacon.round,
          timestamp: beacon.timestamp,
          valueHex: beacon.valueHex.toLowerCase(),
          ...(beacon.signatureHex !== undefined && {
            signatureHex: beacon.signatureHex.toLowerCase(),
          }),
        }
      }),
    }
  }

  return {
    trial: { bitsPerTrial, clock },
    calibration,
    events,
    missing: config.missing ?? 'error',
    anchors,
  }
}

/** JSON-able form of a resolved config: Date bounds become ISO 8601 strings (UTC, ms). */
export function canonicalShape(resolved: ResolvedExperimentConfig): unknown {
  return {
    ...resolved,
    events: resolved.events.map((event) => ({
      ...event,
      start: event.start instanceof Date ? event.start.toISOString() : event.start,
      end: event.end instanceof Date ? event.end.toISOString() : event.end,
    })),
  }
}
