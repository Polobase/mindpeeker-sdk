import { describe, expect, test } from 'bun:test'
import { NegentropyError } from '../../src/errors.js'
import { POPCOUNT } from '../../src/internal/bytes.js'
import { driftBoundary, driftLogM, driftMartingale } from '../../src/stats/drift-martingale.js'
import { villeCrossing } from '../../src/stats/eprocess.js'
import { gaussians, prngBytes } from '../helpers/byte-sources.js'
import { sequentialFixtures as fixtures } from '../helpers/sequential-fixtures.js'

type Side = 'two' | 'upper'

function relClose(actual: number, expected: number, rel: number, abs = 0): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.max(abs, rel * Math.abs(expected)))
}

function simpson(f: (x: number) => number, lo: number, hi: number, panels: number): number {
  const h = (hi - lo) / panels
  let sum = f(lo) + f(hi)
  for (let i = 1; i < panels; i++) sum += (i % 2 === 1 ? 4 : 2) * f(lo + i * h)
  return (sum * h) / 3
}

describe('driftLogM against 40-digit mpmath', () => {
  test('two-sided and half-normal closed forms, including the far lower tail', () => {
    for (const c of fixtures.drift.logM) {
      const value = driftLogM(c.t, c.sum, { lambda: c.lambda, sided: c.sided })
      relClose(value, c.logM, 1e-12, 1e-12)
    }
  })

  test('the stream form equals the point form', () => {
    const z = gaussians(400, 0x31).map((v) => v + 0.1)
    for (const sided of ['two', 'upper'] as const) {
      const path = driftMartingale(z, { lambda: 50, sided })
      let sum = 0
      for (let t = 0; t < z.length; t++) {
        sum += z[t] as number
        relClose(path[t] as number, driftLogM(t + 1, sum, { lambda: 50, sided }), 1e-12, 1e-12)
      }
    }
  })
})

describe('martingale property by exact integration', () => {
  // S_t ~ N(0, t) under H0; M_t·φ is a N(0, t(t+λ)/λ) density (two-sided) — integrate the
  // implementation over ±40 of its standard deviations
  for (const t of [1, 3, 25]) {
    for (const lambda of [0.5, 10]) {
      test(`t=${t}, λ=${lambda}: E[M_t] = 1 for both sides`, () => {
        const sd = Math.sqrt((t * (t + lambda)) / lambda)
        for (const sided of ['two', 'upper'] as const) {
          const integrand = (s: number): number =>
            Math.exp(
              driftLogM(t, s, { lambda, sided }) -
                (s * s) / (2 * t) -
                0.5 * Math.log(2 * Math.PI * t),
            )
          expect(Math.abs(simpson(integrand, -40 * sd, 40 * sd, 40_000) - 1)).toBeLessThan(1e-10)
        }
      })
    }
  }

  test('Binomial(8, ½) trials: E[M_1], E[M_2] ≤ 1 (sub-Gaussian supermartingale)', () => {
    const weights = [1, 8, 28, 56, 70, 56, 28, 8, 1].map((c) => c / 256)
    const zs = weights.map((_, j) => (j - 4) / Math.SQRT2)
    for (const lambda of [0.1, 1, 30]) {
      for (const sided of ['two', 'upper'] as const) {
        let one = 0
        let two = 0
        for (let i = 0; i <= 8; i++) {
          const wi = weights[i] as number
          one += wi * Math.exp(driftLogM(1, zs[i] as number, { lambda, sided }))
          for (let j = 0; j <= 8; j++) {
            const s = (zs[i] as number) + (zs[j] as number)
            two += wi * (weights[j] as number) * Math.exp(driftLogM(2, s, { lambda, sided }))
          }
        }
        expect(one).toBeLessThanOrEqual(1)
        expect(two).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('driftBoundary', () => {
  test('matches the Robbins closed form and the mpmath half-normal root', () => {
    for (const c of fixtures.drift.boundary) {
      relClose(driftBoundary(c.t, c.alpha, c.lambda), c.two, 1e-13)
      const upper = driftBoundary(c.t, c.alpha, c.lambda, 'upper')
      relClose(upper, c.upper, 1e-11, 1e-11)
      // one-sided lies between the two-sided boundaries at 2α and α
      expect(upper).toBeLessThanOrEqual(c.two)
      expect(upper).toBeGreaterThanOrEqual(driftBoundary(c.t, 2 * c.alpha, c.lambda) - 1e-9)
    }
  })

  test('crossing the boundary is exactly the Ville crossing of the martingale', () => {
    const z = gaussians(3000, 0x41).map((v) => v + 0.08)
    for (const sided of ['two', 'upper'] as const) {
      let first = -1
      let sum = 0
      for (let t = 0; t < z.length && first < 0; t++) {
        sum += z[t] as number
        const bound = driftBoundary(t + 1, 0.01, 200, sided)
        if ((sided === 'two' ? Math.abs(sum) : sum) >= bound) first = t
      }
      expect(first).toBeGreaterThan(0)
      expect(villeCrossing(driftMartingale(z, { lambda: 200, sided }), 0.01)).toBe(first)
    }
  })

  test('type-I error ≤ α over 3000-step paths; the 1.96√t parabola is crossed far more often', () => {
    const steps = 3000
    const reps = 1000
    const alpha = 0.05
    const lambda = 100
    const band = alpha + 3 * Math.sqrt((alpha * (1 - alpha)) / reps)
    const two = new Float64Array(steps)
    const upper = new Float64Array(steps)
    for (let t = 1; t <= steps; t++) {
      two[t - 1] = driftBoundary(t, alpha, lambda)
      upper[t - 1] = driftBoundary(t, alpha, lambda, 'upper')
    }
    const gauss = gaussians(steps * reps, 0x7a11)
    const bytes = prngBytes(steps * reps, 0x7a12)
    let crossedTwo = 0
    let crossedLattice = 0
    let crossedParabola = 0
    for (let r = 0; r < reps; r++) {
      let s = 0
      let sLattice = 0
      let hitTwo = false
      let hitLattice = false
      let hitParabola = false
      for (let t = 0; t < steps; t++) {
        s += gauss[r * steps + t] as number
        sLattice += ((POPCOUNT[bytes[r * steps + t] as number] as number) - 4) / Math.SQRT2
        if (Math.abs(s) >= (two[t] as number)) hitTwo = true
        if (sLattice >= (upper[t] as number)) hitLattice = true
        if (Math.abs(s) >= 1.959963984540054 * Math.sqrt(t + 1)) hitParabola = true
      }
      crossedTwo += hitTwo ? 1 : 0
      crossedLattice += hitLattice ? 1 : 0
      crossedParabola += hitParabola ? 1 : 0
    }
    expect(crossedTwo / reps).toBeLessThanOrEqual(band)
    expect(crossedLattice / reps).toBeLessThanOrEqual(band)
    expect(crossedTwo / reps).toBeGreaterThan(0.005)
    expect(crossedParabola / reps).toBeGreaterThan(0.3)
  }, 30_000)
})

describe('validation', () => {
  test('lambda is required and every argument is checked', () => {
    const bad: Array<() => unknown> = [
      () => driftMartingale([1], undefined as unknown as { lambda: number }),
      () => driftMartingale([1], { lambda: 0 }),
      () => driftMartingale([Number.POSITIVE_INFINITY], { lambda: 1 }),
      () => driftLogM(-1, 0, { lambda: 1 }),
      () => driftLogM(1, Number.NaN, { lambda: 1 }),
      () => driftLogM(1, 0, { lambda: 1, sided: 'lower' as Side }),
      () => driftBoundary(1, 0, 1),
      () => driftBoundary(1, 0.05, -1),
      () => driftBoundary(1, 0.05, 1, 'both' as Side),
    ]
    for (const call of bad) {
      expect(call).toThrow(NegentropyError)
      try {
        call()
      } catch (error) {
        expect((error as NegentropyError).code).toBe('invalid_config')
      }
    }
  })
})
