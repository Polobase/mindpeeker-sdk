import { NegentropyError, type Trial, trialStream } from '@mindpeeker/negentropy'
import { PsiError } from '../errors.js'
import { closeIterator, nextOrAbort } from '../internal/abort.js'
import type { Intention, TrialSeries, TrialSource } from '../types.js'
import {
  INTENTIONS,
  type ResolvedTripolarPlan,
  resolveTripolarPlan,
  type TripolarOrder,
  type TripolarPlan,
  tripolarSchedule,
  tripolarScheduleDigest,
} from './tripolar-schedule.js'

export type {
  AnalyzeTripolarOptions,
  IntentionSummary,
  TripolarAnalysis,
  VarianceSummary,
} from './tripolar-analysis.js'
export { analyzeTripolar } from './tripolar-analysis.js'
export type {
  EquivalenceTest,
  EquivalenceTestOptions,
  TripolarContrast,
} from './tripolar-control.js'
export { controlContrast, tostEquivalence } from './tripolar-control.js'
export type {
  RegisteredTripolar,
  ResolvedTripolarPlan,
  TripolarOrder,
  TripolarPlan,
} from './tripolar-schedule.js'
export {
  INTENTIONS,
  PEAR_BITS_PER_TRIAL,
  PEAR_RUN_TRIALS,
  registerTripolar,
  resolveTripolarPlan,
  TRIPOLAR_SCHEDULE_SCHEMA,
  TRIPOLAR_SCHEMA,
  tripolarSchedule,
  tripolarScheduleDigest,
  verifyTripolarRegistration,
} from './tripolar-schedule.js'

/** One completed, intention-tagged run of a tripolar protocol. */
export interface TripolarRun {
  readonly intention: Intention
  /** 0-based index of this run within its intention. */
  readonly run: number
  /** 0-based global collection order — preserves the counterbalancing schedule. */
  readonly sequence: number
  /** The run's recorded trial data (sums + completion timestamps; XOR-safeguarded if planned). */
  readonly series: TrialSeries
  /** `'experimental'` for the operator's source, `'control'` for the yoked control source. */
  readonly arm?: 'experimental' | 'control'
  /** PEAR assignment mode: `'volitional'` (operator-declared) or `'instructed'` (scheduled). */
  readonly assignment?: 'instructed' | 'volitional'
  /** The plan's intention order. */
  readonly order?: TripolarOrder
  /** Whether odd trials were recorded as $k - x$ (see `TripolarPlan.xorSafeguard`). */
  readonly xorSafeguard?: boolean
  /** {@link tripolarScheduleDigest} of the plan that produced this run. */
  readonly scheduleDigest?: string
}

/** What a `'volitional'` declaration callback sees before each run. */
export interface VolitionalContext {
  /** 0-based index of the run about to start. */
  readonly sequence: number
  /** Runs still owed per intention (the balance constraint). */
  readonly remaining: Readonly<Record<Intention, number>>
}

/** Options for {@link runTripolar}. */
export interface RunTripolarOptions {
  signal?: AbortSignal
  /** Desired chunk size passed through to the sources' streams. */
  chunkBytes?: number
  /** Clock override for deterministic tests — stamps each trial's completion time. */
  now?: () => number
  /**
   * Yoked control arm: one control trial is consumed per experimental trial,
   * on the same schedule, and each experimental run is followed by its
   * `arm: 'control'` twin. Use a source the operator cannot influence by
   * design (e.g. a seeded CSPRNG or a pre-recorded file) and compare the arms
   * with `controlContrast`. Its name must differ from the experimental source's.
   */
  control?: TrialSource
  /**
   * Required for `order: 'volitional'`: called before each run; returns the
   * intention the operator declares for it. Must name an intention with
   * runs remaining.
   */
  declare?: (next: VolitionalContext) => Intention | Promise<Intention>
}

interface Arm {
  readonly source: TrialSource
  readonly trials: AsyncGenerator<Trial>
}

async function pull(
  arm: Arm,
  signal: AbortSignal | undefined,
  where: () => string,
  onAbort: () => PsiError,
): Promise<Trial> {
  const next = await nextOrAbort(arm.trials, signal, onAbort)
  if (next.done) {
    if (signal?.aborted) throw onAbort()
    throw new PsiError('insufficient_data', `${arm.source.name} ended ${where()}`, {
      source: arm.source.name,
    })
  }
  return next.value
}

async function declared(
  plan: ResolvedTripolarPlan,
  opts: RunTripolarOptions,
  sequence: number,
  counts: Record<Intention, number>,
): Promise<Intention> {
  const remaining = Object.freeze({
    high: plan.runsPerIntention - counts.high,
    low: plan.runsPerIntention - counts.low,
    baseline: plan.runsPerIntention - counts.baseline,
  })
  const intention = await (opts.declare as NonNullable<RunTripolarOptions['declare']>)({
    sequence,
    remaining,
  })
  if (!INTENTIONS.includes(intention)) {
    throw new PsiError(
      'invalid_plan',
      `declared intention must be high, low, or baseline; got ${String(intention)}`,
    )
  }
  if (remaining[intention] <= 0) {
    throw new PsiError(
      'invalid_plan',
      `declared intention '${intention}' has no runs remaining (runsPerIntention ${plan.runsPerIntention})`,
    )
  }
  return intention
}

/**
 * Execute a tripolar protocol live: consume `source` through negentropy's
 * `trialStream` and yield one intention-tagged {@link TripolarRun} as each
 * run completes (followed by its control twin when `control` is given). Lazy
 * and pull-based — no source I/O before the first `next()` — and
 * deterministic: the same bytes and plan produce the same runs.
 *
 * The intention *schedule* comes from the plan (see `TripolarOrder`), or from
 * the operator's per-run declaration under `'volitional'`; every run carries
 * the plan's schedule digest, its assignment mode, order, and arm. This
 * package tags which trials belong to which intention; it does not (cannot)
 * verify that an operator actually held that intention.
 *
 * Abort is prompt: each pull races the signal, and a source that reacts to
 * the abort by ending its stream still yields `aborted`. Both streams are
 * closed on completion, error, abort, or a consumer `break`.
 *
 * @throws {PsiError} `invalid_plan` (bad plan or options, before any I/O; a bad
 *   volitional declaration), `insufficient_data` (a source ended
 *   mid-protocol), `aborted`. Other source failures propagate from negentropy.
 */
export async function* runTripolar(
  source: TrialSource,
  plan: TripolarPlan,
  opts: RunTripolarOptions = {},
): AsyncGenerator<TripolarRun> {
  const resolved = resolveTripolarPlan(plan)
  const volitional = resolved.order === 'volitional'
  if (volitional && typeof opts.declare !== 'function') {
    throw new PsiError('invalid_plan', "order 'volitional' needs a declare callback")
  }
  if (!volitional && opts.declare !== undefined) {
    throw new PsiError('invalid_plan', "declare applies only to order 'volitional'")
  }
  if (opts.control !== undefined && opts.control?.name === source.name) {
    throw new PsiError(
      'invalid_plan',
      'the control source needs a name distinct from the experimental source',
    )
  }
  const schedule = volitional ? null : tripolarSchedule(resolved)
  const scheduleDigest = await tripolarScheduleDigest(resolved)
  const signal = opts.signal
  const onAbort = () =>
    new PsiError('aborted', 'tripolar protocol aborted', { source: source.name })
  const streamConfig = {
    bitsPerTrial: resolved.bitsPerTrial,
    ...(signal && { signal }),
    ...(opts.chunkBytes !== undefined && { chunkBytes: opts.chunkBytes }),
    ...(opts.now && { now: opts.now }),
  }
  const arms: Arm[] = [{ source, trials: trialStream(source, streamConfig) }]
  if (opts.control)
    arms.push({ source: opts.control, trials: trialStream(opts.control, streamConfig) })
  const total = 3 * resolved.runsPerIntention
  const counts: Record<Intention, number> = { high: 0, low: 0, baseline: 0 }
  const k = resolved.bitsPerTrial
  let aborted = false
  try {
    for (let sequence = 0; sequence < total; sequence++) {
      const intention = schedule
        ? (schedule[sequence] as Intention)
        : await declared(resolved, opts, sequence, counts)
      const sums = arms.map(() => new Float64Array(resolved.trialsPerRun))
      const stamps = arms.map(() => new Float64Array(resolved.trialsPerRun))
      for (let i = 0; i < resolved.trialsPerRun; i++) {
        for (let a = 0; a < arms.length; a++) {
          const where = () =>
            `in run ${sequence + 1}/${total} after ${i} of ${resolved.trialsPerRun} trials`
          const trial = await pull(arms[a] as Arm, signal, where, onAbort)
          ;(sums[a] as Float64Array)[i] =
            resolved.xorSafeguard && i % 2 === 1 ? k - trial.sum : trial.sum
          ;(stamps[a] as Float64Array)[i] = trial.at ?? Number.NaN
        }
      }
      const run = counts[intention]
      counts[intention] = run + 1
      for (let a = 0; a < arms.length; a++) {
        yield Object.freeze({
          intention,
          run,
          sequence,
          series: Object.freeze({
            source: (arms[a] as Arm).source.name,
            bitsPerTrial: k,
            sums: sums[a] as Float64Array,
            timestamps: stamps[a] as Float64Array,
          }),
          arm: a === 0 ? 'experimental' : 'control',
          assignment: volitional ? 'volitional' : 'instructed',
          order: resolved.order,
          xorSafeguard: resolved.xorSafeguard,
          scheduleDigest,
        })
      }
    }
  } catch (error) {
    aborted = signal?.aborted === true
    if (error instanceof PsiError) throw error
    if ((error instanceof NegentropyError && error.code === 'aborted') || aborted) {
      throw new PsiError('aborted', 'tripolar protocol aborted', {
        source: source.name,
        cause: error,
      })
    }
    throw error
  } finally {
    await Promise.all(
      arms.map((arm) => closeIterator(arm.trials, aborted || signal?.aborted === true)),
    )
  }
}
