import { describe, expect, test } from 'bun:test'
import { NegentropyError } from '../../src/errors.js'
import { analyzeBytes, analyzeTrials } from '../../src/experiment/batch.js'
import { registerExperiment } from '../../src/experiment/registration.js'
import { theoreticalCalibration } from '../../src/stats/calibration.js'
import { netvar } from '../../src/stats/network.js'
import { trialsFromBytes } from '../../src/stats/trials.js'
import { zScores } from '../../src/stats/zscores.js'
import type { TrialSeries } from '../../src/types.js'
import { prngBytes } from '../helpers/byte-sources.js'

const SOURCES = ['a', 'b', 'c']

function nullSeries(trials: number, seedBase: number): TrialSeries[] {
  return SOURCES.map((source, i) =>
    trialsFromBytes(prngBytes(trials * 25, seedBase + i * 1000), source),
  )
}

describe('analyzeTrials', () => {
  test('event statistics equal direct computation on the same slices', () => {
    const series = nullSeries(600, 0x100)
    const result = analyzeTrials(series, {
      events: [{ id: 'window', statistic: 'netvar', start: 100, end: 400 }],
    })
    const zs = series.map((s) => zScores(s, theoreticalCalibration(s.source)).slice(100, 400))
    const direct = netvar(zs, SOURCES)
    const event = result.events[0]
    expect(event?.value).toBe(direct.statistic)
    expect(event?.df).toBe(300)
    expect(event?.pValue).toBe(direct.pValue)
    expect(event?.steps).toBe(300)
    expect(event?.cumulative.length).toBe(300)
    expect(event?.sources).toEqual(SOURCES)
    expect(event?.status).toBe('complete')
    expect(result.composite.events).toBe(1)
    expect(result.composite).toMatchObject({ independent: true, method: 'stouffer' })
    expect(result.series.length).toBe(3)
    expect(result.series[0]).toBe(series[0] as TrialSeries) // the archive is the input, untouched
    expect(result.analysedSteps).toBe(600)
  })

  test('an injected common signal fires inside its window and not outside', () => {
    const series = nullSeries(600, 0x200)
    // inside [200, 300): give every source IDENTICAL strongly deviant sums
    const common = prngBytes(100 * 25, 0x999)
    const shared = trialsFromBytes(common, 'shared')
    for (const s of series) {
      for (let t = 200; t < 300; t++) {
        s.sums[t] = 100 + 3 * ((shared.sums[t - 200] as number) - 100)
      }
    }
    const result = analyzeTrials(series, {
      events: [
        { id: 'hit', label: 'meditation window', statistic: 'netvar', start: 200, end: 300 },
        { id: 'control', statistic: 'netvar', start: 400, end: 500 },
        { id: 'corr', statistic: 'correlation', start: 200, end: 300 },
      ],
    })
    const hit = result.events.find((e) => e.id === 'hit')
    const control = result.events.find((e) => e.id === 'control')
    const corr = result.events.find((e) => e.id === 'corr')
    expect(hit?.pValue).toBeLessThan(1e-6)
    expect(hit?.label).toBe('meditation window')
    expect(control?.pValue).toBeGreaterThan(0.001)
    expect(corr?.pValue).toBeLessThan(1e-6)
    // hit and corr share [200, 300): the composite is dependent and Brown-corrected
    expect(result.composite).toMatchObject({ independent: false, method: 'brown', events: 3 })
    expect(result.composite.variance).toBeGreaterThan(3)
    expect(result.composite.reason).toContain('hit∩corr: 100 steps')
    expect(result.composite.z).toBeGreaterThan(5)
  })

  test('calibration burn-in: windows index the post-burn remainder', () => {
    const series = nullSeries(1100, 0x300)
    const result = analyzeTrials(series, {
      calibration: { trials: 500 },
      events: [{ id: 'e', statistic: 'devvar', start: 0, end: 600 }],
    })
    expect(result.calibration[0]?.basis).toBe('empirical')
    expect(result.calibration[0]?.trials).toBe(500)
    expect(result.series[0]?.sums.length).toBe(600)
    expect(result.events[0]?.steps).toBe(600)
    expect(result.events[0]?.pValue).toBeGreaterThan(0.001) // null data stays null
  })

  test("missing 'error' rejects ragged series; 'skip' keeps the archive and treats the tail as absent", () => {
    const series = nullSeries(600, 0x400)
    const ragged = [
      series[0] as TrialSeries,
      {
        source: 'b',
        bitsPerTrial: 200,
        sums: (series[1] as TrialSeries).sums.slice(0, 500),
      },
      series[2] as TrialSeries,
    ]
    expect(() =>
      analyzeTrials(ragged, { events: [{ id: 'e', statistic: 'netvar', start: 0, end: 100 }] }),
    ).toThrow(NegentropyError)
    const result = analyzeTrials(ragged, {
      missing: 'skip',
      events: [{ id: 'e', statistic: 'netvar', start: 0, end: 600 }],
    })
    expect(result.series.map((s) => s.sums.length)).toEqual([600, 500, 600]) // never truncated
    expect(result.analysedSteps).toBe(600)
    const event = result.events[0]
    expect(event?.status).toBe('complete')
    expect(event?.df).toBe(600)
    // steps ≥ 500 combine a and c only
    const zs = ragged.map((s) => zScores(s, theoreticalCalibration(s.source)))
    let expected = netvar(
      zs.map((z) => z.slice(0, 500)),
      SOURCES,
    ).statistic
    const tail = netvar(
      [(zs[0] as Float64Array).slice(500), (zs[2] as Float64Array).slice(500)],
      ['a', 'c'],
    )
    expected += tail.statistic
    expect(event?.value as number).toBeCloseTo(expected, 9)
  })

  test('Date windows resolve via timestamps', () => {
    const series = nullSeries(100, 0x500).map((s) => ({
      ...s,
      timestamps: Float64Array.from({ length: 100 }, (_, t) => 1_700_000_000_000 + t * 1000),
    }))
    const result = analyzeTrials(series, {
      events: [
        {
          id: 'dated',
          statistic: 'netvar',
          start: new Date(1_700_000_000_000 + 20_000),
          end: new Date(1_700_000_000_000 + 50_000),
        },
      ],
    })
    expect(result.events[0]?.steps).toBe(30)
  })

  test('window validation: malformed windows throw invalid_window', () => {
    const series = nullSeries(100, 0x600)
    for (const [start, end] of [
      [50, 20],
      [-1, 10],
      [10, 10],
      [0.5, 10],
    ] as const) {
      expect(() =>
        analyzeTrials(series, { events: [{ id: 'bad', statistic: 'netvar', start, end }] }),
      ).toThrow(expect.objectContaining({ code: 'invalid_window' }))
    }
    // Date window without timestamps
    expect(() =>
      analyzeTrials(series, {
        events: [{ id: 'nots', statistic: 'netvar', start: new Date(0), end: new Date(1000) }],
      }),
    ).toThrow(NegentropyError)
  })

  test('no events → NaN composite, archival series still returned', () => {
    const result = analyzeTrials(nullSeries(50, 0x700), {})
    expect(result.events).toEqual([])
    expect(result.composite.events).toBe(0)
    expect(Number.isNaN(result.composite.z)).toBe(true)
    expect(result.composite.reason).toBe('no complete events')
    expect(result.series.length).toBe(3)
  })

  test('rejects duplicate sources and event ids, bad calibrations, and width mismatches', () => {
    const series = nullSeries(50, 0x710)
    const e = { id: 'e', statistic: 'netvar' as const, start: 0, end: 10 }
    const code = (fn: () => unknown, expected: string) =>
      expect(fn).toThrow(expect.objectContaining({ code: expected }))
    code(
      () => analyzeTrials([series[0] as TrialSeries, series[0] as TrialSeries], {}),
      'invalid_config',
    )
    code(() => analyzeTrials(series, { events: [e, e] }), 'invalid_config')
    const cal = (source: string, sd: number, mean = 100) => ({
      ...theoreticalCalibration(source),
      sd,
      mean,
    })
    code(
      () => analyzeTrials(series, { calibration: SOURCES.map((s) => cal(s, 0)) }),
      'invalid_config',
    )
    code(
      () => analyzeTrials(series, { calibration: SOURCES.map((s) => cal(s, 7, Number.NaN)) }),
      'invalid_config',
    )
    code(() => analyzeTrials(series, { trial: { bitsPerTrial: 64 } }), 'invalid_config')
    code(() => analyzeTrials([], {}), 'invalid_config')
    const withNaN = { ...(series[0] as TrialSeries), sums: Float64Array.from([100, Number.NaN]) }
    code(() => analyzeTrials([withNaN], {}), 'invalid_config') // NaN needs missing: 'skip'
    const withInf = { ...withNaN, sums: Float64Array.from([100, Number.POSITIVE_INFINITY]) }
    code(() => analyzeTrials([withInf], { missing: 'skip' }), 'invalid_config')
  })

  test('rejects mixed bitsPerTrial and missing calibrations', () => {
    const series = nullSeries(50, 0x800)
    const mixed = [
      series[0] as TrialSeries,
      { source: 'b', bitsPerTrial: 128, sums: new Float64Array(50) },
    ]
    expect(() => analyzeTrials(mixed, {})).toThrow(NegentropyError)
    expect(() => analyzeTrials(series, { calibration: [theoreticalCalibration('a')] })).toThrow(
      NegentropyError,
    ) // b and c uncalibrated
  })
})

describe('analyzeBytes', () => {
  test('is trialsFromBytes + analyzeTrials', () => {
    const recordings = SOURCES.map((source, i) => ({
      source,
      bytes: prngBytes(600 * 25, 0x900 + i * 47),
    }))
    const viaBytes = analyzeBytes(recordings, {
      events: [{ id: 'e', statistic: 'netvar', start: 0, end: 600 }],
    })
    const viaTrials = analyzeTrials(
      recordings.map((r) => trialsFromBytes(r.bytes, r.source)),
      { events: [{ id: 'e', statistic: 'netvar', start: 0, end: 600 }] },
    )
    expect(viaBytes.events[0]?.value).toBe(viaTrials.events[0]?.value)
  })

  test('an interval clock cannot be applied to raw bytes (invalid_config)', async () => {
    const recordings = [{ source: 'a', bytes: prngBytes(2500, 0x901) }]
    const trial = { clock: { mode: 'interval' as const, intervalMs: 1000 } }
    expect(() => analyzeBytes(recordings, { trial })).toThrow(
      expect.objectContaining({ code: 'invalid_config' }),
    )
    const registration = await registerExperiment({ trial })
    expect(() => analyzeBytes(recordings, registration)).toThrow(
      expect.objectContaining({ code: 'invalid_config' }),
    )
    expect(() => analyzeBytes([{ source: 'a', bytes: [1, 2] as never }], {})).toThrow(
      expect.objectContaining({ code: 'invalid_config' }),
    )
  })
})
