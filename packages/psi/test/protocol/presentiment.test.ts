import { describe, expect, test } from 'bun:test'
import { trialsFromBytes } from '@mindpeeker/negentropy'
import { PsiError } from '../../src/errors.js'
import {
  analyzePresentiment,
  type PresentimentEpoch,
  type PresentimentEvent,
  presentimentEpochs,
} from '../../src/protocol/presentiment.js'
import type { Stimulus, TrialSeries } from '../../src/types.js'
import { prngBytes } from '../helpers/trial-sources.js'

const BITS = 200

/** A TrialSeries of `n` null trials (Binomial(200, ½)) from seeded bytes. */
function nullSeries(n: number, seed: number): TrialSeries {
  return trialsFromBytes(prngBytes(n * 25, seed), 'reg', { bitsPerTrial: BITS })
}

const code = (c: string) =>
  expect.objectContaining({ name: 'PsiError', code: c }) as unknown as Error

function series(sums: number[]): TrialSeries {
  return { source: 'reg', bitsPerTrial: BITS, sums: Float64Array.from(sums) }
}

/** Build `count` epochs alternating target/control, each window from fresh null bytes. */
function nullEpochs(count: number, windowTrials: number, seed: number): PresentimentEpoch[] {
  const epochs: PresentimentEpoch[] = []
  for (let e = 0; e < count; e++) {
    epochs.push({
      stimulus: e % 2 === 0 ? 'target' : 'control',
      pre: nullSeries(windowTrials, seed + e * 2),
      post: nullSeries(windowTrials, seed + e * 2 + 1),
    })
  }
  return epochs
}

describe('analyzePresentiment', () => {
  test('null epochs: modest pre deltaZ, non-significant permutation p', () => {
    const result = analyzePresentiment(nullEpochs(60, 40, 0x1000))
    expect(result.targetEpochs).toBe(30)
    expect(result.controlEpochs).toBe(30)
    expect(Math.abs(result.pre.deltaZ)).toBeLessThan(3.5)
    expect(result.pre.pValue).toBeGreaterThan(0.001)
    expect(result.permutationP).toBeGreaterThan(0.02)
  })

  test('planted pre-stimulus bias on target epochs → pre fires, post stays null', () => {
    const epochs = nullEpochs(60, 40, 0x2000)
    // shift every target epoch's PRE window strongly upward (mean +3σ per trial)
    const shift = 3 * Math.sqrt(BITS / 4)
    const biased = epochs.map((epoch) =>
      epoch.stimulus === 'target'
        ? { ...epoch, pre: series([...epoch.pre.sums].map((s) => s + shift)) }
        : epoch,
    )
    const result = analyzePresentiment(biased)
    expect(result.pre.deltaZ).toBeGreaterThan(10)
    expect(result.pre.pValue).toBeLessThan(1e-6)
    expect(result.permutationP).toBeLessThan(0.05)
    // post window untouched → ordinary-time control stays unremarkable
    expect(result.post.pValue).toBeGreaterThan(0.001)
    expect(result.permutationP).toBeLessThan(analyzePresentiment(epochs).permutationP)
  })

  test('H0 calibration through the full pipeline: alternating design, P(permutationP ≤ 0.05) ≈ 0.05', () => {
    // 0.1.x rotation null: ≈ 0.46 here. 400 null recordings × 40 alternating epochs.
    const datasets = 400
    const epochsPer = 40
    const pre = 20
    const post = 10
    let permRejects = 0
    let normalRejects = 0
    for (let d = 0; d < datasets; d++) {
      const rec = nullSeries(epochsPer * (pre + post), (0x7000 + d * 0x9e3779b1) >>> 0 || 1)
      const events: PresentimentEvent[] = Array.from({ length: epochsPer }, (_, e) => ({
        at: pre + e * (pre + post),
        stimulus: e % 2 === 0 ? 'target' : 'control',
      }))
      const { epochs } = presentimentEpochs(rec, events, { preWindow: pre, postWindow: post })
      const result = analyzePresentiment(epochs, { seed: d })
      expect(result.shuffle.method).toBe('random')
      if (result.permutationP <= 0.05) permRejects++
      if (result.pre.pValue <= 0.05) normalRejects++
    }
    // nominal: P((1 + b)/101 ≤ 0.05) = 5/101 for the permutation p; 0.05 for the normal p
    const band = (rate: number) => 3.5 * Math.sqrt((rate * (1 - rate)) / datasets)
    expect(Math.abs(permRejects / datasets - 5 / 101)).toBeLessThan(band(5 / 101))
    expect(Math.abs(normalRejects / datasets - 0.05)).toBeLessThan(band(0.05))
  }, 30_000)

  test('the null ensemble is seeded, described, and exact for few relabelings', () => {
    const epochs = nullEpochs(60, 40, 0x1000)
    const a = analyzePresentiment(epochs, { seed: 42, surrogates: 499 })
    const b = analyzePresentiment(epochs, { seed: 42, surrogates: 499 })
    expect(a).toEqual(b)
    expect(a.shuffle).toMatchObject({ method: 'random', surrogates: 499, resolution: 1 / 500 })
    // 4 epochs, 2 targets: C(4,2) = 6 labelings → exact enumeration of the 5 others
    const few = analyzePresentiment(nullEpochs(4, 40, 0x1100))
    expect(few.shuffle).toMatchObject({ method: 'exact', surrogates: 5, distinctLabelings: 6 })
    expect([1, 2, 3, 4, 5, 6].map((j) => j / 6)).toContainEqual(
      expect.closeTo(few.permutationP, 12) as unknown as number,
    )
  })

  test('validation', () => {
    expect(() => analyzePresentiment([])).toThrow(PsiError)
    // unknown stimulus labels are invalid_plan, not silently pooled as controls
    const labelled = (stimulus: string): PresentimentEpoch[] => [
      { stimulus: 'target', pre: nullSeries(10, 11), post: nullSeries(10, 12) },
      { stimulus: stimulus as 'control', pre: nullSeries(10, 13), post: nullSeries(10, 14) },
    ]
    expect(analyzePresentiment(labelled('control')).controlEpochs).toBe(1)
    for (const bad of ['Control', 'ctrl', undefined]) {
      expect(() => analyzePresentiment(labelled(bad as string))).toThrow(code('invalid_plan'))
    }
    // malformed window series
    const zeroBits: PresentimentEpoch[] = [
      {
        stimulus: 'target',
        pre: { source: 'reg', bitsPerTrial: 0, sums: Float64Array.from([0]) },
        post: nullSeries(10, 15),
      },
      { stimulus: 'control', pre: nullSeries(10, 16), post: nullSeries(10, 17) },
    ]
    expect(() => analyzePresentiment(zeroBits)).toThrow(code('invalid_plan'))
    expect(() => analyzePresentiment(labelled('control'), { surrogates: 0 })).toThrow(
      code('invalid_plan'),
    )
    // only targets, no controls
    const onlyTargets: PresentimentEpoch[] = [
      { stimulus: 'target', pre: nullSeries(10, 1), post: nullSeries(10, 2) },
    ]
    expect(() => analyzePresentiment(onlyTargets)).toThrow(PsiError)
    // empty window
    const emptyWindow: PresentimentEpoch[] = [
      { stimulus: 'target', pre: series([]), post: nullSeries(10, 3) },
      { stimulus: 'control', pre: nullSeries(10, 4), post: nullSeries(10, 5) },
    ]
    expect(() => analyzePresentiment(emptyWindow)).toThrow(PsiError)
    // mixed bitsPerTrial
    const mixed: PresentimentEpoch[] = [
      { stimulus: 'target', pre: nullSeries(10, 6), post: nullSeries(10, 7) },
      {
        stimulus: 'control',
        pre: { source: 'reg', bitsPerTrial: 128, sums: Float64Array.from([64, 64]) },
        post: nullSeries(10, 8),
      },
    ]
    expect(() => analyzePresentiment(mixed)).toThrow(PsiError)
  })
})

describe('presentimentEpochs', () => {
  test('segments a recording into pre/post windows around events', () => {
    const rec = nullSeries(1000, 0x3000)
    const events: { at: number; stimulus: Stimulus }[] = [
      { at: 100, stimulus: 'target' },
      { at: 500, stimulus: 'control' },
      { at: 900, stimulus: 'target' },
    ]
    const { epochs, dropped } = presentimentEpochs(rec, events, { preWindow: 50, postWindow: 30 })
    expect(dropped).toBe(0)
    expect(epochs.length).toBe(3)
    expect(epochs[0]?.pre.sums.length).toBe(50)
    expect(epochs[0]?.post.sums.length).toBe(30)
    // pre is series[50,100), post is series[100,130)
    expect([...(epochs[0]?.pre.sums ?? [])]).toEqual([...rec.sums.slice(50, 100)])
    expect([...(epochs[0]?.post.sums ?? [])]).toEqual([...rec.sums.slice(100, 130)])
  })

  test('drops events whose windows fall off either end', () => {
    const rec = nullSeries(200, 0x4000)
    const events: { at: number; stimulus: Stimulus }[] = [
      { at: 10, stimulus: 'target' }, // pre would need index -40
      { at: 100, stimulus: 'control' }, // fits
      { at: 190, stimulus: 'target' }, // post would need index 240
    ]
    const { epochs, dropped } = presentimentEpochs(rec, events, { preWindow: 50, postWindow: 60 })
    expect(dropped).toBe(2)
    expect(epochs.length).toBe(1)
    expect(epochs[0]?.stimulus).toBe('control')
  })

  test('overlapping epochs are rejected unless allowOverlap, which counts and warns', () => {
    const rec = nullSeries(600, 0x6000)
    const plan = { preWindow: 40, postWindow: 20 }
    // exactly pre + post apart is fine, in any event order
    const spaced: PresentimentEvent[] = [
      { at: 160, stimulus: 'control' },
      { at: 100, stimulus: 'target' },
      { at: 220, stimulus: 'target' },
    ]
    const ok = presentimentEpochs(rec, spaced, plan)
    expect(ok.epochs.map((e) => e.stimulus)).toEqual(['control', 'target', 'target'])
    expect(ok.overlapping).toBe(0)
    expect(ok.warnings).toEqual([])
    // one trial closer overlaps
    const close: PresentimentEvent[] = [...spaced, { at: 279, stimulus: 'control' }]
    expect(() => presentimentEpochs(rec, close, plan)).toThrow(code('invalid_plan'))
    const allowed = presentimentEpochs(rec, close, { ...plan, allowOverlap: true })
    expect(allowed.epochs.length).toBe(4)
    expect(allowed.overlapping).toBe(2)
    expect(allowed.warnings.length).toBe(1)
    expect(allowed.warnings[0]).toContain('overlap')
    // duplicate stimulus positions overlap too
    expect(() =>
      presentimentEpochs(
        rec,
        [
          { at: 100, stimulus: 'target' },
          { at: 100, stimulus: 'control' },
        ],
        plan,
      ),
    ).toThrow(code('invalid_plan'))
    // dropped events never count toward overlap
    const edge = presentimentEpochs(
      rec,
      [
        { at: 10, stimulus: 'target' },
        { at: 45, stimulus: 'control' },
      ],
      plan,
    )
    expect(edge.droppedOutOfRange).toBe(1)
    expect(edge.epochs.length).toBe(1)
  })

  test('heavy overlap collapses the null spread of deltaZ (why it is rejected)', () => {
    const sd = (values: number[]) => {
      const m = values.reduce((a, b) => a + b, 0) / values.length
      return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1))
    }
    const disjoint: number[] = []
    const overlapping: number[] = []
    for (let d = 0; d < 60; d++) {
      const rec = nullSeries(1300, 0x9000 + d * 7)
      const events = (step: number): PresentimentEvent[] =>
        Array.from({ length: 20 }, (_, e) => ({
          at: 40 + e * step,
          stimulus: e % 2 === 0 ? 'target' : 'control',
        }))
      const plan = { preWindow: 40, postWindow: 20, allowOverlap: true }
      disjoint.push(
        analyzePresentiment(presentimentEpochs(rec, events(60), plan).epochs).pre.deltaZ,
      )
      overlapping.push(
        analyzePresentiment(presentimentEpochs(rec, events(5), plan).epochs).pre.deltaZ,
      )
    }
    expect(sd(disjoint)).toBeGreaterThan(0.7)
    expect(sd(overlapping)).toBeLessThan(0.35)
  }, 30_000)

  test('label provenance: labels drawn before the pre-window closed are dropped and counted', () => {
    const rec = nullSeries(300, 0x6100)
    const stamped: TrialSeries = {
      ...rec,
      timestamps: Float64Array.from({ length: 300 }, (_, i) => 1_000 + 1_000 * i),
    }
    const plan = { preWindow: 50, postWindow: 20 }
    // pre-window of at = 100 closes at timestamps[99] = 100 000
    const events: PresentimentEvent[] = [
      { at: 100, stimulus: 'target', labelDrawnAt: 100_001 }, // after: kept
      { at: 170, stimulus: 'control', labelDrawnAt: 169_000 }, // equal to the close: dropped
      { at: 240, stimulus: 'target', labelDrawnAt: 50_000 }, // long before: dropped
      { at: 290, stimulus: 'control', labelDrawnAt: 1e9 }, // out of range wins
    ]
    const result = presentimentEpochs(stamped, events, plan)
    expect(result.epochs.length).toBe(1)
    expect(result.droppedProvenance).toBe(2)
    expect(result.droppedOutOfRange).toBe(1)
    expect(result.dropped).toBe(3)
    // an unknown (NaN) close stamp cannot vouch for the order
    const gap = Float64Array.from(stamped.timestamps as Float64Array)
    gap[99] = Number.NaN
    expect(
      presentimentEpochs({ ...stamped, timestamps: gap }, [events[0] as PresentimentEvent], plan)
        .droppedProvenance,
    ).toBe(1)
    // provenance needs timestamps, and a finite draw time
    expect(() => presentimentEpochs(rec, [events[0] as PresentimentEvent], plan)).toThrow(
      code('invalid_plan'),
    )
    expect(() =>
      presentimentEpochs(
        stamped,
        [{ at: 100, stimulus: 'target', labelDrawnAt: Number.NaN }],
        plan,
      ),
    ).toThrow(code('invalid_plan'))
  })

  test('unknown labels and non-integer positions are invalid_plan', () => {
    const rec = nullSeries(200, 0x6200)
    const plan = { preWindow: 10, postWindow: 10 }
    expect(() =>
      presentimentEpochs(rec, [{ at: 50, stimulus: 'Target' as 'target' }], plan),
    ).toThrow(code('invalid_plan'))
    expect(() => presentimentEpochs(rec, [{ at: 50.5, stimulus: 'target' }], plan)).toThrow(
      code('invalid_plan'),
    )
    expect(() =>
      presentimentEpochs({ ...rec, bitsPerTrial: 4 }, [{ at: 50, stimulus: 'target' }], plan),
    ).toThrow(code('invalid_plan'))
    expect(() =>
      presentimentEpochs(rec, [], { ...plan, allowOverlap: 'yes' as unknown as boolean }),
    ).toThrow(code('invalid_plan'))
  })

  test('rejects bad plans', () => {
    const rec = nullSeries(100, 0x5000)
    expect(() => presentimentEpochs(rec, [], { preWindow: 0, postWindow: 10 })).toThrow(PsiError)
    expect(() => presentimentEpochs(rec, [], { preWindow: 10, postWindow: -1 })).toThrow(PsiError)
  })
})
