import { describe, expect, test } from 'bun:test'
import { NegentropyError } from '../../src/errors.js'
import { betaInc } from '../../src/internal/beta.js'
import { POPCOUNT } from '../../src/internal/bytes.js'
import { lnGammaP } from '../../src/internal/log-tails.js'
import { lnGamma } from '../../src/internal/special.js'
import { cumulativeDeviation, significanceEnvelope } from '../../src/stats/cumdev.js'
import { anytimeP, villeCrossing } from '../../src/stats/eprocess.js'
import {
  anytimeEnvelope,
  netvarBoundary,
  netvarLogM,
  netvarMartingale,
} from '../../src/stats/netvar-martingale.js'
import { gaussians, prngBytes } from '../helpers/byte-sources.js'
import { sequentialFixtures as fixtures } from '../helpers/sequential-fixtures.js'

type Side = 'two' | 'upper'

function relClose(actual: number, expected: number, rel: number, abs = 0): void {
  const tolerance = Math.max(abs, rel * Math.abs(expected))
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance)
}

/** Composite Simpson rule on [lo, hi] with an even number of panels. */
function simpson(f: (x: number) => number, lo: number, hi: number, panels: number): number {
  const h = (hi - lo) / panels
  let sum = f(lo) + f(hi)
  for (let i = 1; i < panels; i++) sum += (i % 2 === 1 ? 4 : 2) * f(lo + i * h)
  return (sum * h) / 3
}

describe('netvarLogM against 40-digit mpmath', () => {
  test('two-sided and upper closed forms over t = 1 … 10⁶', () => {
    for (const c of fixtures.netvarLogM) {
      const value = netvarLogM(c.t, c.deviation, { a: c.a, b: c.b, sided: c.sided })
      // relative 1e-11, or absolute 1e-10 near zero (D is itself rounded); a degenerate
      // S = 0 'upper' value cancels two terms of size ~t·ln t, which costs ~ε·t·ln t
      relClose(value, c.logM, 1e-11, 1e-10 + 20 * Number.EPSILON * c.t * Math.log(c.t + 1))
    }
  })

  test('ln M₀ = 0 and the stream form equals the point form bit for bit', () => {
    expect(netvarLogM(0, 0)).toBeCloseTo(0, 14)
    expect(netvarLogM(0, 0, { sided: 'upper', a: 3, b: 0.5 })).toBeCloseTo(0, 14)
    const z = gaussians(500, 0x11)
    for (const sided of ['two', 'upper'] as const) {
      const path = netvarMartingale(z, { sided, a: 2, b: 3 })
      const deviation = cumulativeDeviation(z)
      for (let t = 0; t < z.length; t += 37) {
        expect(path[t]).toBe(netvarLogM(t + 1, deviation[t] as number, { sided, a: 2, b: 3 }))
      }
    }
  })

  test('stays finite on a degenerate all-zero stream (log-space incomplete gamma)', () => {
    const path = netvarMartingale(new Float64Array(100_000), { sided: 'upper' })
    for (const value of [path[0], path[999], path[99_999]]) {
      expect(Number.isFinite(value as number)).toBe(true)
    }
    // M_t(S = 0) = E[τ^{t/2} | τ < 1] ≈ e⁻¹/((t/2 + 1)·P(1, 1)) for large t
    const t = 100_000
    const expected = -1 - Math.log(t / 2 + 1) - Math.log(1 - Math.exp(-1))
    relClose(path[t - 1] as number, expected, 1e-4)
  })
})

describe('martingale property by exact integration', () => {
  // E[M_t] = ∫ M_t(S) f_{χ²_t}(S) dS = 1. The bulk S ≤ 10⁴ is integrated
  // numerically from the implementation (Simpson in y = ln S); beyond it the
  // integrand is exactly a Beta(t/2, a) tail in w = (S/2)/(b + S/2).
  const S_MAX = 1e4
  for (const [a, b] of [
    [1, 1],
    [0.5, 2],
    [3, 0.5],
  ] as const) {
    for (const t of [1, 2, 5, 20]) {
      test(`a=${a}, b=${b}, t=${t}: two-sided and upper both integrate to 1`, () => {
        const lnChi2 = (s: number): number =>
          (t / 2 - 1) * Math.log(s) - s / 2 - (t / 2) * Math.LN2 - lnGamma(t / 2)
        const wMax = S_MAX / 2 / (b + S_MAX / 2)
        const betaTail = 1 - betaInc(t / 2, a, wMax)
        for (const sided of ['two', 'upper'] as const) {
          const integrand = (y: number): number => {
            const s = Math.exp(y)
            return Math.exp(netvarLogM(t, s - t, { a, b, sided }) + lnChi2(s) + y)
          }
          const bulk = simpson(integrand, -80, Math.log(S_MAX), 40_000)
          // P(a + t/2, b + S/2) = 1 − O(e⁻⁴⁰⁰⁰) beyond S_MAX
          const tail = sided === 'two' ? betaTail : betaTail / Math.exp(lnGammaP(a, b))
          expect(Math.abs(bulk + tail - 1)).toBeLessThan(1e-8)
        }
      })
    }
  }
})

describe('Binomial(k, ½) trials: exact expectations by enumeration', () => {
  // theoretical z of an 8-bit trial: (popcount − 4)/√2, P(j) = C(8, j)/256
  const K = 8
  const weights = [1, 8, 28, 56, 70, 56, 28, 8, 1].map((c) => c / 256)
  const zs = weights.map((_, j) => (j - K / 2) / Math.sqrt(K / 4))

  function expectation(t: 1 | 2, opts: { a?: number; b?: number; sided?: Side }): number {
    let total = 0
    for (let i = 0; i <= K; i++) {
      if (t === 1) {
        const s = (zs[i] as number) ** 2
        total += (weights[i] as number) * Math.exp(netvarLogM(1, s - 1, opts))
        continue
      }
      for (let j = 0; j <= K; j++) {
        const s = (zs[i] as number) ** 2 + (zs[j] as number) ** 2
        total +=
          (weights[i] as number) * (weights[j] as number) * Math.exp(netvarLogM(2, s - 2, opts))
      }
    }
    return total
  }

  test("'upper' is a supermartingale for lattice trials (sub-Gaussian z)", () => {
    for (const prior of [
      { a: 1, b: 1 },
      { a: 0.5, b: 2 },
      { a: 20, b: 20 },
    ]) {
      expect(expectation(1, { ...prior, sided: 'upper' })).toBeLessThanOrEqual(1)
      expect(expectation(2, { ...prior, sided: 'upper' })).toBeLessThanOrEqual(1)
    }
  })

  test('two-sided is only a de Moivre–Laplace approximation there (documented caveat)', () => {
    // a prior on large precisions τ weights the atom at z = 0 (P = 70/256)
    expect(expectation(1, { a: 200, b: 10 })).toBeGreaterThan(1)
  })
})

describe('netvarBoundary / anytimeEnvelope against mpmath bisection', () => {
  test('upper and lower roots', () => {
    for (const c of fixtures.netvarBoundary) {
      const boundary = netvarBoundary(c.t, c.alpha, { a: c.a, b: c.b, sided: c.sided })
      relClose(boundary.upper, c.upper, 1e-11, 1e-9)
      if (c.lower === null) expect(boundary.lower).toBe(Number.NEGATIVE_INFINITY)
      else relClose(boundary.lower, c.lower, 1e-11, 1e-9)
    }
  })

  test('reference values at α = 0.05, a = b = 1 (t = 10, 100, 400, 1000)', () => {
    const env = anytimeEnvelope(1000)
    expect(env.upper[9]).toBeCloseTo(19.4977, 3)
    expect(env.upper[99]).toBeCloseTo(52.3076, 3)
    expect(env.upper[399]).toBeCloseTo(103.7568, 3)
    expect(env.upper[999]).toBeCloseTo(165.7982, 3)
  })

  test('the envelope is exactly the Ville crossing of the martingale', () => {
    for (const [seed, scale] of [
      [0x21, 1.15],
      [0x22, 0.8],
      [0x23, 1.3],
    ] as const) {
      const z = gaussians(3000, seed).map((v) => v * scale)
      for (const sided of ['two', 'upper'] as const) {
        const env = anytimeEnvelope(z.length, 0.01, { sided })
        const deviation = cumulativeDeviation(z)
        let first = -1
        for (let t = 0; t < z.length && first < 0; t++) {
          const d = deviation[t] as number
          if (d >= (env.upper[t] as number) || d <= (env.lower[t] as number)) first = t
        }
        expect(villeCrossing(netvarMartingale(z, { sided }), 0.01)).toBe(first)
      }
    }
  })
})

describe('type-I error under optional stopping (seeded simulation)', () => {
  const steps = 3000
  const reps = 1000
  const alpha = 0.05
  // binomial band: α + 3·√(α(1 − α)/reps)
  const band = alpha + 3 * Math.sqrt((alpha * (1 - alpha)) / reps)

  test('crossing ANYWHERE within 3000 steps stays ≤ α; the pointwise envelope does not', () => {
    const two = anytimeEnvelope(steps, alpha)
    const upper = anytimeEnvelope(steps, alpha, { sided: 'upper' })
    const pointwise = significanceEnvelope(steps, alpha)
    const gauss = gaussians(steps * reps, 0x5eed)
    const bytes = prngBytes(steps * reps, 0xb17e)
    let crossedTwo = 0
    let crossedUpper = 0
    let crossedLattice = 0
    let crossedPointwise = 0
    for (let r = 0; r < reps; r++) {
      let d = 0
      let dLattice = 0
      let hitTwo = false
      let hitUpper = false
      let hitLattice = false
      let hitPointwise = false
      for (let t = 0; t < steps; t++) {
        const z = gauss[r * steps + t] as number
        d += z * z - 1
        const zl = ((POPCOUNT[bytes[r * steps + t] as number] as number) - 4) / Math.SQRT2
        dLattice += zl * zl - 1
        if (d >= (two.upper[t] as number) || d <= (two.lower[t] as number)) hitTwo = true
        if (d >= (upper.upper[t] as number)) hitUpper = true
        if (dLattice >= (upper.upper[t] as number)) hitLattice = true
        if (d > (pointwise[t] as number)) hitPointwise = true
      }
      crossedTwo += hitTwo ? 1 : 0
      crossedUpper += hitUpper ? 1 : 0
      crossedLattice += hitLattice ? 1 : 0
      crossedPointwise += hitPointwise ? 1 : 0
    }
    expect(crossedTwo / reps).toBeLessThanOrEqual(band)
    expect(crossedUpper / reps).toBeLessThanOrEqual(band)
    expect(crossedLattice / reps).toBeLessThanOrEqual(band)
    // not vacuous: the boundaries are reached at a non-trivial rate
    expect(crossedTwo / reps).toBeGreaterThan(0.005)
    // the pointwise χ² envelope is crossed somewhere in ~45% of H0 paths
    expect(crossedPointwise / reps).toBeGreaterThan(0.3)
  }, 30_000)

  test('anytime p-values: P(min p ≤ α) ≤ α, and a real variance excess is caught', () => {
    let rejected = 0
    const reps2 = 400
    const gauss = gaussians(steps * reps2, 0xace)
    for (let r = 0; r < reps2; r++) {
      const path = netvarMartingale(gauss.subarray(r * steps, (r + 1) * steps))
      if ((anytimeP(path)[steps - 1] as number) <= alpha) rejected++
    }
    expect(rejected / reps2).toBeLessThanOrEqual(alpha + 3 * Math.sqrt((alpha * 0.95) / reps2))
    const excess = gaussians(steps, 0xbee).map((v) => v * Math.sqrt(1.25))
    expect(villeCrossing(netvarMartingale(excess, { sided: 'upper' }), alpha)).toBeGreaterThan(0)
  }, 30_000)
})

describe('validation', () => {
  test('bad options and inputs throw invalid_config', () => {
    const bad: Array<() => unknown> = [
      () => netvarLogM(-1, 0),
      () => netvarLogM(Number.NaN, 0),
      () => netvarLogM(10, Number.POSITIVE_INFINITY),
      () => netvarLogM(10, -11), // ΣZ² < 0
      () => netvarLogM(10, 0, { a: 0 }),
      () => netvarLogM(10, 0, { b: Number.NaN }),
      () => netvarLogM(10, 0, { sided: 'lower' as Side }),
      () => netvarMartingale([1, Number.NaN]),
      () => netvarBoundary(10, 0),
      () => netvarBoundary(10, 1),
      () => anytimeEnvelope(0),
      () => anytimeEnvelope(2.5),
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

  test("'upper' has no lower boundary; an empty stream has an empty path", () => {
    expect(netvarBoundary(50, 0.05, { sided: 'upper' }).lower).toBe(Number.NEGATIVE_INFINITY)
    expect(netvarMartingale([]).length).toBe(0)
  })
})
