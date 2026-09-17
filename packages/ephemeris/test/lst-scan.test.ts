import { describe, expect, test } from 'bun:test'
import { EphemerisError, julianDay, type LstTimedTrial, lst, lstWindowScan } from '../src/index.js'
import { bruteWindowMeans, mulberry32, syntheticTrials } from './helpers/data.js'

function codeOf(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error) {
    if (error instanceof EphemerisError) return error.code
    throw error
  }
  return undefined
}

describe('lstWindowScan', () => {
  test('defaults reproduce Spottiswoode’s grid: 240 windows of 2 h every 0.1 h, padded', () => {
    const scan = lstWindowScan([{ lstHours: 13.5, effect: 1 }])
    expect(scan.windows).toHaveLength(240)
    expect(scan.options).toEqual({
      windowHours: 2,
      stepHours: 0.1,
      pad: true,
      minTrials: 1,
      sidereal: 'mean',
    })
    expect(scan.windows[135]?.centerHours).toBeCloseTo(13.5, 12)
  })

  test('window means, counts and SDs equal a brute-force circular computation', () => {
    const trials = syntheticTrials(400, 11, 0.8)
    const scan = lstWindowScan(trials)
    const brute = bruteWindowMeans(trials, 2, 0.1)
    for (let j = 0; j < 240; j++) {
      const w = scan.windows[j]
      const b = brute[j]
      expect(w?.n).toBe(b?.n as number)
      expect(w?.mean as number).toBeCloseTo(b?.mean as number, 10)
    }
    const w = scan.windows[100]
    const inside = trials.filter((t) => (((t.lstHours - 10 + 1) % 24) + 24) % 24 < 2)
    const mean = inside.reduce((s, t) => s + t.effect, 0) / inside.length
    const sd = Math.sqrt(
      inside.reduce((s, t) => s + (t.effect - mean) ** 2, 0) / (inside.length - 1),
    )
    expect(w?.sd as number).toBeCloseTo(sd, 10)
    expect(w?.standardError as number).toBeCloseTo(sd / Math.sqrt(inside.length), 10)
  })

  test('padding wraps windows around 0 h; pad: false truncates them', () => {
    const trials = [
      { lstHours: 23.6, effect: 2 },
      { lstHours: 0.4, effect: 4 },
      { lstHours: 12, effect: 0 },
    ]
    const padded = lstWindowScan(trials)
    expect(padded.windows[0]).toMatchObject({ centerHours: 0, n: 2, mean: 3 })
    const truncated = lstWindowScan(trials, { pad: false })
    expect(truncated.windows[0]).toMatchObject({ n: 1, mean: 4 })
    expect(truncated.windows[239]).toMatchObject({ n: 1, mean: 2 })
  })

  test('windows are half-open [c − w/2, c + w/2)', () => {
    const scan = lstWindowScan([{ lstHours: 11, effect: 1 }], { stepHours: 1 })
    expect(scan.windows[12]?.n).toBe(1) // [11, 13)
    expect(scan.windows[10]?.n).toBe(0) // [9, 11)
    expect(scan.windows[10]?.mean).toBeNull()
    expect(scan.windows[10]?.sd).toBeNull()
  })

  test('a 24 h window counts every trial exactly once', () => {
    const trials = syntheticTrials(97, 3)
    const scan = lstWindowScan(trials, { windowHours: 24, stepHours: 1 })
    for (const w of scan.windows) {
      expect(w.n).toBe(97)
      expect(w.mean as number).toBeCloseTo(scan.overallMean, 10)
    }
  })

  test('peak, gain, centroid and half width of a planted plateau', () => {
    const trials = [
      ...Array.from({ length: 240 }, (_, i) => ({ lstHours: i / 10 + 0.05, effect: 0.1 })),
      ...Array.from({ length: 20 }, (_, i) => ({ lstHours: 12.5 + i / 10 + 0.05, effect: 1.1 })),
    ]
    const scan = lstWindowScan(trials, { windowHours: 1 })
    // every window centred in [13, 14] holds 10 baseline and 10 bumped trials: a plateau at 0.6
    expect(scan.peak.centerHours).toBeGreaterThanOrEqual(13 - 1e-9)
    expect(scan.peak.centerHours).toBeLessThanOrEqual(14 + 1e-9)
    expect(scan.peak.mean).toBeCloseTo(0.6, 12)
    expect(scan.peak.gain).toBeCloseTo(scan.peak.mean / scan.overallMean, 12)
    expect(scan.peak.centroidHours).toBeCloseTo(13.5, 6) // symmetric peak
    expect(scan.peak.halfWidthHours).toBeGreaterThan(0.5)
    expect(scan.peak.halfWidthHours).toBeLessThan(1.5)
  })

  test('no peak above the mean: centroid is the peak centre, half width 0, gain null for mean ≤ 0', () => {
    const flat = lstWindowScan(
      Array.from({ length: 48 }, (_, i) => ({ lstHours: i / 2, effect: -1 })),
      { stepHours: 1 },
    )
    expect(flat.peak).toMatchObject({ centerHours: 0, mean: -1, gain: null, halfWidthHours: 0 })
  })

  test('minTrials excludes sparse windows from the peak search', () => {
    const trials = [
      { lstHours: 3, effect: 10 },
      ...Array.from({ length: 5 }, (_, i) => ({ lstHours: 15 + i * 0.1, effect: 1 })),
    ]
    expect(lstWindowScan(trials).peak.mean).toBe(10)
    const scan = lstWindowScan(trials, { minTrials: 3 })
    expect(scan.peak.mean).toBe(1)
    expect(codeOf(() => lstWindowScan(trials, { minTrials: 7 }))).toBe('insufficient_data')
  })

  test('timed trials use lst(); results equal pre-labelled trials', () => {
    const random = mulberry32(99)
    const timed: LstTimedTrial[] = Array.from({ length: 120 }, () => ({
      time: new Date(Date.UTC(1990, 0, 1) + random() * 1e11),
      longitudeEastDeg: -120 + random() * 140,
      effect: random() - 0.3,
    }))
    const labelled = timed.map((t) => ({
      lstHours: lst(julianDay(t.time as Date), t.longitudeEastDeg),
      effect: t.effect,
    }))
    expect(lstWindowScan(timed)).toEqual(lstWindowScan(labelled))
    const asJd = timed.map((t) => ({ ...t, time: julianDay(t.time as Date) }))
    expect(lstWindowScan(asJd)).toEqual(lstWindowScan(timed))
  })

  test('validation', () => {
    const ok = [{ lstHours: 1, effect: 0 }]
    expect(codeOf(() => lstWindowScan([]))).toBe('insufficient_data')
    expect(codeOf(() => lstWindowScan('x' as unknown as []))).toBe('invalid_input')
    expect(codeOf(() => lstWindowScan([{ lstHours: 24, effect: 0 }]))).toBe('invalid_input')
    expect(codeOf(() => lstWindowScan([{ effect: 0 } as never]))).toBe('invalid_input')
    expect(codeOf(() => lstWindowScan([{ lstHours: 1, time: 2451545, effect: 0 } as never]))).toBe(
      'invalid_input',
    )
    expect(codeOf(() => lstWindowScan([{ time: 1.7e12, longitudeEastDeg: 0, effect: 0 }]))).toBe(
      'invalid_time',
    )
    expect(
      codeOf(() => lstWindowScan([{ time: 2451545, longitudeEastDeg: Number.NaN, effect: 0 }])),
    ).toBe('invalid_input')
    expect(
      codeOf(() =>
        lstWindowScan([
          { lstHours: 1, effect: 0, stratum: 'a' },
          { lstHours: 2, effect: 0 },
        ]),
      ),
    ).toBe('invalid_input')
    expect(codeOf(() => lstWindowScan(ok, { windowHours: 0 }))).toBe('invalid_options')
    expect(codeOf(() => lstWindowScan(ok, { windowHours: 25 }))).toBe('invalid_options')
    expect(codeOf(() => lstWindowScan(ok, { stepHours: 0.7 }))).toBe('invalid_options')
    expect(codeOf(() => lstWindowScan(ok, { pad: 'yes' as unknown as boolean }))).toBe(
      'invalid_options',
    )
    expect(codeOf(() => lstWindowScan(ok, { minTrials: 0 }))).toBe('invalid_options')
    try {
      lstWindowScan([ok[0] as never, { time: 'noon', longitudeEastDeg: 0, effect: 1 } as never])
    } catch (error) {
      expect((error as Error).message).toStartWith('trials[1]:')
    }
  })
})
