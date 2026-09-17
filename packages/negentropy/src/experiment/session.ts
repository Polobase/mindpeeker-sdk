import { NegentropyError } from '../errors.js'
import { KahanSum } from '../internal/kahan.js'
import { calibrate, theoreticalCalibration } from '../stats/calibration.js'
import { trialStream, validateBitsPerTrial } from '../stats/trials.js'
import { stoufferZ } from '../stats/zscores.js'
import type { Calibration, Trial, TrialSeries, TrialSource } from '../types.js'
import { analyzeTrials, unanalysedResult } from './batch.js'
import { validateExperimentConfig } from './config.js'
import type { RegisteredExperiment } from './registration.js'
import { assertRegistrationIntact, isRegistration } from './registration.js'
import {
  abortPromise,
  noop,
  STEP_TIMEOUT,
  snapshotConfig,
  stepDeadline,
  validateSources,
  validateStepTimeout,
} from './session-support.js'
import type { EventSpec, ExperimentConfig, ExperimentResult } from './types.js'

export interface SessionOptions extends ExperimentConfig {
  sources: readonly TrialSource[]
  /** Aborting it ends the run with `aborted` and releases every source; `stop()` still works afterwards. */
  signal?: AbortSignal
  /**
   * Max wait per lock-step round (and per burn-in pull) before 'timeout' — or
   * a skip under missing:'skip'. A finite number in (0, 2³¹ − 1] ms, or
   * `Infinity` for no deadline; anything else throws `invalid_config`.
   * Default 30_000.
   */
  stepTimeoutMs?: number
  /** Clock for tick timestamps (Date windows) — override for deterministic tests. Default Date.now. */
  now?: () => number
  /** Pre-registered config: replaces the inline trial/calibration/events/missing and embeds its hash. */
  registration?: RegisteredExperiment
}

export interface SessionTick {
  step: number
  /** Tick time from `now()`; archived as every source's timestamp for this step. */
  at: number
  /** Aligned to `sources`; NaN for a source that missed this round (or left the roster). */
  zBySource: Float64Array
  /** Names of the sources that contributed this round. */
  present: readonly string[]
  /** Stouffer Z over the present sources. */
  stouffer: number
  /** Running Σ Z² — equals the batch netvar over steps [0, step]. */
  netvar: number
  /** Running Σ (Z² − 1) — the live cumulative-deviation value. */
  cumdev: number
  /** Events whose window contains this step (index windows) or this instant (Date windows). */
  activeEvents: readonly string[]
}

export interface Session extends AsyncIterable<SessionTick> {
  /**
   * End the run, release every source, and analyze the archive. Total: never
   * throws — events whose window has not elapsed come back
   * `status: 'incomplete'`, and a session stopped during burn-in returns its
   * (empty) archive with every event incomplete. Reproduce the result exactly
   * with `analyzeTrials(result.series, { registration, calibration: result.calibration })`
   * (unregistered: `{ ...config, calibration: result.calibration }`).
   */
  stop(): ExperimentResult
  /** Snapshot of the step-aligned archive so far (post-calibration; NaN = absent). */
  series(): readonly TrialSeries[]
}

type Outcome = IteratorResult<Trial> | typeof STEP_TIMEOUT

/**
 * Live experiment over N sources in lock-step rounds: each tick awaits one
 * trial from every source still in the roster, so z vectors are step-aligned
 * with bounded memory (one trial per source in flight). Lazy: no source I/O
 * until the first tick is pulled.
 *
 * Archive: one row per tick for every source — its trial sum, or NaN when it
 * missed the round — stamped with the tick time, so `series()` and
 * `result.series` stay step-aligned and are never truncated.
 *
 * missing:'error' (default): a round timeout throws `timeout`, a source that
 * ends throws `source_ended` (also during burn-in). missing:'skip': the round
 * proceeds with whoever answered (a slow source's pending trial carries into
 * a later round), a source that ends leaves the roster, and during burn-in a
 * source that times out or ends is dropped from the roster and the archive.
 *
 * Validation happens here, not later: sources, config (events, windows,
 * calibrations), `stepTimeoutMs`, and provided calibrations
 * (`calibration_required` when a source has none at the trial width). A
 * correlation event needs ≥ 2 sources.
 *
 * Abort: the session owns an AbortController linked to `signal` and passes
 * it to every `source.stream()`; `stop()`, the caller's abort, and leaving
 * the loop all abort it, so sockets and hardware are released. Listeners
 * added to the caller's signal are removed when the run ends.
 */
export function session(opts: SessionOptions): Session {
  if (opts === null || typeof opts !== 'object') {
    throw new NegentropyError('invalid_config', 'session needs an options object')
  }
  const sources = validateSources(opts.sources)
  let registration: RegisteredExperiment | undefined
  if (opts.registration !== undefined) {
    if (!isRegistration(opts.registration)) {
      throw new NegentropyError(
        'invalid_config',
        'registration must come from registerExperiment()',
      )
    }
    assertRegistrationIntact(opts.registration)
    registration = opts.registration
  }
  let config: ExperimentConfig = opts
  if (registration) config = registration.config
  validateExperimentConfig(config)
  if (!registration) config = snapshotConfig(opts)
  const bitsPerTrial = validateBitsPerTrial(config.trial?.bitsPerTrial)
  const missing = config.missing ?? 'error'
  const events: readonly EventSpec[] = config.events ?? []
  if (sources.length < 2 && events.some((event) => event.statistic === 'correlation')) {
    throw new NegentropyError('invalid_config', 'a correlation event needs at least 2 sources')
  }
  const stepTimeoutMs = validateStepTimeout(opts.stepTimeoutMs ?? 30_000)
  if (opts.now !== undefined && typeof opts.now !== 'function') {
    throw new NegentropyError('invalid_config', 'now must be a function')
  }
  const now = opts.now ?? (() => Date.now())
  const callerSignal = opts.signal
  if (callerSignal !== undefined && typeof callerSignal?.addEventListener !== 'function') {
    throw new NegentropyError('invalid_config', 'signal must be an AbortSignal')
  }

  const spec = config.calibration ?? 'theoretical'
  let calibrations: (Calibration | null)[] | null = null
  if (spec === 'theoretical') {
    calibrations = sources.map((s) => theoreticalCalibration(s.name, bitsPerTrial))
  } else if (Array.isArray(spec)) {
    calibrations = sources.map((s) => {
      const cal = (spec as readonly Calibration[]).find(
        (c) => c.source === s.name && c.bitsPerTrial === bitsPerTrial,
      )
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
  const burn = calibrations === null ? (spec as { trials: number }).trials : 0

  // step-aligned archive: one row per tick for every included source
  const included = sources.map(() => true)
  const sums: number[][] = sources.map(() => [])
  const times: number[] = []

  const sessionController = new AbortController()
  const sourceControllers = sources.map(() => new AbortController())
  const iterators: AsyncGenerator<Trial>[] = []
  let stopped = false
  let generator: AsyncGenerator<SessionTick> | null = null
  let detachCaller = noop

  function release(): void {
    detachCaller()
    detachCaller = noop
    if (!sessionController.signal.aborted) sessionController.abort()
    for (const controller of sourceControllers) if (!controller.signal.aborted) controller.abort()
    for (const iterator of iterators) void iterator.return(undefined).catch(noop)
  }

  function timeoutError(i: number, phase: string): NegentropyError {
    const name = sources[i]?.name as string
    return new NegentropyError(
      'timeout',
      `no trial from ${name} within ${stepTimeoutMs}ms${phase}`,
      {
        source: name,
      },
    )
  }

  function endedError(i: number, phase: string): NegentropyError {
    const name = sources[i]?.name as string
    return new NegentropyError('source_ended', `${name} ended ${phase}`, { source: name })
  }

  async function race(pending: Promise<IteratorResult<Trial>>, aborted: Promise<never>) {
    const deadline = stepDeadline(stepTimeoutMs)
    try {
      return await Promise.race<Outcome>(
        deadline ? [pending, deadline.promise, aborted] : [pending, aborted],
      )
    } finally {
      deadline?.cancel()
    }
  }

  async function burnIn(aborted: Promise<never>): Promise<void> {
    const fitted = await Promise.all(
      sources.map(async (source, i) => {
        const collected = new Float64Array(burn)
        for (let t = 0; t < burn; t++) {
          const pending = (iterators[i] as AsyncGenerator<Trial>).next()
          void pending.catch(noop)
          const outcome = await race(pending, aborted)
          if (outcome === STEP_TIMEOUT || outcome.done) {
            if (missing === 'error') {
              throw outcome === STEP_TIMEOUT
                ? timeoutError(i, ' during calibration')
                : endedError(i, 'during calibration')
            }
            ;(sourceControllers[i] as AbortController).abort() // release it right away
            return null // dropped from the roster
          }
          collected[t] = outcome.value.sum
        }
        return calibrate(
          { source: source.name, bitsPerTrial, sums: collected },
          { minTrials: burn },
        )
      }),
    )
    fitted.forEach((cal, i) => {
      if (cal === null) included[i] = false
    })
    calibrations = fitted
    if (!included.some(Boolean)) {
      throw new NegentropyError('insufficient_data', 'no source completed its calibration window')
    }
  }

  async function* run(): AsyncGenerator<SessionTick> {
    if (stopped) return
    if (callerSignal?.aborted) throw new NegentropyError('aborted', 'session aborted before start')
    if (callerSignal) {
      const onCallerAbort = () => {
        if (!sessionController.signal.aborted) sessionController.abort(callerSignal.reason)
        for (const controller of sourceControllers) controller.abort(callerSignal.reason)
      }
      callerSignal.addEventListener('abort', onCallerAbort, { once: true })
      detachCaller = () => callerSignal.removeEventListener('abort', onCallerAbort)
    }
    const abort = abortPromise(sessionController.signal)
    try {
      sources.forEach((source, i) => {
        const signal = (sourceControllers[i] as AbortController).signal
        iterators.push(trialStream(source, { ...config.trial, signal, ...(opts.now && { now }) }))
      })
      if (calibrations === null) await burnIn(abort.promise)
      const cals = calibrations as unknown as readonly (Calibration | null)[]

      const active = included.slice()
      const pending: (Promise<IteratorResult<Trial>> | null)[] = sources.map(() => null)
      const netvar = new KahanSum()
      const cumdev = new KahanSum()
      let step = 0
      while (!stopped && active.some(Boolean)) {
        for (let i = 0; i < sources.length; i++) {
          if (active[i] && pending[i] === null) {
            const next = (iterators[i] as AsyncGenerator<Trial>).next()
            void next.catch(noop)
            pending[i] = next
          }
        }
        const outcomes = await Promise.all(
          sources.map((_, i) =>
            active[i] && pending[i]
              ? race(pending[i] as Promise<IteratorResult<Trial>>, abort.promise)
              : Promise.resolve(null),
          ),
        )
        if (stopped) break
        if (missing === 'error') {
          outcomes.forEach((outcome, i) => {
            if (outcome === STEP_TIMEOUT) throw timeoutError(i, '')
            if (outcome?.done) throw endedError(i, 'mid-session')
          })
        }

        const zBySource = new Float64Array(sources.length).fill(Number.NaN)
        const row = new Float64Array(sources.length).fill(Number.NaN)
        const present: string[] = []
        const presentZ: number[] = []
        outcomes.forEach((outcome, i) => {
          if (outcome === null || outcome === STEP_TIMEOUT) return // absent this round
          pending[i] = null
          if (outcome.done) {
            active[i] = false // left the roster
            return
          }
          const cal = cals[i] as Calibration
          const z = (outcome.value.sum - cal.mean) / cal.sd
          zBySource[i] = z
          row[i] = outcome.value.sum
          present.push(sources[i]?.name as string)
          presentZ.push(z)
        })
        if (present.length === 0) continue // nobody answered — no tick, keep waiting

        const at = now()
        for (let i = 0; i < sources.length; i++) {
          if (included[i]) (sums[i] as number[]).push(row[i] as number)
        }
        times.push(at)
        const stouffer = stoufferZ(presentZ)
        netvar.add(stouffer * stouffer)
        cumdev.add(stouffer * stouffer - 1)
        yield {
          step,
          at,
          zBySource,
          present,
          stouffer,
          netvar: netvar.value,
          cumdev: cumdev.value,
          activeEvents: events.filter((e) => windowContains(e, step, at)).map((e) => e.id),
        }
        step++
      }
    } catch (error) {
      if (stopped) return // stop() ends the run cleanly
      if (sessionController.signal.aborted) {
        throw new NegentropyError('aborted', 'session aborted', { cause: error })
      }
      throw error
    } finally {
      abort.dispose()
      release()
    }
  }

  function windowContains(event: EventSpec, step: number, at: number): boolean {
    if (event.start instanceof Date && event.end instanceof Date) {
      return at >= event.start.getTime() && at < event.end.getTime()
    }
    return step >= (event.start as number) && step < (event.end as number)
  }

  function archive(): TrialSeries[] {
    const timestamps = Float64Array.from(times)
    const out: TrialSeries[] = []
    sources.forEach((source, i) => {
      if (!included[i]) return
      out.push({
        source: source.name,
        bitsPerTrial,
        sums: Float64Array.from(sums[i] as number[]),
        timestamps: timestamps.slice(),
      })
    })
    return out
  }

  return {
    [Symbol.asyncIterator]() {
      generator ??= run()
      return generator
    },
    series: archive,
    stop(): ExperimentResult {
      stopped = true
      release()
      const series = archive()
      const hash = registration?.hash
      if (calibrations === null) {
        return unanalysedResult(
          events,
          series,
          [],
          'session stopped before its calibration window completed',
          hash,
        )
      }
      const fitted = calibrations.filter((cal): cal is Calibration => cal !== null)
      if (series.length === 0) {
        return unanalysedResult(events, series, [], 'no source completed calibration', hash)
      }
      return analyzeTrials(
        series,
        registration
          ? { registration, calibration: fitted }
          : { trial: config.trial, calibration: fitted, events, missing },
      )
    },
  }
}
