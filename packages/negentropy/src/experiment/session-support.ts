import { NegentropyError } from '../errors.js'
import type { Calibration, TrialSource } from '../types.js'
import type { ExperimentConfig } from './types.js'

/** setTimeout's delay is a signed 32-bit int: anything larger fires after 1 ms. */
export const MAX_TIMEOUT_MS = 2 ** 31 - 1

export const STEP_TIMEOUT: unique symbol = Symbol('step-timeout')

export const noop = (): void => {}

/**
 * Resolve `stepTimeoutMs`: a finite number in (0, 2³¹ − 1], or Infinity for
 * "no deadline". Anything else throws `invalid_config`.
 */
export function validateStepTimeout(ms: unknown): number {
  if (ms === Number.POSITIVE_INFINITY) return ms
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0 || ms > MAX_TIMEOUT_MS) {
    throw new NegentropyError(
      'invalid_config',
      `stepTimeoutMs must be a finite number in (0, ${MAX_TIMEOUT_MS}] or Infinity (no deadline), got ${String(ms)}`,
    )
  }
  return ms
}

export interface Deadline {
  readonly promise: Promise<typeof STEP_TIMEOUT>
  cancel(): void
}

/**
 * A timer resolving to STEP_TIMEOUT after `ms` (timers run on the monotonic
 * clock, so wall-clock adjustments cannot mis-time a round); null for
 * Infinity — the race is then omitted entirely.
 */
export function stepDeadline(ms: number): Deadline | null {
  if (ms === Number.POSITIVE_INFINITY) return null
  let id: ReturnType<typeof setTimeout> | undefined
  const promise = new Promise<typeof STEP_TIMEOUT>((resolve) => {
    id = setTimeout(() => resolve(STEP_TIMEOUT), ms)
  })
  return { promise, cancel: () => clearTimeout(id) }
}

/** Unique, well-formed sources (`invalid_config`). */
export function validateSources(sources: unknown): readonly TrialSource[] {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new NegentropyError('invalid_config', 'session needs at least one source')
  }
  const names = new Set<string>()
  for (const source of sources as unknown[]) {
    const candidate = source as Partial<TrialSource> | null
    if (
      candidate === null ||
      typeof candidate !== 'object' ||
      typeof candidate.name !== 'string' ||
      candidate.name === '' ||
      typeof candidate.stream !== 'function'
    ) {
      throw new NegentropyError(
        'invalid_config',
        'every source needs a non-empty name and a stream() method',
      )
    }
    if (names.has(candidate.name)) {
      throw new NegentropyError('invalid_config', 'source names must be unique')
    }
    names.add(candidate.name)
  }
  return sources as readonly TrialSource[]
}

/** Detached copy of an (already validated) inline config, so later caller mutation cannot change the run. */
export function snapshotConfig(config: ExperimentConfig): ExperimentConfig {
  const spec = config.calibration
  return {
    ...(config.trial !== undefined && {
      trial: {
        ...config.trial,
        ...(config.trial.clock !== undefined && { clock: { ...config.trial.clock } }),
      },
    }),
    ...(spec !== undefined && {
      calibration:
        typeof spec === 'string'
          ? spec
          : Array.isArray(spec)
            ? (spec as readonly Calibration[]).map((cal) => ({ ...cal }))
            : { trials: (spec as { trials: number }).trials },
    }),
    ...(config.events !== undefined && {
      events: config.events.map((event) => ({
        ...event,
        start: event.start instanceof Date ? new Date(event.start.getTime()) : event.start,
        end: event.end instanceof Date ? new Date(event.end.getTime()) : event.end,
      })),
    }),
    ...(config.missing !== undefined && { missing: config.missing }),
  }
}

/**
 * A promise that rejects once `signal` aborts, with a listener that is
 * removed by `dispose()` — no listener outlives the run.
 */
export function abortPromise(signal: AbortSignal): {
  readonly promise: Promise<never>
  dispose(): void
} {
  let onAbort = noop
  const promise = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason)
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
  void promise.catch(noop) // the run may end before anyone awaits it
  return { promise, dispose: () => signal.removeEventListener('abort', onAbort) }
}
