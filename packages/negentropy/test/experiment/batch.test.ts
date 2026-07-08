import { describe, expect, test } from 'bun:test'
import { NegentropyError } from '../../src/errors.js'
import { analyzeBytes, analyzeTrials } from '../../src/experiment/batch.js'
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
    expect(result.composite.events).toBe(1)
    expect(result.series.length).toBe(3)
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

  test("missing 'error' rejects ragged series; 'skip' truncates to the shortest", () => {
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
      events: [{ id: 'e', statistic: 'netvar', start: 0, end: 500 }],
    })
    expect(result.series.every((s) => s.sums.length === 500)).toBe(true)
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

  test('window validation', () => {
    const series = nullSeries(100, 0x600)
    for (const [start, end] of [
      [50, 20],
      [-1, 10],
      [0, 101],
      [10, 10],
    ] as const) {
      expect(() =>
        analyzeTrials(series, { events: [{ id: 'bad', statistic: 'netvar', start, end }] }),
      ).toThrow(NegentropyError)
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
    expect(result.series.length).toBe(3)
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
})
