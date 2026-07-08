import { NegentropyError } from '../errors.js'
import { calibrate, theoreticalCalibration } from '../stats/calibration.js'
import { DEFAULT_BITS_PER_TRIAL, trialStream } from '../stats/trials.js'
import { stoufferZ } from '../stats/zscores.js'
import type { Calibration, Trial, TrialSource } from '../types.js'
import { analyzeTrials } from './batch.js'
import type { RegisteredExperiment } from './registration.js'
import type { EventSpec, ExperimentConfig, ExperimentResult } from './types.js'

export interface SessionOptions extends ExperimentConfig {
  sources: readonly TrialSource[]
  signal?: AbortSignal
  /** Max wait per lock-step round before 'timeout' (or a skip, under missing:'skip'). Default 30_000. */
  stepTimeoutMs?: number
  /** Clock override for deterministic tests. */
  now?: () => number
  /** Pre-registered config: overrides the inline trial/calibration/events/missing and embeds its hash. */
  registration?: RegisteredExperiment
}

export interface SessionTick {
  step: number
  at: number
  /** Aligned to `sources`; NaN for a source that missed this round. */
  zBySource: Float64Array
  /** Names of the sources that contributed this round. */
  present: readonly string[]
  /** Stouffer Z over the present sources. */
  stouffer: number
  /** Running Σ Z² — live dashboard feed. */
  netvar: number
  /** Running Σ (Z² − 1) — the live cumulative-deviation value. */
  cumdev: number
  /** Events whose window contains this step (index windows) or this instant (Date windows). */
  activeEvents: readonly string[]
}

export interface Session extends AsyncIterable<SessionTick> {
  /**
   * End the run and analyze everything recorded so far via the batch core —
   * a later re-analysis of `result.series` reproduces this result exactly.
   */
  stop(): ExperimentResult
}

const STEP_TIMEOUT: unique symbol = Symbol('step-timeout')

function stepDeadline(ms: number): { promise: Promise<typeof STEP_TIMEOUT>; cancel: () => void } {
  let id: ReturnType<typeof setTimeout> | undefined
  const promise = new Promise<typeof STEP_TIMEOUT>((resolve) => {
    id = setTimeout(() => resolve(STEP_TIMEOUT), ms)
  })
  return { promise, cancel: () => clearTimeout(id) }
}

/**
 * Live experiment over N sources in lock-step rounds: each tick awaits one
 * trial from every (still-active) source, so z vectors are step-aligned with
 * bounded memory — one trial per source in flight. Lazy: no source I/O until
 * the first tick is pulled. A stalled source stalls the round (that is the
 * honest behavior for netvar, which needs simultaneity); under
 * missing:'skip' the round proceeds with whoever answered and a source that
 * ends is dropped from the roster.
 */
export function session(opts: SessionOptions): Session {
  const { sources } = opts
  if (sources.length === 0) {
    throw new NegentropyError('invalid_config', 'session needs at least one source')
  }
  const names = new Set(sources.map((s) => s.name))
  if (names.size !== sources.length) {
    throw new NegentropyError('invalid_config', 'source names must be unique')
  }
  const config: ExperimentConfig = opts.registration ? opts.registration.config : opts
  const bitsPerTrial = config.trial?.bitsPerTrial ?? DEFAULT_BITS_PER_TRIAL
  const missing = config.missing ?? 'error'
  const stepTimeoutMs = opts.stepTimeoutMs ?? 30_000
  const now = opts.now ?? (() => Date.now())
  const events = config.events ?? []

  // recorded per-source trial data (post-calibration) + the tick timeline
  const sums: number[][] = sources.map(() => [])
  const trialTimes: number[][] = sources.map(() => [])
  let calibrations: Calibration[] | null = Array.isArray(config.calibration)
    ? null // resolved in start() with validation
    : config.calibration && typeof config.calibration === 'object'
      ? null // burn-in — resolved live
      : sources.map((s) => theoreticalCalibration(s.name, bitsPerTrial))

  let stopped = false
  let generator: AsyncGenerator<SessionTick> | null = null
  const iterators: AsyncGenerator<Trial>[] = []
  const registrationHash: string | undefined = opts.registration?.hash

  let abortPromise: Promise<never> | null = null
  if (opts.signal) {
    const signal = opts.signal
    abortPromise = new Promise<never>((_, reject) => {
      signal.addEventListener(
        'abort',
        () => reject(new NegentropyError('aborted', 'session aborted')),
        { once: true },
      )
    })
    abortPromise.catch(() => {}) // guard: session may end before anyone awaits it
  }

  function resolveProvidedCalibrations(): Calibration[] {
    const provided = config.calibration as readonly Calibration[]
    return sources.map((s) => {
      const cal = provided.find((c) => c.source === s.name && c.bitsPerTrial === bitsPerTrial)
      if (!cal) {
        throw new NegentropyError(
          'calibration_required',
          `no calibration provided for ${s.name}@${bitsPerTrial} bits`,
          { source: s.name },
        )
      }
      return cal
    })
  }

  async function pullOne(index: number): Promise<Trial> {
    const deadline = stepDeadline(stepTimeoutMs)
    try {
      const raced = await Promise.race([
        (iterators[index] as AsyncGenerator<Trial>).next(),
        deadline.promise,
        ...(abortPromise ? [abortPromise] : []),
      ])
      if (raced === STEP_TIMEOUT) {
        throw new NegentropyError(
          'timeout',
          `no trial from ${sources[index]?.name} within ${stepTimeoutMs}ms`,
          {
            source: sources[index]?.name,
          },
        )
      }
      if ((raced as IteratorResult<Trial>).done) {
        throw new NegentropyError(
          'source_ended',
          `${sources[index]?.name} ended during calibration`,
          {
            source: sources[index]?.name,
          },
        )
      }
      return (raced as IteratorResult<Trial>).value as Trial
    } finally {
      deadline.cancel()
    }
  }

  async function burnInCalibration(burn: number): Promise<Calibration[]> {
    if (!Number.isInteger(burn) || burn < 2) {
      throw new NegentropyError(
        'invalid_config',
        `calibration.trials must be an integer ≥ 2, got ${burn}`,
      )
    }
    return Promise.all(
      sources.map(async (source, i) => {
        const collected = new Float64Array(burn)
        for (let t = 0; t < burn; t++) collected[t] = (await pullOne(i)).sum
        return calibrate(
          { source: source.name, bitsPerTrial, sums: collected },
          { minTrials: burn },
        )
      }),
    )
  }

  async function* run(): AsyncGenerator<SessionTick> {
    if (opts.signal?.aborted) throw new NegentropyError('aborted', 'session aborted before start')
    for (const source of sources) {
      iterators.push(
        trialStream(source, {
          ...config.trial,
          signal: opts.signal,
          ...(opts.now && { now: opts.now }),
        }),
      )
    }
    if (!calibrations) {
      calibrations = Array.isArray(config.calibration)
        ? resolveProvidedCalibrations()
        : await burnInCalibration((config.calibration as { trials: number }).trials)
    }

    const active = sources.map(() => true)
    const pending: (Promise<IteratorResult<Trial>> | null)[] = sources.map(() => null)
    let step = 0
    let runningNetvar = 0
    let runningCumdev = 0

    try {
      while (!stopped && active.some(Boolean)) {
        for (let i = 0; i < sources.length; i++) {
          if (active[i] && pending[i] === null) {
            pending[i] = (iterators[i] as AsyncGenerator<Trial>).next()
          }
        }
        const deadline = stepDeadline(stepTimeoutMs)
        let outcomes: (IteratorResult<Trial> | typeof STEP_TIMEOUT | null)[]
        try {
          outcomes = await Promise.all(
            sources.map((_, i) =>
              active[i] && pending[i]
                ? Promise.race([
                    pending[i] as Promise<IteratorResult<Trial>>,
                    deadline.promise,
                    ...(abortPromise ? [abortPromise] : []),
                  ])
                : Promise.resolve(null),
            ),
          )
        } finally {
          deadline.cancel()
        }
        if (stopped) break

        const zBySource = new Float64Array(sources.length).fill(Number.NaN)
        const present: string[] = []
        const presentZ: number[] = []
        for (let i = 0; i < sources.length; i++) {
          const outcome = outcomes[i]
          if (outcome === null || outcome === undefined) continue
          if (outcome === STEP_TIMEOUT) {
            if (missing === 'error') {
              throw new NegentropyError(
                'timeout',
                `no trial from ${sources[i]?.name} within ${stepTimeoutMs}ms`,
                { source: sources[i]?.name },
              )
            }
            continue // pending promise carries into the next round
          }
          pending[i] = null
          if (outcome.done) {
            if (missing === 'error') {
              throw new NegentropyError('source_ended', `${sources[i]?.name} ended mid-session`, {
                source: sources[i]?.name,
              })
            }
            active[i] = false
            continue
          }
          const trial = outcome.value as Trial
          const cal = calibrations[i] as Calibration
          const z = (trial.sum - cal.mean) / cal.sd
          zBySource[i] = z
          present.push(sources[i]?.name as string)
          presentZ.push(z)
          ;(sums[i] as number[]).push(trial.sum)
          ;(trialTimes[i] as number[]).push(trial.at ?? now())
        }

        if (present.length === 0) {
          if (!active.some(Boolean)) break
          continue // everyone slow this round — keep waiting
        }

        const at = now()
        const stouffer = stoufferZ(presentZ)
        runningNetvar += stouffer * stouffer
        runningCumdev += stouffer * stouffer - 1
        const activeEvents = events
          .filter((event) => windowContains(event, step, at))
          .map((event) => event.id)

        yield {
          step,
          at,
          zBySource,
          present,
          stouffer,
          netvar: runningNetvar,
          cumdev: runningCumdev,
          activeEvents,
        }
        step++
      }
    } finally {
      for (const iterator of iterators) void iterator.return(undefined).catch(() => {})
    }
  }

  function windowContains(event: EventSpec, step: number, at: number): boolean {
    if (event.start instanceof Date && event.end instanceof Date) {
      return at >= event.start.getTime() && at < event.end.getTime()
    }
    return (
      typeof event.start === 'number' &&
      typeof event.end === 'number' &&
      step >= event.start &&
      step < event.end
    )
  }

  return {
    [Symbol.asyncIterator]() {
      generator ??= run()
      return generator
    },
    stop(): ExperimentResult {
      stopped = true
      for (const iterator of iterators) void iterator.return(undefined).catch(() => {})
      if (!calibrations) {
        throw new NegentropyError(
          'insufficient_data',
          'session stopped before live calibration completed',
        )
      }
      const series = sources.map((source, i) => ({
        source: source.name,
        bitsPerTrial,
        sums: Float64Array.from(sums[i] as number[]),
        timestamps: Float64Array.from(trialTimes[i] as number[]),
      }))
      const result = analyzeTrials(series, {
        trial: config.trial,
        calibration: calibrations,
        events,
        missing: 'skip', // roster changes/misses make exact alignment impossible live
      })
      return registrationHash !== undefined ? { ...result, registration: registrationHash } : result
    },
  }
}
