import { describe, expect, test } from 'bun:test'
import { NegentropyError } from '../../src/errors.js'
import { cumulativeDeviation, significanceEnvelope } from '../../src/stats/cumdev.js'
import { gaussians } from '../helpers/byte-sources.js'

describe('cumulativeDeviation', () => {
  test('constant z=0 gives D(t) = −t', () => {
    const d = cumulativeDeviation(new Float64Array(100))
    expect(d[0]).toBe(-1)
    expect(d[99]).toBe(-100)
  })

  test('constant z=1 gives D(t) = 0', () => {
    const d = cumulativeDeviation(new Float64Array(50).fill(1))
    for (const value of d) expect(value).toBe(0)
  })

  test('stays near zero under H0', () => {
    const steps = 2000
    const d = cumulativeDeviation(gaussians(steps, 0xd1))
    // Var(D(T)) = 2T → |D(T)| within 4√(2T) for a fixed healthy seed
    expect(Math.abs(d[steps - 1] as number)).toBeLessThan(4 * Math.sqrt(2 * steps))
  })
})

describe('significanceEnvelope', () => {
  test('known answers from chi-square quantiles', () => {
    const env = significanceEnvelope(10)
    expect(env[0]).toBeCloseTo(3.841458820694124 - 1, 9)
    expect(env[9]).toBeCloseTo(18.307038053275146 - 10, 9)
  })

  test('grows like the parabola z·√(2t) for large t', () => {
    const env = significanceEnvelope(10_000)
    const t = 10_000
    const asymptote = 1.6448536269514722 * Math.sqrt(2 * t)
    expect(Math.abs((env[t - 1] as number) / asymptote - 1)).toBeLessThan(0.05)
  })

  test('pointwise level holds at a pre-registered endpoint', () => {
    const steps = 400
    const reps = 600
    const env = significanceEnvelope(steps)
    const bound = env[steps - 1] as number
    const all = gaussians(reps * steps, 0xe0)
    let exceed = 0
    for (let rep = 0; rep < reps; rep++) {
      const d = cumulativeDeviation(all.slice(rep * steps, (rep + 1) * steps))
      if ((d[steps - 1] as number) > bound) exceed++
    }
    const rate = exceed / reps
    // 0.05 ± 4√(0.05·0.95/600) ≈ 0.05 ± 0.036
    expect(rate).toBeGreaterThan(0.014)
    expect(rate).toBeLessThan(0.086)
  })

  test('crossing ANYWHERE is far more likely than the pointwise level (the pre-registration caveat)', () => {
    const steps = 400
    const reps = 300
    const env = significanceEnvelope(steps)
    const all = gaussians(reps * steps, 0xf1)
    let crossed = 0
    for (let rep = 0; rep < reps; rep++) {
      const d = cumulativeDeviation(all.slice(rep * steps, (rep + 1) * steps))
      for (let t = 0; t < steps; t++) {
        if ((d[t] as number) > (env[t] as number)) {
          crossed++
          break
        }
      }
    }
    expect(crossed / reps).toBeGreaterThan(0.15)
  })

  test('rejects bad parameters', () => {
    expect(() => significanceEnvelope(0)).toThrow(NegentropyError)
    expect(() => significanceEnvelope(10, 0)).toThrow(NegentropyError)
    expect(() => significanceEnvelope(10, 1)).toThrow(NegentropyError)
  })
})
