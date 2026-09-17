import { PsiError } from '../errors.js'
import { canonical, deepFreeze, sha256Hex } from '../internal/digest.js'
import { seedToUint64, Xoshiro128 } from '../internal/prng.js'
import { assertBitsPerTrial, assertInteger } from '../internal/validate.js'
import type { Intention } from '../types.js'

/** Canonical collection order of the three intentions within one interleaved cycle. */
export const INTENTIONS: readonly Intention[] = Object.freeze(['high', 'low', 'baseline'])

/**
 * PEAR's automatic-mode run length: "once started, the machine will
 * automatically initiate a block of fifty trials" (as recorded in Mishlove,
 * *The Roots of Consciousness*) — the default `trialsPerRun`.
 */
export const PEAR_RUN_TRIALS = 50

/** PEAR/GCP trial size: 200 binary samples per trial — the default `bitsPerTrial`. */
export const PEAR_BITS_PER_TRIAL = 200

/**
 * How intentions are assigned to runs:
 * - `'fixed'` — all high runs, then all low, then all baseline (drift maximally confounded).
 * - `'interleaved'` (default) — high → low → baseline each cycle. Cancels
 *   *constant* common-mode bias and suppresses slow drift to first order, but
 *   the fixed high-before-low order leaves ≈ one run's worth of linear drift
 *   in the high−low difference.
 * - `'counterbalanced'` — mirrored ABBA cycles H L B | B L H | …; every
 *   intention's mean position is equal over each cycle pair, so linear drift
 *   cancels exactly when `runsPerIntention` is even.
 * - `'instructed'` — a balanced random permutation of the three intentions
 *   per cycle, drawn from `seed` (xoshiro128** with rejection-sampled
 *   Fisher–Yates): PEAR's *instructed* mode, where "some kind of random process
 *   determines" the direction. Removes order confounds in expectation.
 * - `'volitional'` — the operator declares each run's intention just before
 *   it starts (PEAR's *volitional* mode) through `runTripolar`'s `declare`
 *   callback, under the balance constraint of `runsPerIntention` per intention.
 *
 * PEAR ran volitional and instructed sessions with the direction "recorded
 * before the REG is activated" (Jahn et al. 1997); fixed cycling is an SDK
 * convenience, not the PEAR protocol.
 */
export type TripolarOrder =
  | 'fixed'
  | 'interleaved'
  | 'counterbalanced'
  | 'instructed'
  | 'volitional'

/**
 * A PEAR-style tripolar REG plan. The full protocol collects
 * $3 \times \text{runsPerIntention}$ runs of `trialsPerRun` trials each; a
 * trial is the number of one-bits among `bitsPerTrial` consecutive bits
 * (MSB-first), $\mathrm{Binomial}(k, \tfrac12)$ under H0. JSON-serializable, so
 * it can be registered and hashed ({@link registerTripolar}).
 */
export interface TripolarPlan {
  /** Trials per run. Integer ≥ 1. Default {@link PEAR_RUN_TRIALS} (50). */
  trialsPerRun?: number
  /** Bits summed per trial. Integer ≥ 8. Default {@link PEAR_BITS_PER_TRIAL} (200). */
  bitsPerTrial?: number
  /** Runs collected per intention. Integer ≥ 1. */
  runsPerIntention: number
  /** Intention assignment — see {@link TripolarOrder}. Default `'interleaved'`. */
  order?: TripolarOrder
  /**
   * `'instructed'` only, and required there: the schedule seed — a
   * non-negative safe integer or a hex string (e.g. a beacon value). Keep it
   * from the operator until the session ends; commit it via the registration.
   */
  seed?: number | string
  /**
   * PEAR's bias safeguard: "successive switching of the relationship between
   * the sign of the noise and the sign of the output pulse on a trial-to-trial
   * basis". Odd trials (0-based index within each run) are recorded as
   * $k - x$. Binomial(k, ½) is symmetric, so the null is unchanged; a constant
   * per-bit bias contributes $+\delta k$ and $-\delta k$ on alternate trials and
   * cancels within every even-length run. Default `false`.
   */
  xorSafeguard?: boolean
}

/** A {@link TripolarPlan} with every default filled in — what registrations hash. */
export interface ResolvedTripolarPlan {
  readonly trialsPerRun: number
  readonly bitsPerTrial: number
  readonly runsPerIntention: number
  readonly order: TripolarOrder
  readonly seed?: number | string
  readonly xorSafeguard: boolean
}

const ORDERS: readonly TripolarOrder[] = [
  'fixed',
  'interleaved',
  'counterbalanced',
  'instructed',
  'volitional',
]

/**
 * Validate a plan and fill its defaults.
 *
 * @throws {PsiError} `invalid_plan` for any malformed field, a missing seed
 *   under `'instructed'`, or a seed under any other order.
 */
export function resolveTripolarPlan(plan: TripolarPlan): ResolvedTripolarPlan {
  if (typeof plan !== 'object' || plan === null) {
    throw new PsiError('invalid_plan', 'tripolar plan must be an object')
  }
  const trialsPerRun = assertInteger(plan.trialsPerRun ?? PEAR_RUN_TRIALS, 1, 'trialsPerRun')
  const runsPerIntention = assertInteger(plan.runsPerIntention, 1, 'runsPerIntention')
  const bitsPerTrial = assertBitsPerTrial(plan.bitsPerTrial ?? PEAR_BITS_PER_TRIAL)
  const order = plan.order ?? 'interleaved'
  if (!ORDERS.includes(order)) {
    throw new PsiError(
      'invalid_plan',
      `order must be one of ${ORDERS.join(', ')}; got ${String(order)}`,
    )
  }
  const xorSafeguard = plan.xorSafeguard ?? false
  if (typeof xorSafeguard !== 'boolean') {
    throw new PsiError(
      'invalid_plan',
      `xorSafeguard must be a boolean, got ${String(xorSafeguard)}`,
    )
  }
  if (order === 'instructed') {
    if (plan.seed === undefined) {
      throw new PsiError('invalid_plan', "order 'instructed' requires a seed")
    }
    if (typeof plan.seed !== 'number' && typeof plan.seed !== 'string') {
      throw new PsiError('invalid_plan', 'seed must be a non-negative safe integer or a hex string')
    }
    seedToUint64(plan.seed)
  } else if (plan.seed !== undefined) {
    throw new PsiError('invalid_plan', `seed applies only to order 'instructed', not '${order}'`)
  }
  return Object.freeze({
    trialsPerRun,
    bitsPerTrial,
    runsPerIntention,
    order,
    ...(order === 'instructed' && { seed: plan.seed }),
    xorSafeguard,
  })
}

/**
 * The deterministic intention schedule of a plan, one entry per run in
 * collection order. Pure: the same plan (and seed) always gives the same
 * schedule, so it can be published — or withheld and committed by digest —
 * before any data exist.
 *
 * @throws {PsiError} `invalid_plan` for a malformed plan or `'volitional'`
 *   (whose schedule only exists as the operator declares it).
 */
export function tripolarSchedule(plan: TripolarPlan): readonly Intention[] {
  const resolved = resolveTripolarPlan(plan)
  const r = resolved.runsPerIntention
  const schedule: Intention[] = []
  switch (resolved.order) {
    case 'fixed':
      for (const intention of INTENTIONS) for (let i = 0; i < r; i++) schedule.push(intention)
      break
    case 'interleaved':
      for (let c = 0; c < r; c++) schedule.push(...INTENTIONS)
      break
    case 'counterbalanced':
      for (let c = 0; c < r; c++)
        schedule.push(...(c % 2 === 0 ? INTENTIONS : [...INTENTIONS].reverse()))
      break
    case 'instructed': {
      const rng = new Xoshiro128(resolved.seed as number | string, 'seed')
      for (let c = 0; c < r; c++) schedule.push(...rng.shuffle([...INTENTIONS]))
      break
    }
    case 'volitional':
      throw new PsiError(
        'invalid_plan',
        "order 'volitional' has no precomputed schedule — intentions are declared per run",
      )
  }
  return Object.freeze(schedule)
}

/** Schema tag of the registration envelope `{ plan, schema }` that {@link registerTripolar} hashes. */
export const TRIPOLAR_SCHEMA = 'psi/tripolar/1'

/** Schema tag of the schedule envelope `{ plan, schedule, schema }` behind every schedule digest. */
export const TRIPOLAR_SCHEDULE_SCHEMA = 'psi/tripolar-schedule/1'

function scheduleOrNull(plan: ResolvedTripolarPlan): readonly Intention[] | null {
  return plan.order === 'volitional' ? null : tripolarSchedule(plan)
}

/**
 * SHA-256 (hex) of the canonical JSON
 * `{"plan":<resolved plan>,"schedule":<intentions or null>,"schema":"psi/tripolar-schedule/1"}`
 * — the digest every {@link TripolarRun} carries, committing to the exact
 * order of intentions before data (null schedule for `'volitional'`).
 */
export async function tripolarScheduleDigest(plan: TripolarPlan): Promise<string> {
  const resolved = resolveTripolarPlan(plan)
  return sha256Hex(
    canonical(
      { schema: TRIPOLAR_SCHEDULE_SCHEMA, plan: resolved, schedule: scheduleOrNull(resolved) },
      'tripolar schedule',
    ),
  )
}

/** A pre-registered tripolar plan — see {@link registerTripolar}. */
export interface RegisteredTripolar {
  readonly schema: typeof TRIPOLAR_SCHEMA
  /** The default-resolved, deeply frozen plan. */
  readonly plan: ResolvedTripolarPlan
  /** SHA-256 of `{"plan":…,"schema":"psi/tripolar/1"}` in canonical JSON — cite it with results. */
  readonly hash: string
  /** The committed schedule, or `null` for `'volitional'`. */
  readonly schedule: readonly Intention[] | null
  /** {@link tripolarScheduleDigest} of the plan. */
  readonly scheduleDigest: string
}

/**
 * Freeze and hash a tripolar plan BEFORE collecting data. Pass the result to
 * `analyzeTripolar(runs, { registration })`: runs that stop early, add runs,
 * change run length or trial size, or deviate from the committed schedule
 * throw `PsiError('plan_mismatch')` — optional stopping and post-hoc
 * reordering become detectable by anyone re-running the analysis.
 *
 * @throws {PsiError} `invalid_plan` for a malformed plan.
 */
export async function registerTripolar(plan: TripolarPlan): Promise<RegisteredTripolar> {
  const resolved = resolveTripolarPlan(plan)
  const hash = await sha256Hex(
    canonical({ schema: TRIPOLAR_SCHEMA, plan: resolved }, 'tripolar plan'),
  )
  const scheduleDigest = await tripolarScheduleDigest(resolved)
  return deepFreeze({
    schema: TRIPOLAR_SCHEMA,
    plan: resolved,
    hash,
    schedule: scheduleOrNull(resolved),
    scheduleDigest,
  })
}

/**
 * Recompute a registration's hash, schedule, and schedule digest from its
 * plan — true iff all match (detects an edited registration object or file).
 */
export async function verifyTripolarRegistration(
  registration: RegisteredTripolar,
): Promise<boolean> {
  try {
    const fresh = await registerTripolar(registration.plan)
    return (
      registration.schema === TRIPOLAR_SCHEMA &&
      fresh.hash === registration.hash &&
      fresh.scheduleDigest === registration.scheduleDigest &&
      canonical(fresh.schedule, 'schedule') === canonical(registration.schedule, 'schedule') &&
      canonical(fresh.plan, 'plan') === canonical(registration.plan, 'plan')
    )
  } catch {
    return false
  }
}
