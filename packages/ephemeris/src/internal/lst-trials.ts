import { EphemerisError } from '../errors.js'
import { lst } from '../sidereal.js'
import { julianDay } from '../time.js'
import type { LstTrial } from '../types.js'
import { type Seed, Xoshiro128 } from './prng.js'

/** Hard cap on trials, so a mistaken input fails fast instead of exhausting memory. */
const MAX_TRIALS = 10_000_000
const MAX_PERMUTATIONS = 10_000_000

/** Trials resolved to LST hours, effects and dense stratum ids, in input order. */
export interface ResolvedTrials {
  readonly lstHours: Float64Array
  readonly effects: Float64Array
  /** Dense stratum index per trial (0 when unstratified), numbered by first appearance. */
  readonly strata: Int32Array
  readonly strataCount: number
  readonly stratified: boolean
}

function withIndex(error: unknown, index: number): never {
  if (error instanceof EphemerisError) {
    throw new EphemerisError(error.code, `trials[${index}]: ${error.message}`, { cause: error })
  }
  throw error
}

/**
 * Validate and resolve LST trials: timed trials get their LST from
 * {@link lst}; labelled trials must carry `lstHours` in $[0, 24)$.
 */
export function resolveTrials(
  trials: readonly LstTrial[],
  sidereal: 'mean' | 'apparent',
  minCount: number,
): ResolvedTrials {
  if (!Array.isArray(trials)) {
    throw new EphemerisError('invalid_input', 'trials must be an array')
  }
  if (trials.length > MAX_TRIALS) {
    throw new EphemerisError('invalid_input', `at most ${MAX_TRIALS} trials, got ${trials.length}`)
  }
  if (trials.length < minCount) {
    throw new EphemerisError(
      'insufficient_data',
      `need at least ${minCount} trial${minCount === 1 ? '' : 's'}, got ${trials.length}`,
    )
  }
  const n = trials.length
  const lstHours = new Float64Array(n)
  const effects = new Float64Array(n)
  const strata = new Int32Array(n)
  const strataIds = new Map<string, number>()
  let withStratum = 0
  for (let i = 0; i < n; i++) {
    const trial = trials[i] as unknown
    if (trial === null || typeof trial !== 'object') {
      throw new EphemerisError('invalid_input', `trials[${i}] must be an object`)
    }
    const t = trial as Partial<
      Record<'time' | 'longitudeEastDeg' | 'lstHours' | 'effect' | 'stratum', unknown>
    >
    if (typeof t.effect !== 'number' || !Number.isFinite(t.effect)) {
      throw new EphemerisError('invalid_input', `trials[${i}].effect must be a finite number`)
    }
    effects[i] = t.effect
    const hasLst = t.lstHours !== undefined
    const hasTime = t.time !== undefined
    if (hasLst === hasTime) {
      throw new EphemerisError(
        'invalid_input',
        `trials[${i}] needs exactly one of lstHours or time (+ longitudeEastDeg)`,
      )
    }
    if (hasLst) {
      if (
        typeof t.lstHours !== 'number' ||
        !Number.isFinite(t.lstHours) ||
        t.lstHours < 0 ||
        t.lstHours >= 24
      ) {
        throw new EphemerisError('invalid_input', `trials[${i}].lstHours must be in [0, 24)`)
      }
      lstHours[i] = t.lstHours
    } else {
      try {
        const time = t.time
        let jd: number
        if (time instanceof Date) jd = julianDay(time)
        else if (typeof time === 'number') jd = time
        else throw new EphemerisError('invalid_time', 'time must be a Date or a Julian day')
        lstHours[i] = lst(jd, t.longitudeEastDeg as number, { sidereal })
      } catch (error) {
        withIndex(error, i)
      }
    }
    if (t.stratum !== undefined) {
      const s = t.stratum
      if (!(typeof s === 'string' || (typeof s === 'number' && Number.isFinite(s)))) {
        throw new EphemerisError(
          'invalid_input',
          `trials[${i}].stratum must be a string or a finite number`,
        )
      }
      const key = typeof s === 'number' ? `n:${s}` : `s:${s}`
      let id = strataIds.get(key)
      if (id === undefined) {
        id = strataIds.size
        strataIds.set(key, id)
      }
      strata[i] = id
      withStratum++
    }
  }
  if (withStratum !== 0 && withStratum !== n) {
    throw new EphemerisError(
      'invalid_input',
      `stratum must be given on every trial or on none (${withStratum} of ${n} have one)`,
    )
  }
  return {
    lstHours,
    effects,
    strata,
    strataCount: withStratum === 0 ? 1 : strataIds.size,
    stratified: withStratum !== 0,
  }
}

/** Validate a permutation count: an integer in $[1, 10^7]$. */
export function resolvePermutations(value: number | undefined, fallback: number): number {
  const permutations = value ?? fallback
  if (!Number.isInteger(permutations) || permutations < 1 || permutations > MAX_PERMUTATIONS) {
    throw new EphemerisError(
      'invalid_options',
      `permutations must be an integer in [1, ${MAX_PERMUTATIONS}], got ${String(permutations)}`,
    )
  }
  return permutations
}

/** Validate the sidereal mode option. */
export function resolveSidereal(value: unknown): 'mean' | 'apparent' {
  const sidereal = value ?? 'mean'
  if (sidereal !== 'mean' && sidereal !== 'apparent') {
    throw new EphemerisError(
      'invalid_options',
      `sidereal must be 'mean' or 'apparent', got ${String(sidereal)}`,
    )
  }
  return sidereal
}

/** Build the seeded generator (seed validation throws `invalid_options`). */
export function createRng(seed: Seed | undefined): Xoshiro128 {
  return new Xoshiro128(seed ?? 0, 'seed')
}

/**
 * Positions grouped by stratum, each group listing trial positions in
 * ascending order, for stratum-wise shuffles. Groups follow stratum ids.
 */
export function strataGroups(strata: Int32Array, strataCount: number): Int32Array[] {
  const counts = new Int32Array(strataCount)
  for (const s of strata) counts[s] = (counts[s] as number) + 1
  const groups = Array.from(counts, (c) => new Int32Array(c))
  const fill = new Int32Array(strataCount)
  for (let i = 0; i < strata.length; i++) {
    const s = strata[i] as number
    const group = groups[s] as Int32Array
    group[fill[s] as number] = i
    fill[s] = (fill[s] as number) + 1
  }
  return groups
}
