import { describe, expect, test } from 'bun:test'
import { NegentropyError } from '../../src/errors.js'
import { devvar, interSourceCorrelation, netvar } from '../../src/stats/network.js'
import { stoufferZ } from '../../src/stats/zscores.js'
import { gaussians } from '../helpers/byte-sources.js'

const SOURCES = ['a', 'b', 'c', 'd', 'e']

/**
 * N×T matrix of iid standard normals. Sliced from ONE stream — xorshift32 is
 * F2-linear, so streams from related seeds are cross-correlated; disjoint
 * segments of a single stream are not.
 */
function nullMatrix(n: number, steps: number, seed: number): Float64Array[] {
  const all = gaussians(n * steps, seed)
  return Array.from({ length: n }, (_, i) => all.slice(i * steps, (i + 1) * steps))
}

/** Common-signal alternative: zᵢ = √(1−r)·εᵢ + √r·c(t) — unit variance, cross-correlated. */
function correlatedMatrix(n: number, steps: number, r: number, seed: number): Float64Array[] {
  const all = gaussians((n + 1) * steps, seed)
  const common = all.slice(n * steps)
  return Array.from({ length: n }, (_, i) => {
    const out = new Float64Array(steps)
    for (let t = 0; t < steps; t++) {
      out[t] =
        Math.sqrt(1 - r) * (all[i * steps + t] as number) + Math.sqrt(r) * (common[t] as number)
    }
    return out
  })
}

describe('null behavior', () => {
  test('netvar ≈ df and devvar ≈ df on iid normals', () => {
    const steps = 4000
    const zs = nullMatrix(5, steps, 0x11)
    const nv = netvar(zs, SOURCES)
    expect(nv.df).toBe(steps)
    expect(Math.abs(nv.statistic / steps - 1)).toBeLessThan(4 * Math.sqrt(2 / steps))
    expect(nv.pValue).toBeGreaterThan(0.001)
    const dv = devvar(zs, SOURCES)
    expect(dv.df).toBe(5 * steps)
    expect(Math.abs(dv.statistic / dv.df - 1)).toBeLessThan(4 * Math.sqrt(2 / dv.df))
    expect(dv.pValue).toBeGreaterThan(0.001)
  })

  test('p-values are roughly uniform over replications', () => {
    const reps = 200
    const steps = 200
    const all = gaussians(reps * 3 * steps, 0x1001)
    const ps: number[] = []
    for (let rep = 0; rep < reps; rep++) {
      const base = rep * 3 * steps
      const zs = [0, 1, 2].map((i) => all.slice(base + i * steps, base + (i + 1) * steps))
      ps.push(netvar(zs, ['a', 'b', 'c']).pValue)
    }
    const mean = ps.reduce((a, b) => a + b, 0) / reps
    const below = ps.filter((p) => p < 0.05).length / reps
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.1)
    expect(below).toBeLessThan(0.13)
  })

  test('correlation statistic is ~N(0,1) under H0', () => {
    const zs = nullMatrix(5, 5000, 0x22)
    const result = interSourceCorrelation(zs, SOURCES)
    expect(Math.abs(result.statistic)).toBeLessThan(4)
    expect(result.pairs.length).toBe(10)
    for (const pair of result.pairs) expect(Math.abs(pair.r)).toBeLessThan(0.1)
  })
})

describe('alternatives', () => {
  test('common signal (r=0.1): netvar and correlation fire, devvar stays null', () => {
    const steps = 5000
    const zs = correlatedMatrix(5, steps, 0.1, 0x33)
    const nv = netvar(zs, SOURCES)
    // Var(Z_s) = 1 + r(N−1) = 1.4 → statistic ≈ 1.4·T, z ≈ 20
    expect(nv.statistic / steps).toBeGreaterThan(1.2)
    expect(nv.pValue).toBeLessThan(1e-10)
    const corr = interSourceCorrelation(zs, SOURCES)
    expect(corr.statistic).toBeGreaterThan(10)
    expect(corr.pValue).toBeLessThan(1e-10)
    const dv = devvar(zs, SOURCES)
    expect(dv.pValue).toBeGreaterThan(0.01) // unit variances — nothing to see
  })

  test('mean shift (+0.2 on every source): all three fire', () => {
    const steps = 5000
    const zs = nullMatrix(5, steps, 0x44).map((arr) => {
      const out = new Float64Array(arr.length)
      for (let t = 0; t < arr.length; t++) out[t] = (arr[t] as number) + 0.2
      return out
    })
    expect(netvar(zs, SOURCES).pValue).toBeLessThan(1e-6)
    expect(devvar(zs, SOURCES).pValue).toBeLessThan(1e-3)
    expect(interSourceCorrelation(zs, SOURCES).pValue).toBeLessThan(1e-6)
  })
})

describe('structure', () => {
  test('per-step identity: Z_s² = (Σz² + 2S)/N', () => {
    const zs = nullMatrix(4, 50, 0x55)
    for (let t = 0; t < 50; t++) {
      const column = zs.map((arr) => arr[t] as number)
      const zSquared = stoufferZ(column) ** 2
      const sumSq = column.reduce((a, z) => a + z * z, 0)
      const sum = column.reduce((a, z) => a + z, 0)
      const s = (sum * sum - sumSq) / 2
      expect(zSquared).toBeCloseTo((sumSq + 2 * s) / 4, 10)
    }
  })

  test('shape validation', () => {
    expect(() => netvar([], [])).toThrow(NegentropyError)
    expect(() => netvar([new Float64Array(3), new Float64Array(4)], ['a', 'b'])).toThrow(
      NegentropyError,
    )
    expect(() => netvar([new Float64Array(0)], ['a'])).toThrow(NegentropyError)
    expect(() => interSourceCorrelation([new Float64Array(5)], ['a'])).toThrow(NegentropyError)
  })

  test('honest attribution', () => {
    const result = netvar(nullMatrix(2, 10, 0x66), ['anu', 'drand'])
    expect(result.sources).toEqual(['anu', 'drand'])
    expect(result.n).toBe(10)
  })
})
