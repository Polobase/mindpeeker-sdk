import { describe, expect, test } from 'bun:test'
import {
  PEAR_BITS_PER_TRIAL,
  PEAR_RUN_TRIALS,
  registerTripolar,
  resolveTripolarPlan,
  type TripolarPlan,
  tripolarSchedule,
  tripolarScheduleDigest,
  verifyTripolarRegistration,
} from '../../src/protocol/tripolar-schedule.js'
import type { Intention } from '../../src/types.js'

const bad = expect.objectContaining({ name: 'PsiError', code: 'invalid_plan' }) as unknown as Error

/** Mean collection position of each intention — equal means linear drift cancels in differences. */
function meanPositions(schedule: readonly Intention[]): Record<Intention, number> {
  const sum: Record<Intention, number> = { high: 0, low: 0, baseline: 0 }
  const count: Record<Intention, number> = { high: 0, low: 0, baseline: 0 }
  schedule.forEach((intention, i) => {
    sum[intention] += i
    count[intention]++
  })
  return {
    high: sum.high / count.high,
    low: sum.low / count.low,
    baseline: sum.baseline / count.baseline,
  }
}

describe('resolveTripolarPlan', () => {
  test('fills PEAR defaults: 50-trial runs of 200-bit trials, interleaved, no safeguard', () => {
    expect(PEAR_RUN_TRIALS).toBe(50)
    expect(PEAR_BITS_PER_TRIAL).toBe(200)
    expect(resolveTripolarPlan({ runsPerIntention: 3 })).toEqual({
      trialsPerRun: 50,
      bitsPerTrial: 200,
      runsPerIntention: 3,
      order: 'interleaved',
      xorSafeguard: false,
    })
  })

  test('rejects malformed plans and misplaced or missing seeds', () => {
    const plans: unknown[] = [
      null,
      { runsPerIntention: 0 },
      { runsPerIntention: 1, trialsPerRun: 0 },
      { runsPerIntention: 1, bitsPerTrial: 7 },
      { runsPerIntention: 1, order: 'random' },
      { runsPerIntention: 1, xorSafeguard: 'yes' },
      { runsPerIntention: 1, order: 'instructed' },
      { runsPerIntention: 1, order: 'instructed', seed: -3 },
      { runsPerIntention: 1, order: 'instructed', seed: 'xyz' },
      { runsPerIntention: 1, order: 'instructed', seed: new Uint8Array([1]) },
      { runsPerIntention: 1, order: 'interleaved', seed: 5 },
    ]
    for (const plan of plans) expect(() => resolveTripolarPlan(plan as TripolarPlan)).toThrow(bad)
  })
})

describe('tripolarSchedule', () => {
  test('fixed, interleaved, counterbalanced layouts', () => {
    expect(tripolarSchedule({ runsPerIntention: 2, order: 'fixed' })).toEqual([
      'high',
      'high',
      'low',
      'low',
      'baseline',
      'baseline',
    ])
    expect(tripolarSchedule({ runsPerIntention: 2 })).toEqual([
      'high',
      'low',
      'baseline',
      'high',
      'low',
      'baseline',
    ])
    expect(tripolarSchedule({ runsPerIntention: 2, order: 'counterbalanced' })).toEqual([
      'high',
      'low',
      'baseline',
      'baseline',
      'low',
      'high',
    ])
  })

  test('counterbalanced (even R) cancels linear drift exactly; interleaved does not', () => {
    const cb = meanPositions(tripolarSchedule({ runsPerIntention: 4, order: 'counterbalanced' }))
    expect(cb.high).toBe(cb.low)
    expect(cb.low).toBe(cb.baseline)
    const il = meanPositions(tripolarSchedule({ runsPerIntention: 4 }))
    expect(il.low - il.high).toBe(1) // one run's worth of drift in high − low
  })

  test('instructed: seeded balanced permutation per cycle, matching the Python reference', () => {
    const schedule = tripolarSchedule({ runsPerIntention: 4, order: 'instructed', seed: 2026 })
    expect(schedule).toEqual([
      'baseline',
      'high',
      'low',
      'baseline',
      'high',
      'low',
      'low',
      'baseline',
      'high',
      'low',
      'baseline',
      'high',
    ])
    expect(tripolarSchedule({ runsPerIntention: 2, order: 'instructed', seed: 'beef' })).toEqual([
      'high',
      'baseline',
      'low',
      'baseline',
      'high',
      'low',
    ])
    for (let c = 0; c < 4; c++) {
      expect(new Set(schedule.slice(3 * c, 3 * c + 3)).size).toBe(3) // balanced per cycle
    }
    expect(tripolarSchedule({ runsPerIntention: 4, order: 'instructed', seed: 2027 })).not.toEqual(
      schedule,
    )
  })

  test('volitional has no precomputed schedule', () => {
    expect(() => tripolarSchedule({ runsPerIntention: 1, order: 'volitional' })).toThrow(bad)
  })
})

describe('schedule digest and registration', () => {
  const plan: TripolarPlan = { trialsPerRun: 3, bitsPerTrial: 16, runsPerIntention: 2 }

  test('digests are SHA-256 over the canonical JSON envelopes (independent recomputation)', async () => {
    const scheduleJson =
      '{"plan":{"bitsPerTrial":16,"order":"interleaved","runsPerIntention":2,"trialsPerRun":3,"xorSafeguard":false},"schedule":["high","low","baseline","high","low","baseline"],"schema":"psi/tripolar-schedule/1"}'
    const planJson =
      '{"plan":{"bitsPerTrial":16,"order":"interleaved","runsPerIntention":2,"trialsPerRun":3,"xorSafeguard":false},"schema":"psi/tripolar/1"}'
    const sha = (text: string) => new Bun.CryptoHasher('sha256').update(text).digest('hex')
    expect(sha(scheduleJson)).toBe(
      '071e963e8bca95d9836852305972e2084235c4623075c75c251eaaad655dde0b',
    )
    expect(await tripolarScheduleDigest(plan)).toBe(sha(scheduleJson))
    const registration = await registerTripolar(plan)
    expect(registration.hash).toBe(sha(planJson))
    expect(registration.hash).toBe(
      'c7882b86ee688574bbcdc11f3c699ac85976695704ee1a0e45b9cbd8b999b844',
    )
    expect(registration.scheduleDigest).toBe(sha(scheduleJson))
    expect(registration.schedule).toEqual(tripolarSchedule(plan))
    expect(Object.isFrozen(registration.plan)).toBe(true)
    // default-resolved: spelling out the defaults does not change the hash
    const explicit = await registerTripolar({ ...plan, order: 'interleaved', xorSafeguard: false })
    expect(explicit.hash).toBe(registration.hash)
  })

  test('volitional registrations commit to the plan with a null schedule', async () => {
    const registration = await registerTripolar({ runsPerIntention: 2, order: 'volitional' })
    expect(registration.schedule).toBeNull()
    expect(await verifyTripolarRegistration(registration)).toBe(true)
  })

  test('verifyTripolarRegistration detects edits', async () => {
    const registration = await registerTripolar(plan)
    expect(await verifyTripolarRegistration(registration)).toBe(true)
    expect(await verifyTripolarRegistration({ ...registration, hash: '00'.repeat(32) })).toBe(false)
    expect(
      await verifyTripolarRegistration({
        ...registration,
        plan: { ...registration.plan, runsPerIntention: 3 },
      }),
    ).toBe(false)
    expect(
      await verifyTripolarRegistration({
        ...registration,
        schedule: ['low', 'high', 'baseline', 'high', 'low', 'baseline'],
      }),
    ).toBe(false)
  })
})
