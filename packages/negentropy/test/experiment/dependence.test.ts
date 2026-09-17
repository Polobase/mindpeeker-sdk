import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WindowedEvent } from '../../src/experiment/dependence.js'
import { eventCorrelations, sharedSteps } from '../../src/experiment/dependence.js'
import type { EventStatistic } from '../../src/experiment/types.js'

/** test/fixtures/covar-dependence.json (scripts/fixtures/covar_dependence.py). */
interface CovarDependenceFixture {
  bitsPerTrial: number
  /** Exact per-step covariances, keyed 'a|b', as [numerator, denominator]. */
  moments: { n: number; covariance: Record<string, [number, number]> }[]
  counts: number[]
  events: WindowedEvent[]
  correlation: number[][]
}

const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'fixtures', 'covar-dependence.json'), 'utf8'),
) as CovarDependenceFixture

const STATISTICS: readonly EventStatistic[] = ['netvar', 'devvar', 'correlation', 'covar']

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

  test('covar: moments match exact enumeration of Binomial(8, ½) sources (n = 1…4)', () => {
    // A two-event design on ONE step with n present sources gives
    // ρ = Cov(a, b) / √(Var a · Var b) for that n — compared against the exact
    // enumerated moments (Fractions over every outcome), not a closed form.
    const kappa = -2 / fixture.bitsPerTrial
    for (const { n, covariance } of fixture.moments) {
      const moment = (a: EventStatistic, b: EventStatistic) => {
        const [num, den] = covariance[`${a}|${b}`] as [number, number]
        return num / den
      }
      for (const a of STATISTICS) {
        for (const b of STATISTICS) {
          const r = eventCorrelations(
            [
              { statistic: a, start: 0, end: 1 },
              { statistic: b, start: 0, end: 1 },
            ],
            Uint32Array.of(n),
            kappa,
          )
          const scale = Math.sqrt(moment(a, a) * moment(b, b))
          const expected = scale > 0 ? moment(a, b) / scale : 0
          expect(r[0]?.[1] as number).toBeCloseTo(expected, 13)
        }
      }
      // Var C = v²·n(n − 1)/2 with v = 2 − 2/k: covar's own null variance
      expect(moment('covar', 'covar')).toBeCloseTo((2 + kappa) ** 2 * ((n * (n - 1)) / 2), 14)
    }
  })

  test('covar: a mixed design with varying presence matches the enumerated-moment matrix', () => {
    const counts = Uint32Array.from(fixture.counts)
    const r = eventCorrelations(fixture.events, counts, -2 / fixture.bitsPerTrial)
    fixture.correlation.forEach((row, i) => {
      row.forEach((expected, j) => {
        expect(r[i]?.[j] as number).toBeCloseTo(expected, 12)
      })
    })
    // covar is uncorrelated with netvar/devvar/correlation even on shared steps
    expect(r[0]?.[2]).toBe(0)
    expect(r[0]?.[4]).toBe(0)
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
