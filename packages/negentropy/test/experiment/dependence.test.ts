import { describe, expect, test } from 'bun:test'
import type { WindowedEvent } from '../../src/experiment/dependence.js'
import { eventCorrelations, sharedSteps } from '../../src/experiment/dependence.js'

describe('eventCorrelations', () => {
  test('matches an independent Python closed form, itself confirmed by Monte Carlo', () => {
    // 3 sources × 300 steps, Binomial(200, ½) trials (κ = −2/200), source 3 absent
    // on steps 120..159. Reference: a numpy re-implementation of the per-step
    // moment formulas; 3 × 60 000-replication simulations of the actual
    // statistics agreed with it to ≤ 0.008 (SE ≈ 0.004).
    const counts = new Uint32Array(300).fill(3)
    counts.fill(2, 120, 160)
    const events: WindowedEvent[] = [
      { statistic: 'netvar', start: 0, end: 200 },
      { statistic: 'netvar', start: 100, end: 300 },
      { statistic: 'devvar', start: 100, end: 300 },
      { statistic: 'correlation', start: 100, end: 300 },
      { statistic: 'devvar', start: 150, end: 250 },
    ]
    const reference = [
      [1.0, 0.4999165136082817, 0.29833279552412867, 0.35114523852328555, 0.2072841125699453],
      [0.4999165136082817, 1.0, 0.5966655910482574, 0.7900767866773926, 0.41456822513989067],
      [0.29833279552412867, 0.5966655910482574, 1.0, 0.0, 0.7196229171289241],
      [0.35114523852328555, 0.7900767866773926, 0.0, 1.0, 0.0],
      [0.2072841125699453, 0.41456822513989067, 0.7196229171289241, 0.0, 1.0],
    ]
    const r = eventCorrelations(events, counts, -2 / 200)
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        expect(r[i]?.[j] as number).toBeCloseTo(reference[i]?.[j] as number, 12)
      }
    }
  })

  test('textbook cases: O/√(AB) for netvar pairs, 1/√N for netvar–devvar, disjoint → 0', () => {
    const counts = new Uint32Array(400).fill(5)
    const r = eventCorrelations(
      [
        { statistic: 'netvar', start: 0, end: 100 },
        { statistic: 'netvar', start: 50, end: 250 },
        { statistic: 'devvar', start: 0, end: 100 },
        { statistic: 'netvar', start: 300, end: 400 },
      ],
      counts,
      0, // Gaussian z's
    )
    expect(r[0]?.[1] as number).toBeCloseTo(50 / Math.sqrt(100 * 200), 14)
    expect(r[0]?.[2] as number).toBeCloseTo(1 / Math.sqrt(5), 14)
    expect(r[0]?.[3]).toBe(0)
    expect(r[3]?.[3]).toBe(1)
  })

  test('sharedSteps', () => {
    expect(
      sharedSteps(
        { statistic: 'netvar', start: 0, end: 10 },
        { statistic: 'devvar', start: 5, end: 20 },
      ),
    ).toBe(5)
    expect(
      sharedSteps(
        { statistic: 'netvar', start: 0, end: 10 },
        { statistic: 'netvar', start: 10, end: 20 },
      ),
    ).toBe(0)
  })
})
