import { PsiError } from '../errors.js'
import { closeIterator, nextOrAbort } from '../internal/abort.js'
import { canonical, deepFreeze, sha256Hex } from '../internal/digest.js'
import { asyncIteratorOf } from '../internal/iterate.js'
import {
  type BinomialBayesModel,
  type BinomialBayesOptions,
  lnBf10Unchecked,
  resolveBinomialModel,
} from './binomial.js'
import { type CoinObservation, observationCounts } from './eprocess.js'

/** Schema tag hashed with every {@link SequentialPlan}. */
export const SEQUENTIAL_SCHEMA = 'psi/sequential/1'

/**
 * When the Bayes factor is inspected, in cumulative trials $n$:
 * - `'every'` — after every observation;
 * - `{ every: m }` — at the first observation reaching $n \ge m, 2m, 3m, \dots$;
 * - `number[]` — at the first observation reaching each listed $n$ (strictly
 *   increasing integers in $[\text{minTrials}, \text{maxTrials}]$).
 *
 * `maxTrials` is always a final look. Observations of several trials can
 * overshoot a look point; the look then happens at the actual $n$.
 */
export type SequentialLooks = 'every' | { readonly every: number } | readonly number[]

/** A sequential Bayes-factor design, as written before data. */
export interface SequentialPlanSpec {
  /** Stop for H1 at the first look with $BF_{10} \ge$ `bfStop`. Finite, $> 1$. */
  bfStop: number
  /** Optionally stop for H0 at the first look with $BF_{10} \le$ `bfStopNull`. In $(0, 1)$. */
  bfStopNull?: number
  /** No stop decision before $n \ge$ `minTrials`. Integer ≥ 1. Default 1. */
  minTrials?: number
  /** Hard maximum: the design ends at the first look with $n \ge$ `maxTrials`. Integer ≥ `minTrials`. */
  maxTrials: number
  /** Look schedule. Default `'every'`. */
  looks?: SequentialLooks
  /** Beta prior, chance probability $p_0$, and sidedness. Defaults Beta(1,1), ½, two-sided. */
  prior?: BinomialBayesOptions
}

/** A validated, default-resolved, frozen sequential design — what is hashed. */
export interface SequentialPlan {
  readonly schema: typeof SEQUENTIAL_SCHEMA
  readonly bfStop: number
  readonly bfStopNull?: number
  readonly minTrials: number
  readonly maxTrials: number
  readonly looks: SequentialLooks
  readonly prior: BinomialBayesModel
}

function assertTrials(value: unknown, min: number, what: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
    throw new PsiError(
      'invalid_plan',
      `${what} must be a safe integer ≥ ${min}, got ${String(value)}`,
    )
  }
  return value
}

function resolveLooks(looks: unknown, minTrials: number, maxTrials: number): SequentialLooks {
  if (looks === undefined || looks === 'every') return 'every'
  if (Array.isArray(looks)) {
    let previous = 0
    for (const look of looks as unknown[]) {
      const n = assertTrials(look, minTrials, 'each look')
      if (n > maxTrials || n <= previous) {
        throw new PsiError(
          'invalid_plan',
          `looks must be strictly increasing integers in [${minTrials}, ${maxTrials}], got ${String(look)} after ${previous}`,
        )
      }
      previous = n
    }
    return [...(looks as number[])]
  }
  if (looks !== null && typeof looks === 'object' && 'every' in looks) {
    return { every: assertTrials((looks as { every: unknown }).every, 1, 'looks.every') }
  }
  throw new PsiError(
    'invalid_plan',
    "looks must be 'every', { every: m }, or an array of trial counts",
  )
}

/**
 * Validate a sequential Bayes-factor design and resolve its defaults into a
 * deeply frozen {@link SequentialPlan} (also accepts an already resolved
 * plan). Hash it with {@link sequentialPlanDigest} and publish the digest
 * before collecting data; run it with {@link runSequential}.
 *
 * Operating characteristics: with a prior fixed here, $BF_{10}$ is a test
 * martingale under $H_0$, so $P_{H_0}(\text{stop\_h1}) \le 1/\text{bfStop}$ for
 * *any* look schedule (Ville's inequality) — `bfStop: 20` caps the false
 * "evidence for H1" rate at 5% even when looking after every trial. No such
 * guarantee covers `bfStopNull`: the rate of misleading evidence for H0 under
 * a true effect depends on the effect and must be simulated for the design
 * (Schönbrodt, Wagenmakers, Zehetleitner & Perugini 2017). Priors must not be
 * tuned to the data.
 *
 * @throws {PsiError} `invalid_plan` for any malformed field.
 */
export function sequentialPlan(spec: SequentialPlanSpec | SequentialPlan): SequentialPlan {
  if (spec === null || typeof spec !== 'object') {
    throw new PsiError('invalid_plan', 'sequential plan must be an object')
  }
  const schema = (spec as { schema?: unknown }).schema
  if (schema !== undefined && schema !== SEQUENTIAL_SCHEMA) {
    throw new PsiError('invalid_plan', `unsupported sequential plan schema ${String(schema)}`)
  }
  const { bfStop, bfStopNull } = spec
  if (typeof bfStop !== 'number' || !Number.isFinite(bfStop) || !(bfStop > 1)) {
    throw new PsiError('invalid_plan', `bfStop must be finite and > 1, got ${String(bfStop)}`)
  }
  if (
    bfStopNull !== undefined &&
    (typeof bfStopNull !== 'number' || !(bfStopNull > 0 && bfStopNull < 1))
  ) {
    throw new PsiError('invalid_plan', `bfStopNull must be in (0, 1), got ${String(bfStopNull)}`)
  }
  const minTrials = assertTrials(spec.minTrials ?? 1, 1, 'minTrials')
  const maxTrials = assertTrials(spec.maxTrials, minTrials, 'maxTrials')
  const looks = resolveLooks(spec.looks, minTrials, maxTrials)
  const prior = resolveBinomialModel(spec.prior ?? {})
  return deepFreeze({
    schema: SEQUENTIAL_SCHEMA,
    bfStop,
    ...(bfStopNull !== undefined && { bfStopNull }),
    minTrials,
    maxTrials,
    looks,
    prior: { ...prior },
  })
}

/**
 * SHA-256 (hex) of the canonical JSON of the resolved plan
 * (`{"bfStop":…,"looks":…,"maxTrials":…,"minTrials":…,"prior":{…},"schema":"psi/sequential/1"}`,
 * keys sorted) — the commitment to publish before data.
 *
 * @throws {PsiError} `invalid_plan` as {@link sequentialPlan}.
 */
export async function sequentialPlanDigest(
  spec: SequentialPlanSpec | SequentialPlan,
): Promise<string> {
  return sha256Hex(canonical(sequentialPlan(spec), 'sequential plan'))
}

/** Per-look decision. */
export type SequentialDecision = 'continue' | 'stop_h1' | 'stop_h0' | 'stop_max'

/** The Bayes factor at one registered look. */
export interface SequentialLook {
  /** 1-based look index. */
  readonly look: number
  readonly k: number
  readonly n: number
  readonly lnBf10: number
  readonly bf10: number
  readonly bf01: number
  readonly decision: SequentialDecision
}

/** The result of {@link runSequential}. */
export interface SequentialOutcome {
  /**
   * `'stop_h1'` / `'stop_h0'` — a boundary was crossed; `'stop_max'` — the
   * maximum was reached without a crossing; `'incomplete'` — the input ended
   * before the design did.
   */
  readonly decision: Exclude<SequentialDecision, 'continue'> | 'incomplete'
  /** Counts and evidence at the last observation consumed. */
  readonly k: number
  readonly n: number
  readonly lnBf10: number
  readonly bf10: number
  /** Every look taken, in order. */
  readonly looks: readonly SequentialLook[]
  /**
   * $\min(1, 1/\max_\text{looks} BF_{10})$ — anytime-valid (conservative: the
   * maximum runs over looks only).
   */
  readonly anytimeP: number
  /** {@link sequentialPlanDigest} of the plan that ran. */
  readonly planDigest: string
}

/** Options for {@link runSequential}. */
export interface RunSequentialOptions {
  signal?: AbortSignal
  /** Called synchronously at every look, e.g. to update a display. */
  onLook?: (look: SequentialLook) => void
}

/** Which looks fire for a cumulative count — stateful cursor over the schedule. */
function lookScheduler(plan: SequentialPlan): (n: number) => boolean {
  const { looks, minTrials, maxTrials } = plan
  if (looks === 'every') return (n) => n >= minTrials
  if (Array.isArray(looks)) {
    const points = looks as readonly number[]
    let next = 0
    return (n) => {
      let due = false
      while (next < points.length && n >= (points[next] as number)) {
        due = true
        next++
      }
      return due || n >= maxTrials
    }
  }
  const every = (looks as { every: number }).every
  let target = every
  return (n) => {
    let due = false
    if (n >= target) {
      due = true
      target = (Math.floor(n / every) + 1) * every
    }
    return (due && n >= minTrials) || n >= maxTrials
  }
}

/**
 * Run a pre-registered sequential Bayes-factor design over a Bernoulli
 * stream (see `CoinObservation`): accumulate counts, evaluate
 * $BF_{10}$ at every registered look with $n \ge$ `minTrials`, and stop at the
 * first look that crosses `bfStop` (`'stop_h1'`), `bfStopNull` (`'stop_h0'`),
 * or reaches `maxTrials` (`'stop_max'`). The input is closed as soon as the
 * design stops, so no trial beyond the decision is consumed. Deterministic:
 * the same observations and plan give the same outcome.
 *
 * @throws {PsiError} `invalid_plan` (plan; a malformed observation),
 *   `aborted` when `signal` fires.
 */
export async function runSequential(
  input: Iterable<CoinObservation> | AsyncIterable<CoinObservation>,
  spec: SequentialPlanSpec | SequentialPlan,
  opts: RunSequentialOptions = {},
): Promise<SequentialOutcome> {
  const plan = sequentialPlan(spec)
  if (opts.onLook !== undefined && typeof opts.onLook !== 'function') {
    throw new PsiError('invalid_plan', 'onLook must be a function')
  }
  const planDigest = await sequentialPlanDigest(plan)
  const iterator = asyncIteratorOf(input, 'runSequential input')
  const signal = opts.signal
  const onAbort = () => new PsiError('aborted', 'sequential design aborted')
  const due = lookScheduler(plan)
  const lnStop = Math.log(plan.bfStop)
  const lnStopNull = plan.bfStopNull !== undefined ? Math.log(plan.bfStopNull) : undefined
  const looks: SequentialLook[] = []
  let k = 0
  let n = 0
  let lnBf10 = 0
  let lnMax = 0
  let decision: SequentialOutcome['decision'] = 'incomplete'
  try {
    while (true) {
      const next = await nextOrAbort(iterator, signal, onAbort)
      if (next.done) {
        if (signal?.aborted) throw onAbort()
        break
      }
      const increment = observationCounts(next.value)
      if (!Number.isSafeInteger(n + increment.n)) {
        throw new PsiError('invalid_plan', 'cumulative trials exceed 2^53 − 1')
      }
      k += increment.k
      n += increment.n
      if (!due(n)) continue
      lnBf10 = lnBf10Unchecked(k, n, plan.prior)
      if (lnBf10 > lnMax) lnMax = lnBf10
      const verdict: SequentialDecision =
        lnBf10 >= lnStop
          ? 'stop_h1'
          : lnStopNull !== undefined && lnBf10 <= lnStopNull
            ? 'stop_h0'
            : n >= plan.maxTrials
              ? 'stop_max'
              : 'continue'
      const look = Object.freeze({
        look: looks.length + 1,
        k,
        n,
        lnBf10,
        bf10: Math.exp(lnBf10),
        bf01: Math.exp(-lnBf10),
        decision: verdict,
      })
      looks.push(look)
      opts.onLook?.(look)
      if (verdict !== 'continue') {
        decision = verdict
        break
      }
    }
  } finally {
    await closeIterator(iterator, signal?.aborted === true)
  }
  if (decision === 'incomplete' && n > 0) lnBf10 = lnBf10Unchecked(k, n, plan.prior)
  return Object.freeze({
    decision,
    k,
    n,
    lnBf10,
    bf10: Math.exp(lnBf10),
    looks: Object.freeze(looks),
    anytimeP: Math.min(1, Math.exp(-lnMax)),
    planDigest,
  })
}
