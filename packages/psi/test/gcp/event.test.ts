import { describe, expect, test } from 'bun:test'
import {
  calibrate,
  cumulativeDeviation,
  devvar,
  netvar,
  significanceEnvelope,
  stoufferZ,
  theoreticalCalibration,
  zScores,
} from '@mindpeeker/negentropy'
import { analyzeEvent } from '../../src/gcp/event.js'
import type { TrialSeries } from '../../src/types.js'

function series(source: string, sums: number[], timestamps: number[], k = 16): TrialSeries {
  return {
    source,
    bitsPerTrial: k,
    sums: Float64Array.from(sums),
    timestamps: Float64Array.from(timestamps),
  }
}

// k = 16: mean 8, sd 2. z1 = [1, 0, −1, 0], z2 = [0, 0, 1, −1]
const ts = [0, 1000, 2000, 3000]
const s1 = series('a', [10, 8, 6, 8], ts)
const s2 = series('b', [8, 8, 10, 6], ts)

describe('analyzeEvent', () => {
  test('reproduces hand-computed values on a tiny fixture', () => {
    const result = analyzeEvent([s1, s2], { startMs: 0, endMs: 4000 })
    expect(result.sources).toEqual(['a', 'b'])
    expect(result.steps).toBe(4)
    // per-step Stouffer: [(1+0)/√2, 0, (−1+1)/√2, (0−1)/√2]
    const r = Math.SQRT1_2
    expect([...result.stoufferPerTrial].map((z) => Number(z.toFixed(12)))).toEqual(
      [r, 0, 0, -r].map((z) => Number(z.toFixed(12))),
    )
    expect(result.netvar.statistic).toBeCloseTo(1, 12) // 0.5 + 0 + 0 + 0.5
    expect(result.netvar.df).toBe(4)
    expect(result.devvar.statistic).toBeCloseTo(4, 12) // (1+0+1+0) + (0+0+1+1)
    expect(result.devvar.df).toBe(8)
    expect([...result.cumdev].map((d) => Number(d.toFixed(12)))).toEqual([-0.5, -1.5, -2.5, -3])
    expect(result.envelope.length).toBe(4)
    expect(result.composite.statistic).toBeCloseTo(0, 12) // (r + 0 + 0 − r)/√4
    expect(result.composite.pValue).toBeCloseTo(1, 12)
    expect(result.composite.n).toBe(4)
  })

  test('windows by timestamp: [startMs, endMs) selects the inner trials', () => {
    const result = analyzeEvent([s1, s2], { startMs: 1000, endMs: 3000 })
    expect(result.steps).toBe(2)
    // steps 1 and 2: z1 = [0, −1], z2 = [0, 1] → stouffers [0, 0]
    expect(result.stoufferPerTrial[0]).toBeCloseTo(0, 12)
    expect(result.stoufferPerTrial[1]).toBeCloseTo(0, 12)
    expect(result.netvar.df).toBe(2)
  })

  test('matches negentropy primitives exactly (composition regression gate)', () => {
    const result = analyzeEvent([s1, s2], { startMs: 0, endMs: 4000 }, { envelopeP: 0.01 })
    const sources = ['a', 'b']
    const zBySource = [s1, s2].map((s) => zScores(s, theoreticalCalibration(s.source, 16)))
    const stouffers = new Float64Array(4)
    const column = new Float64Array(2)
    for (let t = 0; t < 4; t++) {
      for (let i = 0; i < 2; i++) column[i] = (zBySource[i] as Float64Array)[t] as number
      stouffers[t] = stoufferZ(column)
    }
    expect(result.stoufferPerTrial).toEqual(stouffers)
    expect(result.netvar).toEqual(netvar(zBySource, sources))
    expect(result.devvar).toEqual(devvar(zBySource, sources))
    expect(result.cumdev).toEqual(cumulativeDeviation(stouffers))
    expect(result.envelope).toEqual(significanceEnvelope(4, 0.01))
    expect(result.composite.statistic).toBe(stoufferZ(stouffers))
  })

  test('detects a common signal: correlated sources push netvar up', () => {
    // both sources deviate together: z = +2 each step → stouffer = 2√2, netvar = 8·steps...
    const hot1 = series('a', [12, 12, 12, 12], ts)
    const hot2 = series('b', [12, 12, 12, 12], ts)
    const result = analyzeEvent([hot1, hot2], { startMs: 0, endMs: 4000 })
    expect(result.netvar.statistic).toBeCloseTo(32, 10) // (2√2)² × 4
    expect(result.netvar.pValue).toBeLessThan(1e-4)
    expect(result.composite.statistic).toBeCloseTo(Math.sqrt(4) * 2 * Math.SQRT2, 10)
  })

  test('error paths: window, timestamps, alignment, duplicates, mixed k', () => {
    expect(() => analyzeEvent([], { startMs: 0, endMs: 1 })).toThrow(
      expect.objectContaining({ code: 'invalid_plan' }) as unknown as Error,
    )
    expect(() => analyzeEvent([s1, s2], { startMs: 3000, endMs: 1000 })).toThrow(
      expect.objectContaining({ code: 'invalid_plan' }) as unknown as Error,
    )
    expect(() => analyzeEvent([s1, s2], { startMs: 0, endMs: 4000 }, { envelopeP: 1 })).toThrow(
      expect.objectContaining({ code: 'invalid_plan' }) as unknown as Error,
    )
    const noTs: TrialSeries = { source: 'c', bitsPerTrial: 16, sums: Float64Array.from([8]) }
    expect(() => analyzeEvent([noTs], { startMs: 0, endMs: 1 })).toThrow(
      expect.objectContaining({ code: 'bad_record' }) as unknown as Error,
    )
    expect(() => analyzeEvent([s1, s1], { startMs: 0, endMs: 4000 })).toThrow(
      expect.objectContaining({ code: 'source_mismatch' }) as unknown as Error,
    )
    const k64 = series('b', [32, 32, 32, 32], ts, 64)
    expect(() => analyzeEvent([s1, k64], { startMs: 0, endMs: 4000 })).toThrow(
      expect.objectContaining({ code: 'source_mismatch' }) as unknown as Error,
    )
    // misaligned: b's trials sit 500 ms later, so [0, 3500) selects 4 vs 3
    const shifted = series('b', [8, 8, 10, 6], [500, 1500, 2500, 3500])
    expect(() => analyzeEvent([s1, shifted], { startMs: 0, endMs: 3500 })).toThrow(
      expect.objectContaining({ code: 'source_mismatch' }) as unknown as Error,
    )
    expect(() => analyzeEvent([s1, s2], { startMs: 9000, endMs: 10000 })).toThrow(
      expect.objectContaining({ code: 'insufficient_data' }) as unknown as Error,
    )
  })

  test('equal counts but misaligned rounds throw source_mismatch (regression)', () => {
    // Perfectly correlated sums, but per-source timestamps offset by 5ms — the
    // window keeps rounds {1,2,3} of a and {0,1,2} of b (both 3 trials). The
    // old count-only guard accepted this and reported the correlation as chance.
    const mk = (source: string, ts: number[]): TrialSeries =>
      Object.freeze({
        source,
        bitsPerTrial: 16,
        sums: Float64Array.from([12, 4, 12, 4]),
        timestamps: Float64Array.from(ts),
      })
    const a = mk('a', [0, 10, 20, 30])
    const b = mk('b', [5, 15, 25, 35])
    expect(() => analyzeEvent([a, b], { startMs: 5, endMs: 35 })).toThrow(
      expect.objectContaining({ code: 'source_mismatch' }) as unknown as Error,
    )
    // A window keeping the identical rounds from both sources still works.
    const aligned = analyzeEvent([a, b], { startMs: -1, endMs: 6 })
    expect(aligned.steps).toBe(1)
  })
})

describe('analyzeEvent — step windows and round alignment', () => {
  test('a step window equals the matching wall-clock window', () => {
    const byStep = analyzeEvent([s1, s2], { startStep: 1, endStep: 3 })
    const byMs = analyzeEvent([s1, s2], { startMs: 1000, endMs: 3000 })
    expect(byStep.steps).toBe(2)
    expect(byStep.stoufferPerTrial).toEqual(byMs.stoufferPerTrial)
    expect(byStep.netvar).toEqual(byMs.netvar)
    // step windows need no timestamps
    const bare = (x: TrialSeries): TrialSeries => ({ ...x, timestamps: undefined })
    expect(analyzeEvent([bare(s1), bare(s2)], { startStep: 0, endStep: 4 }).netvar).toEqual(
      analyzeEvent([s1, s2], { startMs: 0, endMs: 4000 }).netvar,
    )
  })

  test("alignment: 'round' windows whole rounds when per-source stamps straddle an edge", () => {
    // three lock-step sources stamping 0, 3, 6 ms after each 100-ms round start
    const rounds = 10
    const mk = (source: string, lag: number, sums: number[]): TrialSeries => ({
      source,
      bitsPerTrial: 16,
      sums: Float64Array.from(sums),
      timestamps: Float64Array.from({ length: rounds }, (_, r) => 100 * r + lag),
    })
    const sums = Array.from({ length: rounds }, (_, r) => 6 + (r % 5))
    const set = [mk('a', 0, sums), mk('b', 3, [...sums].reverse()), mk('c', 6, sums)]
    const window = { startMs: 302, endMs: 702 } // edge lands inside rounds 3 and 7
    expect(() => analyzeEvent(set, window)).toThrow(
      expect.objectContaining({ code: 'source_mismatch' }) as unknown as Error,
    )
    const round = analyzeEvent(set, window, { alignment: 'round' })
    // round stamps are 100r + 6 → rounds 3…6 are inside [302, 702)
    expect(round.steps).toBe(4)
    expect(round.netvar).toEqual(analyzeEvent(set, { startStep: 3, endStep: 7 }).netvar)
  })
})

describe('analyzeEvent — calibration options', () => {
  test('explicit calibrations: theoretical equivalents reproduce the default; custom ones apply', () => {
    const theoretical = [theoreticalCalibration('a', 16), theoreticalCalibration('b', 16)]
    const window = { startMs: 0, endMs: 4000 }
    expect(analyzeEvent([s1, s2], window, { calibration: theoretical }).netvar).toEqual(
      analyzeEvent([s1, s2], window).netvar,
    )
    const custom = [
      { source: 'a', bitsPerTrial: 16, trials: 100, mean: 9, sd: 1, basis: 'empirical' as const },
      { source: 'b', bitsPerTrial: 16, trials: 100, mean: 8, sd: 2, basis: 'empirical' as const },
    ]
    const result = analyzeEvent([s1, s2], window, { calibration: custom })
    // a: (10,8,6,8) → z (1,−1,−3,−1); b: (0,0,1,−1) → stouffers (1,−1,−2,−2)/√2
    const expected = [1, -1, -2, -2].map((v) => v / Math.SQRT2)
    result.stoufferPerTrial.forEach((z, t) => {
      expect(z).toBeCloseTo(expected[t] as number, 14)
    })
    expect(result.calibrations).toEqual(custom)
  })

  test('history calibration fits negentropy calibrate on a disjoint series', () => {
    const history = (source: string, seed: number): TrialSeries => ({
      source,
      bitsPerTrial: 16,
      sums: Float64Array.from({ length: 600 }, (_, i) => 8 + ((i * seed) % 5) - 2),
      timestamps: Float64Array.from({ length: 600 }, (_, i) => -1_000_000 + i),
    })
    const hist = [history('a', 3), history('b', 7)]
    const window = { startMs: 0, endMs: 4000 }
    const result = analyzeEvent([s1, s2], window, { calibration: { history: hist } })
    expect(result.calibrations).toEqual([
      calibrate(hist[0] as TrialSeries),
      calibrate(hist[1] as TrialSeries),
    ])
    const zA = zScores(s1, calibrate(hist[0] as TrialSeries))
    const zB = zScores(s2, calibrate(hist[1] as TrialSeries))
    expect(result.netvar).toEqual(netvar([zA, zB], ['a', 'b']))
    const code = (c: string) =>
      expect.objectContaining({ name: 'PsiError', code: c }) as unknown as Error
    expect(() => analyzeEvent([s1, s2], window, { calibration: { history: [s1, s2] } })).toThrow(
      code('invalid_plan'),
    )
    const overlapping = hist.map((h) => ({
      ...h,
      timestamps: Float64Array.from({ length: 600 }, (_, i) => i),
    }))
    expect(() => analyzeEvent([s1, s2], window, { calibration: { history: overlapping } })).toThrow(
      code('invalid_plan'),
    )
    expect(() =>
      analyzeEvent([s1, s2], window, { calibration: { history: hist, minTrials: 1000 } }),
    ).toThrow(code('insufficient_data'))
    expect(() =>
      analyzeEvent([s1, s2], window, { calibration: { history: [hist[0] as TrialSeries] } }),
    ).toThrow(code('invalid_plan'))
    expect(() =>
      analyzeEvent([s1, s2], window, { calibration: [theoreticalCalibration('a', 16)] }),
    ).toThrow(code('invalid_plan'))
  })
})

describe('analyzeEvent — blocking, envelope cache, validation', () => {
  test('blockSeconds: Σ_B Z_B² over wall-clock blocks', () => {
    // stouffers (r, 0, 0, −r), r = 1/√2; 2-s blocks → Z_B = (r+0)/√2 = ½ and (0−r)/√2 = −½
    const result = analyzeEvent([s1, s2], { startMs: 0, endMs: 4000 }, { blockSeconds: 2 })
    const blocked = result.blocked
    expect(blocked?.blockSeconds).toBe(2)
    expect([...(blocked?.steps ?? [])]).toEqual([2, 2])
    expect(blocked?.stouffer[0]).toBeCloseTo(0.5, 14)
    expect(blocked?.stouffer[1]).toBeCloseTo(-0.5, 14)
    expect(blocked?.netvar.statistic).toBeCloseTo(0.5, 14)
    expect(blocked?.netvar.df).toBe(2)
    expect(blocked?.netvar.pValue).toBeCloseTo(Math.exp(-0.25), 12) // χ²₂ survival e^{−x/2}
    expect(analyzeEvent([s1, s2], { startMs: 0, endMs: 4000 }).blocked).toBeUndefined()
  })

  test('the memoized envelope is a fresh copy per call', () => {
    const first = analyzeEvent([s1, s2], { startMs: 0, endMs: 4000 }, { envelopeP: 0.02 })
    first.envelope.fill(0)
    const second = analyzeEvent([s1, s2], { startMs: 0, endMs: 4000 }, { envelopeP: 0.02 })
    expect(second.envelope).toEqual(significanceEnvelope(4, 0.02))
  })

  test('malformed inputs are PsiError, not foreign errors', () => {
    const code = (c: string) =>
      expect.objectContaining({ name: 'PsiError', code: c }) as unknown as Error
    const zeroBits: TrialSeries = { source: 'z', bitsPerTrial: 0, sums: Float64Array.from([0]) }
    expect(() => analyzeEvent([zeroBits], { startStep: 0, endStep: 1 })).toThrow(
      code('invalid_plan'),
    )
    const nan: TrialSeries = {
      source: 'n',
      bitsPerTrial: 16,
      sums: Float64Array.from([Number.NaN]),
    }
    expect(() => analyzeEvent([nan], { startStep: 0, endStep: 1 })).toThrow(code('invalid_plan'))
    expect(() => analyzeEvent([s1, s2], { startStep: 2, endStep: 2 })).toThrow(code('invalid_plan'))
    expect(() => analyzeEvent([s1, s2], { startStep: 0.5, endStep: 2 })).toThrow(
      code('invalid_plan'),
    )
    expect(() => analyzeEvent([s1, s2], { startStep: 0, endStep: 5 })).toThrow(
      code('insufficient_data'),
    )
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: deliberately unknown alignment
      analyzeEvent([s1, s2], { startMs: 0, endMs: 1 }, { alignment: 'loose' as any }),
    ).toThrow(code('invalid_plan'))
    expect(() => analyzeEvent([s1, s2], { startMs: 0, endMs: 1 }, { blockSeconds: 0 })).toThrow(
      code('invalid_plan'),
    )
    const bare = (x: TrialSeries): TrialSeries => ({ ...x, timestamps: undefined })
    expect(() =>
      analyzeEvent([bare(s1), bare(s2)], { startStep: 0, endStep: 4 }, { blockSeconds: 1 }),
    ).toThrow(code('bad_record'))
    expect(() =>
      analyzeEvent([bare(s1), s2], { startMs: 0, endMs: 4000 }, { alignment: 'round' }),
    ).toThrow(code('bad_record'))
    // biome-ignore lint/suspicious/noExplicitAny: deliberately missing window
    expect(() => analyzeEvent([s1], undefined as any)).toThrow(code('invalid_plan'))
  })
})
