import { describe, expect, test } from 'bun:test'
import {
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
