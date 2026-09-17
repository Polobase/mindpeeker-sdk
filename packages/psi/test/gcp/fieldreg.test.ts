import { describe, expect, test } from 'bun:test'
import { analyzeFieldReg } from '../../src/gcp/fieldreg.js'
import type { TrialSeries } from '../../src/types.js'

// k = 16 (mean 8, sd 2). Segment A: z (2,2,1,1) → Stouffer 3; B: z 0; C: z (−1,0,1,−2) → −1.
// Reference numbers: closed forms (erfc, χ² survival for even df, χ²₃ survival) in Python.
const series: TrialSeries = {
  source: 'fieldreg',
  bitsPerTrial: 16,
  sums: Float64Array.from([12, 12, 10, 10, 8, 8, 8, 8, 6, 8, 10, 4]),
  timestamps: Float64Array.from({ length: 12 }, (_, i) => 60_000 * i),
}

const segments = [
  { id: 'A', label: 'opening', startStep: 0, endStep: 4 },
  { id: 'C', startStep: 8, endStep: 12 },
  { id: 'B', startStep: 4, endStep: 8 },
]

const code = (c: string) =>
  expect.objectContaining({ name: 'PsiError', code: c }) as unknown as Error

describe('analyzeFieldReg', () => {
  test('per-segment z, Šidák-corrected extreme, scale correction, composites', () => {
    const a = analyzeFieldReg(series, segments, { scales: 2 })
    expect(a.segments.map((s) => s.id)).toEqual(['A', 'B', 'C']) // chronological
    expect(a.segments[0]?.label).toBe('opening')
    expect(a.segments.map((s) => s.z)).toEqual([3, 0, -1])
    expect(a.segments[0]?.pValue).toBeCloseTo(0.0026997960632601913, 14)
    expect(a.segments[2]?.pValue).toBeCloseTo(0.3173105078629141, 14)
    expect(a.segments[0]?.chiSquare.statistic).toBe(10)
    expect(a.segments[0]?.chiSquare.pValue).toBeCloseTo(0.0404276819945128, 13)
    expect(a.extreme.id).toBe('A')
    expect(a.extreme.pCorrected).toBeCloseTo(0.008077541171971236, 14)
    expect(a.extreme.pScale).toBeCloseTo(0.016089835672557617, 14)
    expect(a.composite.stouffer.statistic).toBeCloseTo(1.1547005383792517, 14)
    expect(a.composite.stouffer.pValue).toBeCloseTo(0.2482130789899236, 13)
    expect(a.composite.chiSquare.statistic).toBeCloseTo(10, 14)
    expect(a.composite.chiSquare.pValue).toBeCloseTo(0.018566135463043233, 13)
    expect(a.composite.fisher.statistic).toBeCloseTo(14.124907010799443, 12)
    expect(a.composite.fisher.df).toBe(6)
    expect(a.composite.fisher.pValue).toBeCloseTo(0.028271582835314023, 12)
  })

  test('Bonferroni and the variance statistic', () => {
    const bonferroni = analyzeFieldReg(series, segments, { correction: 'bonferroni', scales: 2 })
    expect(bonferroni.extreme.pCorrected).toBeCloseTo(0.008099388189780574, 15)
    expect(bonferroni.extreme.pScale).toBeCloseTo(0.016198776379561148, 15)
    const variance = analyzeFieldReg(series, segments, { statistic: 'variance' })
    expect(variance.segments[1]?.pValue).toBe(1) // Σz² = 0
    expect(variance.extreme.id).toBe('A')
    expect(variance.extreme.pCorrected).toBeCloseTo(1 - (1 - 0.0404276819945128) ** 3, 13)
    expect(variance.extreme.pScale).toBe(variance.extreme.pCorrected) // scales = 1
  })

  test('wall-clock segments select contiguous trials by timestamp', () => {
    const a = analyzeFieldReg(series, [
      { id: 'first', startMs: 0, endMs: 240_000 },
      { id: 'last', startMs: 480_000, endMs: 720_000 },
    ])
    expect(a.segments.map((s) => [s.startStep, s.endStep])).toEqual([
      [0, 4],
      [8, 12],
    ])
    expect(a.segments.map((s) => s.z)).toEqual([3, -1])
  })

  test('errors', () => {
    expect(() => analyzeFieldReg(series, [])).toThrow(code('insufficient_data'))
    expect(() =>
      analyzeFieldReg(series, [
        { id: 'x', startStep: 0, endStep: 5 },
        { id: 'y', startStep: 4, endStep: 8 },
      ]),
    ).toThrow(code('invalid_plan'))
    expect(() =>
      analyzeFieldReg(series, [
        { id: 'x', startStep: 0, endStep: 2 },
        { id: 'x', startStep: 2, endStep: 4 },
      ]),
    ).toThrow(code('invalid_plan'))
    expect(() => analyzeFieldReg(series, [{ id: 'x', startStep: 0, endStep: 13 }])).toThrow(
      code('insufficient_data'),
    )
    expect(() => analyzeFieldReg(series, [{ id: 'x', startMs: 1, endMs: 2 }])).toThrow(
      code('insufficient_data'),
    )
    expect(() => analyzeFieldReg(series, segments, { scales: 0 })).toThrow(code('invalid_plan'))
    // biome-ignore lint/suspicious/noExplicitAny: deliberately unknown options
    expect(() => analyzeFieldReg(series, segments, { correction: 'holm' as any })).toThrow(
      code('invalid_plan'),
    )
    // biome-ignore lint/suspicious/noExplicitAny: deliberately unknown options
    expect(() => analyzeFieldReg(series, segments, { statistic: 'max' as any })).toThrow(
      code('invalid_plan'),
    )
    const bare = { ...series, timestamps: undefined }
    expect(() => analyzeFieldReg(bare, [{ id: 'x', startMs: 0, endMs: 10 }])).toThrow(
      code('bad_record'),
    )
    const bad = { ...series, bitsPerTrial: 4 }
    expect(() => analyzeFieldReg(bad, segments)).toThrow(code('invalid_plan'))
  })
})
