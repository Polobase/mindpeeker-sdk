import { describe, expect, test } from 'bun:test'
import { trialsFromBytes } from '@mindpeeker/negentropy'
import { PsiError } from '../../src/errors.js'
import {
  analyzePresentiment,
  type PresentimentEpoch,
  presentimentEpochs,
} from '../../src/protocol/presentiment.js'
import type { Stimulus, TrialSeries } from '../../src/types.js'
import { prngBytes } from '../helpers/trial-sources.js'

const BITS = 200

/** A TrialSeries of `n` null trials (Binomial(200, ½)) from seeded bytes. */
function nullSeries(n: number, seed: number): TrialSeries {
  return trialsFromBytes(prngBytes(n * 25, seed), 'reg', { bitsPerTrial: BITS })
}

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

  test('validation', () => {
    expect(() => analyzePresentiment([])).toThrow(PsiError)
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

  test('rejects bad plans', () => {
    const rec = nullSeries(100, 0x5000)
    expect(() => presentimentEpochs(rec, [], { preWindow: 0, postWindow: 10 })).toThrow(PsiError)
    expect(() => presentimentEpochs(rec, [], { preWindow: 10, postWindow: -1 })).toThrow(PsiError)
  })
})
