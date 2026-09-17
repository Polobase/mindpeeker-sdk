import { describe, expect, test } from 'bun:test'
import { NegentropyError } from '../../src/errors.js'
import {
  blockedDevvar,
  blockedNetvar,
  blockingDecomposition,
  blockZ,
} from '../../src/stats/blocked.js'
import { devvar, netvar } from '../../src/stats/network.js'
import { stoufferZ } from '../../src/stats/zscores.js'
import { gaussians } from '../helpers/byte-sources.js'
import { sequentialFixtures as fixtures } from '../helpers/sequential-fixtures.js'

function matrix(sources: number, steps: number, seed: number): Float64Array[] {
  const g = gaussians(sources * steps, seed)
  return Array.from({ length: sources }, (_, i) => g.slice(i * steps, (i + 1) * steps))
}

describe('blockZ', () => {
  test('sums whole blocks, rescales by √T, drops the remainder', () => {
    const out = blockZ([1, 2, 3, 4, 5, 6, 7], 3)
    expect(out.length).toBe(2)
    expect(out[0]).toBeCloseTo(6 / Math.sqrt(3), 14)
    expect(out[1]).toBeCloseTo(15 / Math.sqrt(3), 14)
    expect([...blockZ([0.5, -1], 1)]).toEqual([0.5, -1])
  })

  test('validation', () => {
    expect(() => blockZ([1, 2], 0)).toThrow(NegentropyError)
    expect(() => blockZ([1, 2], 1.5)).toThrow(NegentropyError)
    expect(() => blockZ([1, 2], 3)).toThrow(NegentropyError)
    expect(() => blockZ([1, Number.NaN], 1)).toThrow(NegentropyError)
  })
})

describe('blockedNetvar / blockedDevvar', () => {
  const names = ['a', 'b', 'c', 'd']

  test('T = 1 reproduces netvar and devvar bit for bit', () => {
    const z = matrix(4, 301, 0x71)
    const nv = blockedNetvar(z, names, { T: 1 })
    const dv = blockedDevvar(z, names, { T: 1 })
    expect(nv.statistic).toBe(netvar(z, names).statistic)
    expect(nv.pValue).toBe(netvar(z, names).pValue)
    expect(dv.statistic).toBe(devvar(z, names).statistic)
    expect(dv.df).toBe(devvar(z, names).df)
    expect(nv.droppedSteps).toBe(0)
  })

  test('explicit eq. 4.1 blocks (all sources for netvar, one source for devvar)', () => {
    const z = matrix(4, 125, 0x72)
    const T = 12
    const blocks = 10
    let nvExpected = 0
    let dvExpected = 0
    for (let b = 0; b < blocks; b++) {
      let all = 0
      for (let i = 0; i < 4; i++) {
        let one = 0
        for (let t = b * T; t < (b + 1) * T; t++) one += (z[i] as Float64Array)[t] as number
        dvExpected += (one / Math.sqrt(T)) ** 2
        all += one
      }
      nvExpected += (all / Math.sqrt(T * 4)) ** 2
    }
    const nv = blockedNetvar(z, names, { T })
    const dv = blockedDevvar(z, names, { T })
    expect(nv.statistic).toBeCloseTo(nvExpected, 10)
    expect(dv.statistic).toBeCloseTo(dvExpected, 10)
    expect(nv).toMatchObject({ df: blocks, blocks, T, n: 120, droppedSteps: 5 })
    expect(dv).toMatchObject({ df: blocks * 4, blocks, T, n: 120, droppedSteps: 5 })
  })

  test('H0 calibration at T = 60: χ²(blocks) mean and a uniform-ish p', () => {
    const reps = 400
    let sum = 0
    let small = 0
    for (let r = 0; r < reps; r++) {
      const result = blockedNetvar(matrix(3, 600, 0x900 + r), ['a', 'b', 'c'], { T: 60 })
      sum += result.statistic
      if (result.pValue < 0.1) small++
    }
    // χ²(10): mean 10, sd √20 → mean over reps within 4·√(20/reps)
    expect(Math.abs(sum / reps - 10)).toBeLessThan(4 * Math.sqrt(20 / reps))
    expect(Math.abs(small / reps - 0.1)).toBeLessThan(4 * Math.sqrt(0.09 / reps))
  })

  test('validation', () => {
    const z = matrix(2, 10, 0x73)
    expect(() => blockedNetvar(z, ['a', 'b'], { T: 11 })).toThrow(NegentropyError)
    expect(() => blockedDevvar(z, ['a', 'b'], { T: 0 })).toThrow(NegentropyError)
    expect(() => blockedNetvar(z, ['a'], { T: 2 })).toThrow(NegentropyError)
  })
})

describe('blockingDecomposition (Bancel & Nelson 2008, eqs. 4.4–4.6)', () => {
  test('matches an independent numpy/scipy computation', () => {
    const ref = fixtures.blocking
    const series = fixtures.series.ar.slice(0, ref.steps)
    const result = blockingDecomposition(
      series,
      ref.points.map((p) => p.T),
    )
    expect(result.steps).toBe(ref.steps)
    expect(result.z0).toBeCloseTo(ref.z0, 10)
    for (let i = 0; i < ref.points.length; i++) {
      const got = result.points[i]
      const want = ref.points[i]
      if (!got || !want) throw new Error('missing point')
      expect(got.T).toBe(want.T)
      expect(got.blocks).toBe(want.blocks)
      expect(got.statistic).toBeCloseTo(want.statistic, 9)
      expect(Math.abs(got.pValue - want.pValue)).toBeLessThan(1e-12 + 1e-10 * want.pValue)
      expect(got.z).toBeCloseTo(want.z, 9)
      expect(got.expected).toBeCloseTo(want.expected, 10)
      expect(got.autocorrelationTerm).toBeCloseTo(want.autocorrelationTerm, 10)
      expect(got.predicted).toBeCloseTo(want.expected + want.autocorrelationTerm, 10)
      expect(got.residualSd).toBeCloseTo(Math.sqrt(1 - 1 / want.T), 14)
    }
  })

  test('under H0 z_T − z₀/√T has mean 0 and sd ≈ √(1 − 1/T)', () => {
    const reps = 600
    const steps = 1800
    const Ts = [10, 30]
    const residuals = Ts.map(() => [] as number[])
    const g = gaussians(reps * steps, 0xdec)
    for (let r = 0; r < reps; r++) {
      const result = blockingDecomposition(g.subarray(r * steps, (r + 1) * steps), Ts)
      result.points.forEach((point, i) => {
        residuals[i]?.push(point.z - point.expected)
      })
    }
    Ts.forEach((T, i) => {
      const values = residuals[i] as number[]
      const mean = values.reduce((s, v) => s + v, 0) / reps
      const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (reps - 1))
      expect(Math.abs(mean)).toBeLessThan(4 * Math.sqrt((1 - 1 / T) / reps) + 0.05)
      expect(Math.abs(sd / Math.sqrt(1 - 1 / T) - 1)).toBeLessThan(0.12)
    })
  }, 30_000)

  test('a pure 1-step variance excess decays as 1/√T; autocorrelation does not', () => {
    const steps = 360_000
    const g = gaussians(steps, 0xa11)
    const excess = g.map((v) => v * Math.sqrt(1.03)) // no temporal structure
    const flat = blockingDecomposition(excess, [1, 10, 100])
    for (const point of flat.points) {
      expect(Math.abs(point.z - point.expected)).toBeLessThan(3 * point.residualSd + 0.2)
    }
    // AR(1) with ρ = 0.1 and unit marginal variance: the blocked z explodes, and eq. 4.6 predicts it
    const ar = new Float64Array(steps)
    const phi = 0.1
    ar[0] = g[0] as number
    for (let t = 1; t < steps; t++)
      ar[t] = phi * (ar[t - 1] as number) + Math.sqrt(1 - phi * phi) * (g[t] as number)
    const correlated = blockingDecomposition(ar, [10, 100])
    for (const point of correlated.points) {
      expect(point.z - point.expected).toBeGreaterThan(4)
      expect(Math.abs(point.z - point.predicted)).toBeLessThan(0.25 * Math.abs(point.z) + 1)
    }
  }, 30_000)

  test('the Stouffer series input is what blockedNetvar blocks internally', () => {
    const names = ['a', 'b', 'c']
    const z = matrix(3, 240, 0x74)
    const stouffers = Float64Array.from({ length: 240 }, (_, t) =>
      stoufferZ(z.map((col) => col[t] as number)),
    )
    const decomposition = blockingDecomposition(stouffers, [8])
    expect(decomposition.points[0]?.statistic).toBeCloseTo(
      blockedNetvar(z, names, { T: 8 }).statistic,
      10,
    )
  })

  test('validation', () => {
    expect(() => blockingDecomposition([1], [1])).toThrow(NegentropyError)
    expect(() => blockingDecomposition([1, 2, 3], [])).toThrow(NegentropyError)
    expect(() => blockingDecomposition([1, 2, 3], [4])).toThrow(NegentropyError)
    expect(() => blockingDecomposition([1, Number.NaN, 3], [1])).toThrow(NegentropyError)
  })
})
