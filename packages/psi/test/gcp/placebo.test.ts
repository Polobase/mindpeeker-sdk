import { describe, expect, test } from 'bun:test'
import { analyzeEvent } from '../../src/gcp/event.js'
import { placeboWindows } from '../../src/gcp/placebo.js'
import { permutationP } from '../../src/resample/surrogates.js'
import type { TrialSeries } from '../../src/types.js'
import { prngBytes } from '../helpers/trial-sources.js'

function archive(steps: number, sources = 2): TrialSeries[] {
  return Array.from({ length: sources }, (_, i) => {
    const bytes = prngBytes(steps, 0x100 + i)
    return {
      source: `egg${i}`,
      bitsPerTrial: 8,
      sums: Float64Array.from(bytes, (b) => b.toString(2).replace(/0/g, '').length),
      timestamps: Float64Array.from({ length: steps }, (_, t) => 1_000 * t),
    }
  })
}

const code = (c: string) =>
  expect.objectContaining({ name: 'PsiError', code: c }) as unknown as Error

describe('placeboWindows', () => {
  test('seeded draws avoid exclusions and match the Python reference', () => {
    const data = archive(50)
    const windows = placeboWindows(data, {
      windowSteps: 5,
      count: 4,
      seed: 7,
      exclude: [{ startStep: 20, endStep: 30 }],
    })
    // 32 admissible starts (0…15, 30…45); reference partial Fisher–Yates over splitmix64 → xoshiro128**
    expect(windows.map((w) => w.startStep)).toEqual([7, 10, 14, 44])
    for (const w of windows) {
      expect(w.endStep - w.startStep).toBe(5)
      expect(w.endStep <= 20 || w.startStep >= 30).toBe(true)
    }
    const seed0 = placeboWindows(data, {
      windowSteps: 5,
      count: 4,
      exclude: [{ startStep: 20, endStep: 30 }],
    })
    expect(seed0.map((w) => w.startStep)).toEqual([8, 11, 38, 44])
  })

  test('wall-clock exclusions cover every step any source stamps inside them', () => {
    const data = archive(40)
    // exclude [9.5 s, 20 s) → steps 10…19; with windows of 4, starts 7…19 are inadmissible
    const windows = placeboWindows(data, {
      windowSteps: 4,
      count: 24,
      exclude: [{ startMs: 9_500, endMs: 20_000 }],
    })
    expect(windows.length).toBe(24) // 37 − 13 = 24 admissible starts, all drawn
    expect(windows.map((w) => w.startStep)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
    ])
    expect(() =>
      placeboWindows(data, {
        windowSteps: 4,
        count: 25,
        exclude: [{ startMs: 9_500, endMs: 20_000 }],
      }),
    ).toThrow(code('insufficient_data'))
  })

  test('explicit starts are validated; placebos feed analyzeEvent and permutationP', () => {
    const data = archive(60)
    const windows = placeboWindows(data, { windowSteps: 10, starts: [0, 30, 50] })
    expect(windows).toEqual([
      { startStep: 0, endStep: 10 },
      { startStep: 30, endStep: 40 },
      { startStep: 50, endStep: 60 },
    ])
    const event = analyzeEvent(data, { startStep: 15, endStep: 25 }).netvar.statistic
    const nulls = windows.map((w) => analyzeEvent(data, w).netvar.statistic)
    const p = permutationP(event, nulls)
    expect(p).toBeGreaterThanOrEqual(0.25)
    expect(p).toBeLessThanOrEqual(1)
    expect(() =>
      placeboWindows(data, {
        windowSteps: 10,
        starts: [12],
        exclude: [{ startStep: 15, endStep: 25 }],
      }),
    ).toThrow(code('invalid_plan'))
    expect(() => placeboWindows(data, { windowSteps: 10, starts: [51] })).toThrow(
      code('invalid_plan'),
    )
    expect(() => placeboWindows(data, { windowSteps: 10, starts: [3, 3] })).toThrow(
      code('invalid_plan'),
    )
    expect(() => placeboWindows(data, { windowSteps: 10, starts: [3], seed: 1 })).toThrow(
      code('invalid_plan'),
    )
  })

  test('errors', () => {
    const data = archive(20)
    expect(() => placeboWindows([], { windowSteps: 1, count: 1 })).toThrow(code('invalid_plan'))
    expect(() => placeboWindows(data, { windowSteps: 0, count: 1 })).toThrow(code('invalid_plan'))
    expect(() => placeboWindows(data, { windowSteps: 21, count: 1 })).toThrow(
      code('insufficient_data'),
    )
    expect(() => placeboWindows(data, { windowSteps: 2 })).toThrow(code('invalid_plan'))
    expect(() => placeboWindows(data, { windowSteps: 2, count: 1, starts: [0] })).toThrow(
      code('invalid_plan'),
    )
    const ragged = [
      data[0] as TrialSeries,
      { ...(data[1] as TrialSeries), sums: new Float64Array(3) },
    ]
    expect(() => placeboWindows(ragged, { windowSteps: 2, count: 1 })).toThrow(
      code('source_mismatch'),
    )
    const bare = data.map((s) => ({ ...s, timestamps: undefined }))
    expect(() =>
      placeboWindows(bare, { windowSteps: 2, count: 1, exclude: [{ startMs: 0, endMs: 10 }] }),
    ).toThrow(code('bad_record'))
  })
})
