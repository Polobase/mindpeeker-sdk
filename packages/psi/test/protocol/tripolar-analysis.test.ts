import { describe, expect, test } from 'bun:test'
import type { TripolarRun } from '../../src/protocol/tripolar.js'
import { analyzeTripolar } from '../../src/protocol/tripolar-analysis.js'
import { controlContrast, tostEquivalence } from '../../src/protocol/tripolar-control.js'
import { registerTripolar, tripolarSchedule } from '../../src/protocol/tripolar-schedule.js'
import type { Intention } from '../../src/types.js'

// Reference values: closed forms (Poisson sums for χ² with even df, C(100,50)/2^100)
// evaluated in Python with exact integers and statistics.NormalDist.

function constantRun(
  intention: Intention,
  sequence: number,
  sum: number,
  trials: number,
  extra: Partial<TripolarRun> = {},
): TripolarRun {
  return {
    intention,
    run: 0,
    sequence,
    series: { source: 'reg', bitsPerTrial: 100, sums: new Float64Array(trials).fill(sum) },
    ...extra,
  }
}

const code = (c: string) =>
  expect.objectContaining({ name: 'PsiError', code: c }) as unknown as Error

describe('analyzeTripolar — unequal bit budgets', () => {
  // high: 10 trials at z = +1 (N_H = 1000 bits); low: 40 trials at z = −1 (N_L = 4000 bits)
  const runs = [constantRun('high', 0, 55, 10), constantRun('low', 1, 45, 40)]

  test('Δz uses √(1/N_H + 1/N_L), not (z_H − z_L)/√2', () => {
    const a = analyzeTripolar(runs)
    expect(a.high.effectSize).toBeCloseTo(0.1, 14)
    expect(a.low.effectSize).toBeCloseTo(-0.1, 14)
    expect(a.deltaEffect).toBeCloseTo(0.2, 14)
    expect(a.deltaZ).toBeCloseTo(5.656854249492381, 12)
    const naive = (a.high.z - a.low.z) / Math.SQRT2
    expect(naive).toBeCloseTo(6.7082039324993685, 12) // the balanced-only shortcut would overstate it
  })

  test('variance ("bind") summary per intention', () => {
    const a = analyzeTripolar(runs)
    // Σz² = 10 on 10 df: P(χ²₁₀ ≤ 10) = 1 − e⁻⁵ Σ_{j<5} 5ʲ/j!
    expect(a.high.variance.statistic).toBeCloseTo(10, 12)
    expect(a.high.variance.df).toBe(10)
    expect(a.high.variance.pLower).toBeCloseTo(0.5595067149347877, 12)
    expect(a.high.variance.pUpper).toBeCloseTo(0.44049328506521235, 12)
    expect(a.high.variance.z).toBeCloseTo(0.14971867956893148, 10)
    expect(a.high.variance.atMean).toBe(0)
    expect(a.high.variance.atMeanExpected).toBeCloseTo(0.7958923738717876, 12)
    expect(a.low.variance.z).toBeCloseTo(0.0746231760918916, 10)
  })

  test('a baseline piled exactly at the mean shows the bind as a large negative varianceZ', () => {
    const a = analyzeTripolar([...runs, constantRun('baseline', 2, 50, 20)])
    expect(a.baseline?.z).toBe(0)
    expect(a.baseline?.variance.statistic).toBe(0)
    expect(a.baseline?.variance.pLower).toBe(0)
    expect(a.baseline?.variance.z).toBeLessThan(-30)
    expect(a.baseline?.variance.atMean).toBe(20)
    expect(a.baseline?.variance.atMeanExpected).toBeCloseTo(1.5917847477435751, 12)
  })
})

describe('analyzeTripolar — validation', () => {
  test('unknown intention labels and malformed series are PsiError invalid_plan', () => {
    const ok = constantRun('low', 1, 45, 4)
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed label
    const capitalized = { ...constantRun('high', 0, 55, 4), intention: 'High' as any }
    expect(() => analyzeTripolar([capitalized, ok])).toThrow(code('invalid_plan'))
    const zeroBits = {
      ...constantRun('high', 0, 55, 4),
      series: { source: 'reg', bitsPerTrial: 0, sums: Float64Array.from([0]) },
    }
    expect(() => analyzeTripolar([zeroBits, ok])).toThrow(code('invalid_plan'))
    const outOfRange = {
      ...constantRun('high', 0, 55, 4),
      series: { source: 'reg', bitsPerTrial: 100, sums: Float64Array.from([101]) },
    }
    expect(() => analyzeTripolar([outOfRange, ok])).toThrow(code('invalid_plan'))
    expect(() =>
      analyzeTripolar([constantRun('high', 0, 55, 4), { ...ok, arm: 'control' }]),
    ).toThrow(code('invalid_plan'))
    expect(() =>
      analyzeTripolar([
        constantRun('high', 0, 55, 4, { scheduleDigest: 'a' }),
        constantRun('low', 1, 45, 4, { scheduleDigest: 'b' }),
      ]),
    ).toThrow(code('plan_mismatch'))
    expect(() => analyzeTripolar([ok], { deviations: 'ignore' as 'throw' })).toThrow(
      code('invalid_plan'),
    )
  })
})

describe('analyzeTripolar — registration binding', () => {
  const plan = { trialsPerRun: 4, bitsPerTrial: 100, runsPerIntention: 2 }

  async function conforming(): Promise<TripolarRun[]> {
    const registration = await registerTripolar(plan)
    const counts: Record<Intention, number> = { high: 0, low: 0, baseline: 0 }
    return tripolarSchedule(plan).map((intention, sequence) => ({
      intention,
      run: counts[intention]++,
      sequence,
      series: { source: 'reg', bitsPerTrial: 100, sums: new Float64Array(4).fill(50) },
      order: 'interleaved',
      xorSafeguard: false,
      scheduleDigest: registration.scheduleDigest,
    }))
  }

  test('conforming runs pass and the result cites the registration and digest', async () => {
    const registration = await registerTripolar(plan)
    const a = analyzeTripolar(await conforming(), { registration })
    expect(a.registration).toBe(registration.hash)
    expect(a.scheduleDigest).toBe(registration.scheduleDigest)
    expect(a.deviations).toBeUndefined()
    const reported = analyzeTripolar(await conforming(), { registration, deviations: 'report' })
    expect(reported.deviations).toEqual([])
  })

  test('stopping early, extra runs, reordering, run length, digest → plan_mismatch', async () => {
    const registration = await registerTripolar(plan)
    const runs = await conforming()
    const cases: TripolarRun[][] = [
      runs.slice(0, 5), // stopped before the last baseline run
      [...runs, { ...(runs[0] as TripolarRun), sequence: 6 }], // an extra run
      runs.map((r, i) =>
        i === 0 ? { ...r, intention: 'low' } : i === 1 ? { ...r, intention: 'high' } : r,
      ),
      runs.map((r, i) =>
        i === 2 ? { ...r, series: { ...r.series, sums: new Float64Array(5).fill(50) } } : r,
      ),
      runs.map((r) => ({ ...r, scheduleDigest: 'f'.repeat(64) })),
      runs.map((r) => ({ ...r, xorSafeguard: true })),
      runs.map((r, i) => (i === 5 ? { ...r, sequence: 4 } : r)), // duplicated sequence
    ]
    for (const bad of cases) {
      expect(() => analyzeTripolar(bad, { registration })).toThrow(code('plan_mismatch'))
    }
    const other = await registerTripolar({ ...plan, bitsPerTrial: 200 })
    expect(() => analyzeTripolar(runs, { registration: other })).toThrow(code('plan_mismatch'))
    const report = analyzeTripolar(runs.slice(0, 5), { registration, deviations: 'report' })
    expect(report.deviations?.some((d) => d.includes('stopped early'))).toBe(true)
    // biome-ignore lint/suspicious/noExplicitAny: forged registration object
    expect(() => analyzeTripolar(runs, { registration: { hash: 'x' } as any })).toThrow(
      code('invalid_plan'),
    )
  })
})

describe('controlContrast and tostEquivalence', () => {
  const experimental = analyzeTripolar([
    constantRun('high', 0, 55, 10),
    constantRun('low', 1, 45, 40),
  ])
  const controlRuns = [constantRun('high', 0, 50, 10), constantRun('low', 1, 50, 40)].map((r) => ({
    ...r,
    series: { ...r.series, source: 'csprng' },
  }))
  const control = analyzeTripolar(controlRuns)

  test('contrast z = (Δε_E − Δε_C)/√(s_E² + s_C²)', () => {
    const c = controlContrast(experimental, control)
    expect(c.deltaEffectDifference).toBeCloseTo(0.2, 14)
    expect(c.z).toBeCloseTo(4, 12)
    expect(c.pValue).toBeCloseTo(3.167124183311998e-5, 15)
    expect(c.pTwoSided).toBeCloseTo(6.334248366623996e-5, 15)
    expect(c.z).toBeCloseTo((experimental.deltaZ - control.deltaZ) / Math.SQRT2, 12) // equal budgets
    expect(() => controlContrast(experimental, experimental)).toThrow(code('invalid_plan'))
  })

  test('TOST on the per-bit separation and on one intention', () => {
    const t = tostEquivalence(experimental, { eps0: 0.3 })
    expect(t.se).toBeCloseTo(0.035355339059327376, 15)
    expect(t.pUpper).toBeCloseTo(0.0023388674905236388, 14)
    expect(t.pLower).toBeLessThan(1e-40)
    expect(t.pValue).toBe(t.pUpper)
    expect(t.equivalent).toBe(true)
    expect(t.ci[0]).toBeCloseTo(0.14184564231616636, 12)
    expect(t.ci[1]).toBeCloseTo(0.25815435768383366, 12)
    expect(tostEquivalence(experimental, { eps0: 0.1 }).equivalent).toBe(false)
    const baseline = tostEquivalence(control.high, { eps0: 0.1, alpha: 0.025 })
    expect(baseline.estimate).toBe(0)
    expect(baseline.se).toBeCloseTo(1 / Math.sqrt(1000), 15)
    expect(baseline.equivalent).toBe(true)
    expect(() => tostEquivalence(experimental, { eps0: 0 })).toThrow(code('invalid_plan'))
    expect(() => tostEquivalence(experimental, { eps0: 0.1, alpha: 0.5 })).toThrow(
      code('invalid_plan'),
    )
    // biome-ignore lint/suspicious/noExplicitAny: neither an analysis nor a summary
    expect(() => tostEquivalence({} as any, { eps0: 0.1 })).toThrow(code('invalid_plan'))
  })
})
