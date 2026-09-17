import { describe, expect, test } from 'bun:test'
import { analyzeTrials } from '../../src/experiment/batch.js'
import { registerExperiment } from '../../src/experiment/registration.js'
import type { EventSpec } from '../../src/experiment/types.js'
import { theoreticalCalibration } from '../../src/stats/calibration.js'
import { netvar } from '../../src/stats/network.js'
import { trialsFromBytes } from '../../src/stats/trials.js'
import { zScores } from '../../src/stats/zscores.js'
import type { TrialSeries } from '../../src/types.js'
import { prngBytes } from '../helpers/byte-sources.js'

const SOURCES = ['a', 'b', 'c']
const nan = Number.NaN

function nullSeries(trials: number, seedBase: number): TrialSeries[] {
  return SOURCES.map((source, i) =>
    trialsFromBytes(prngBytes(trials * 25, seedBase + i * 1000), source),
  )
}

/** Copy with `source` absent (NaN) on [from, to). */
function withGap(s: TrialSeries, from: number, to: number): TrialSeries {
  const sums = s.sums.slice()
  sums.fill(nan, from, to)
  return { ...s, sums }
}

describe('analyzeTrials — step-aligned archives (missing: skip)', () => {
  test('NaN rows are absent sources: statistics combine over who was present', () => {
    const base = nullSeries(200, 0xa10)
    const series = [
      base[0] as TrialSeries,
      withGap(base[1] as TrialSeries, 50, 80),
      base[2] as TrialSeries,
    ]
    const result = analyzeTrials(series, {
      missing: 'skip',
      events: [
        { id: 'net', statistic: 'netvar', start: 0, end: 200 },
        { id: 'dev', statistic: 'devvar', start: 250, end: 300 },
      ],
    })
    const zs = series.map((s) =>
      zScores(
        { ...s, sums: s.sums.map((v) => (Number.isNaN(v) ? 100 : v)) },
        theoreticalCalibration(s.source),
      ),
    )
    const full = (from: number, to: number) =>
      netvar(
        zs.map((z) => z.slice(from, to)),
        SOURCES,
      ).statistic
    const ac = netvar(
      [(zs[0] as Float64Array).slice(50, 80), (zs[2] as Float64Array).slice(50, 80)],
      ['a', 'c'],
    )
    const expected = full(0, 50) + ac.statistic + full(80, 200)
    expect(result.events[0]?.value as number).toBeCloseTo(expected, 9)
    expect(result.events[0]?.df).toBe(200)
    expect(result.series[1]).toBe(series[1] as TrialSeries) // archive keeps its NaN rows
    // a window past the data is incomplete, not an error
    expect(result.events[1]).toMatchObject({ id: 'dev', status: 'incomplete', steps: 0 })
    expect(Number.isNaN(result.events[1]?.pValue as number)).toBe(true)
    expect(result.composite.events).toBe(1)
  })

  test('burn-in under skip calibrates each source on its present trials in the burn window', () => {
    const base = nullSeries(400, 0xa20)
    const series = [
      withGap(base[0] as TrialSeries, 10, 60),
      base[1] as TrialSeries,
      base[2] as TrialSeries,
    ]
    const result = analyzeTrials(series, {
      missing: 'skip',
      calibration: { trials: 100 },
      events: [{ id: 'e', statistic: 'netvar', start: 0, end: 300 }],
    })
    expect(result.calibration.map((c) => c.trials)).toEqual([50, 100, 100])
    expect(result.series.map((s) => s.sums.length)).toEqual([300, 300, 300])
    expect(result.events[0]?.status).toBe('complete')
  })
})

describe('analyzeTrials — incomplete events', () => {
  test('index windows past the data and unclosed Date windows are reported, not thrown', () => {
    const series = nullSeries(100, 0xb10).map((s) => ({
      ...s,
      timestamps: Float64Array.from({ length: 100 }, (_, t) => 1_000_000 + t * 1000),
    }))
    const events: EventSpec[] = [
      { id: 'done', statistic: 'netvar', start: 0, end: 60 },
      { id: 'pending', statistic: 'netvar', start: 60, end: 150, label: 'still running' },
      { id: 'future', statistic: 'devvar', start: 500, end: 600 },
      { id: 'open', statistic: 'netvar', start: new Date(1_050_000), end: new Date(1_200_000) },
      { id: 'closed', statistic: 'netvar', start: new Date(1_010_000), end: new Date(1_020_000) },
    ]
    const result = analyzeTrials(series, { events })
    const byId = Object.fromEntries(result.events.map((e) => [e.id, e]))
    expect(byId.done?.status).toBe('complete')
    expect(byId.pending).toMatchObject({ status: 'incomplete', steps: 40, label: 'still running' })
    expect(byId.pending?.cumulative.length).toBe(40)
    expect(byId.pending?.reason).toContain('extends past the 100 recorded steps')
    expect(byId.future).toMatchObject({ status: 'incomplete', steps: 0 })
    expect(byId.open).toMatchObject({ status: 'incomplete', steps: 50 })
    expect(byId.open?.reason).toContain('has not closed')
    expect(byId.closed).toMatchObject({ status: 'complete', steps: 10 })
    // only complete events enter the composite; 'closed' lies inside 'done' → Brown
    expect(result.composite).toMatchObject({ events: 2, independent: false, method: 'brown' })
    expect(result.composite.reason).toContain('done∩closed: 10 steps')
    // netvar pair sharing 10 of (60, 10) steps: ρ = 10/√600, Var = 2 + 2ρ
    expect(result.composite.variance).toBeCloseTo(2 + 20 / Math.sqrt(600), 2)
  })
})

describe('analyzeTrials — re-analysis without re-burning', () => {
  test('{ registration, calibration } reproduces a burn-in result exactly and keeps the hash', async () => {
    const registration = await registerExperiment({
      calibration: { trials: 50 },
      events: [
        { id: 'e1', statistic: 'netvar', start: 0, end: 30 },
        { id: 'e2', statistic: 'devvar', start: 10, end: 40 },
      ],
    })
    const original = analyzeTrials(nullSeries(90, 0xc10), registration)
    expect(original.series[0]?.sums.length).toBe(40)
    // passing the registration alone would burn 50 more trials from the 40-step archive
    expect(() => analyzeTrials(original.series, registration)).toThrow(
      expect.objectContaining({ code: 'insufficient_data' }),
    )
    const again = analyzeTrials(original.series, {
      registration,
      calibration: original.calibration,
    })
    expect(again).toEqual(original)
    expect(again.registration).toBe(registration.hash)
    // calibrations that the registered spec could not have produced are refused
    expect(() =>
      analyzeTrials(original.series, {
        registration,
        calibration: SOURCES.map((s) => theoreticalCalibration(s)),
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_config' }))
    expect(() =>
      analyzeTrials(original.series, { registration, calibration: undefined } as never),
    ).toThrow(expect.objectContaining({ code: 'invalid_config' }))
  })

  test('a registration mutated after hashing is refused', async () => {
    const registration = await registerExperiment({
      events: [{ id: 'd', statistic: 'netvar', start: new Date(0), end: new Date(5000) }],
    })
    ;(registration.config.events[0]?.end as Date).setTime(9000)
    expect(() => analyzeTrials(nullSeries(10, 0xc20), registration)).toThrow(
      /modified after hashing/,
    )
  })
})

describe('analyzeTrials — dependent composites (null calibration)', () => {
  test("Brown's correction restores Var(composite z) ≈ 1 for overlapping and same-window events", () => {
    const reps = 400
    const overlapping: number[] = []
    const sameWindow: number[] = []
    const naiveSame: number[] = []
    for (let rep = 0; rep < reps; rep++) {
      const series = nullSeries(300, 0x10000 + rep * 7)
      const a = analyzeTrials(series, {
        events: [
          { id: 'x', statistic: 'netvar', start: 0, end: 200 },
          { id: 'y', statistic: 'netvar', start: 100, end: 300 },
        ],
      })
      overlapping.push(a.composite.z)
      const b = analyzeTrials(series, {
        events: [
          { id: 'n', statistic: 'netvar', start: 0, end: 300 },
          { id: 'd', statistic: 'devvar', start: 0, end: 300 },
          { id: 'c', statistic: 'correlation', start: 0, end: 300 },
        ],
      })
      expect(b.composite.method).toBe('brown')
      sameWindow.push(b.composite.z)
      naiveSame.push(b.events.reduce((sum, e) => sum + e.z, 0) / Math.sqrt(3))
    }
    const variance = (v: number[]) => {
      const mean = v.reduce((x, y) => x + y, 0) / v.length
      return v.reduce((x, y) => x + (y - mean) ** 2, 0) / (v.length - 1)
    }
    const tolerance = 4 * Math.sqrt(2 / reps) // ≈ 0.28
    expect(Math.abs(variance(overlapping) - 1)).toBeLessThan(tolerance)
    expect(Math.abs(variance(sameWindow) - 1)).toBeLessThan(tolerance)
    // plain Stouffer would be ≈ 1.93 here (the anti-conservative 0.1.x composite)
    expect(variance(naiveSame)).toBeGreaterThan(1.5)
  })
})
