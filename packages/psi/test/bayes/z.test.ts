import { describe, expect, test } from 'bun:test'
import { tripolarBayesFactor, zBayesFactor } from '../../src/bayes/z.js'
import type { TripolarRun } from '../../src/protocol/tripolar.js'
import { analyzeTripolar } from '../../src/protocol/tripolar-analysis.js'
import type { Intention } from '../../src/types.js'

/** Composite Simpson rule of f on [lo, hi] with an even number of panels. */
function simpson(f: (x: number) => number, lo: number, hi: number, panels = 20_000): number {
  const h = (hi - lo) / panels
  let sum = f(lo) + f(hi)
  for (let i = 1; i < panels; i++) sum += (i % 2 === 1 ? 4 : 2) * f(lo + i * h)
  return (sum * h) / 3
}

/**
 * Independent BF10 by numerical integration of the marginal likelihood ratio:
 * ∫ φ(z − μ) π(μ) dμ / φ(z), with π the N(0, g) prior (or its half-normal on μ > 0).
 * The integrand is the (unnormalized) posterior, so the grid spans its bulk.
 */
function integratedBf(z: number, g: number, oneSided: boolean): number {
  const postMean = (z * g) / (1 + g)
  const postSd = Math.sqrt(g / (1 + g))
  const lo = oneSided ? Math.max(0, postMean - 40 * postSd) : postMean - 40 * postSd
  const hi = Math.max(postMean + 40 * postSd, lo + 40 * postSd)
  const prior = (mu: number) =>
    ((oneSided ? 2 : 1) * Math.exp(-(mu * mu) / (2 * g))) / Math.sqrt(2 * Math.PI * g)
  // φ(z − μ)/φ(z) = exp(zμ − μ²/2)
  return simpson((mu) => Math.exp(z * mu - (mu * mu) / 2) * prior(mu), lo, hi)
}

const code = (c: string) =>
  expect.objectContaining({ name: 'PsiError', code: c }) as unknown as Error

describe('zBayesFactor', () => {
  test('two-sided and one-sided closed forms match numerical integration', () => {
    for (const g of [0.01, 0.5, 1, 4, 100]) {
      for (const z of [-3, -1.2, 0, 0.7, 2, 3.5]) {
        const two = zBayesFactor(z, { g })
        expect(Math.abs(two.bf10 / integratedBf(z, g, false) - 1)).toBeLessThan(1e-9)
        const one = zBayesFactor(z, { g, oneSided: true })
        expect(Math.abs(one.bf10 / integratedBf(z, g, true) - 1)).toBeLessThan(1e-9)
      }
    }
  })

  test('exact identities', () => {
    // z = 0: BF10 = (1+g)^(-1/2); one-sided adds 2·Φ(0) = 1
    expect(zBayesFactor(0, { g: 3 }).bf10).toBeCloseTo(0.5, 14)
    expect(zBayesFactor(0, { g: 3, oneSided: true }).bf10).toBeCloseTo(0.5, 14)
    const r = zBayesFactor(2, { g: 1 })
    expect(r.lnBf10).toBeCloseTo(-0.5 * Math.log(2) + 1, 14) // z²g/(2(1+g)) = 1
    expect(r.bf01).toBeCloseTo(1 / r.bf10, 14)
    // symmetric prior: the two one-sided factors average to the two-sided one
    const plus = zBayesFactor(1.3, { g: 2, oneSided: true }).bf10
    const minus = zBayesFactor(-1.3, { g: 2, oneSided: true }).bf10
    expect((plus + minus) / 2).toBeCloseTo(zBayesFactor(1.3, { g: 2 }).bf10, 13)
  })

  test('log form stays finite and continuous in the far lower tail', () => {
    const far = zBayesFactor(-1e4, { g: 1, oneSided: true })
    // exp(z²s/2)·Φ(z√s) → φ(0)/(|z|√s) as z → −∞ (s = g/(1+g)): BF+0 decays like 1/|z|
    const s = 0.5
    const limit =
      Math.LN2 - 0.5 * Math.log(2) - Math.log(1e4 * Math.sqrt(s)) - 0.5 * Math.log(2 * Math.PI)
    expect(far.lnBf10).toBeCloseTo(limit, 6)
    // the asymptotic ln Φ branch starts at z·√(g/(1+g)) = −30
    const edge = -30 * Math.SQRT2
    const below = zBayesFactor(edge - 1e-9, { g: 1, oneSided: true }).lnBf10
    const above = zBayesFactor(edge + 1e-9, { g: 1, oneSided: true }).lnBf10
    expect(Math.abs(below - above)).toBeLessThan(1e-9)
    // the two-sided factor at huge z overflows only in the linear form
    const huge = zBayesFactor(100, { g: 1 })
    expect(huge.lnBf10).toBeCloseTo(-0.5 * Math.log(2) + 2500, 10)
    expect(Number.isFinite(zBayesFactor(1000, { g: 1 }).lnBf10)).toBe(true)
  })

  test('validation', () => {
    expect(() => zBayesFactor(Number.NaN, { g: 1 })).toThrow(code('invalid_plan'))
    expect(() => zBayesFactor(1, { g: 0 })).toThrow(code('invalid_plan'))
    expect(() => zBayesFactor(1, { g: Number.POSITIVE_INFINITY })).toThrow(code('invalid_plan'))
    expect(() => zBayesFactor(1, undefined as unknown as { g: number })).toThrow(
      code('invalid_plan'),
    )
    expect(() => zBayesFactor(1, { g: 1, oneSided: 'yes' as unknown as boolean })).toThrow(
      code('invalid_plan'),
    )
  })
})

function run(intention: Intention, sequence: number, sum: number, trials: number): TripolarRun {
  return {
    intention,
    run: 0,
    sequence,
    series: { source: 'reg', bitsPerTrial: 200, sums: new Float64Array(trials).fill(sum) },
  }
}

describe('tripolarBayesFactor', () => {
  // unequal budgets: high 300 trials at 101, low 900 trials at 100 → N_H = 60 000, N_L = 180 000
  const analysis = analyzeTripolar([run('high', 0, 101, 300), run('low', 1, 100, 900)])

  test('maps the per-bit prior to g = σ²/(1/N_H + 1/N_L)', () => {
    const sigma = 0.02
    const bf = tripolarBayesFactor(analysis, { perBitEffectSd: sigma })
    expect(bf.highBits).toBe(60_000)
    expect(bf.lowBits).toBe(180_000)
    expect(bf.g).toBeCloseTo((sigma * sigma) / (1 / 60_000 + 1 / 180_000), 10)
    expect(bf.oneSided).toBe(true)
    expect(bf.z).toBe(analysis.deltaZ)
    expect(bf.lnBf10).toBe(zBayesFactor(analysis.deltaZ, { g: bf.g, oneSided: true }).lnBf10)
  })

  test('matches integration over the per-bit effect Δε directly (no g in the reference)', () => {
    const se = Math.sqrt(1 / analysis.high.bits + 1 / analysis.low.bits)
    const dz = analysis.deltaZ
    for (const sigma of [1e-3, 0.005, 0.02]) {
      for (const oneSided of [true, false]) {
        // Δz | Δε ~ N(Δε/SE, 1); Δε ~ N(0, σ²) (half-normal on Δε > 0 when one-sided)
        const f = (de: number) =>
          Math.exp(dz * (de / se) - (de / se) ** 2 / 2) *
          (((oneSided ? 2 : 1) * Math.exp(-(de * de) / (2 * sigma * sigma))) /
            Math.sqrt(2 * Math.PI * sigma * sigma))
        const width = 40 * Math.min(sigma, se)
        const center = (dz * se * sigma * sigma) / (sigma * sigma + se * se)
        const lo = oneSided ? Math.max(0, center - width) : center - width
        const reference = simpson(f, lo, Math.max(center + width, lo + width), 40_000)
        const bf = tripolarBayesFactor(analysis, { perBitEffectSd: sigma, oneSided })
        expect(Math.abs(bf.bf10 / reference - 1)).toBeLessThan(1e-8)
      }
    }
  })

  test('the same effect scale grows more decisive with more bits', () => {
    const small = analyzeTripolar([run('high', 0, 100, 50), run('low', 1, 100, 50)])
    const large = analyzeTripolar([run('high', 0, 100, 5000), run('low', 1, 100, 5000)])
    const prior = { perBitEffectSd: 0.01 }
    // both at Δz = 0: more data, more support for chance
    expect(tripolarBayesFactor(large, prior).bf01).toBeGreaterThan(
      tripolarBayesFactor(small, prior).bf01,
    )
  })

  test('validation', () => {
    expect(() => tripolarBayesFactor(analysis, { perBitEffectSd: 0 })).toThrow(code('invalid_plan'))
    expect(() => tripolarBayesFactor(analysis, { perBitEffectSd: Number.NaN })).toThrow(
      code('invalid_plan'),
    )
    expect(() =>
      tripolarBayesFactor({ ...analysis, deltaZ: Number.NaN }, { perBitEffectSd: 1e-4 }),
    ).toThrow(code('invalid_plan'))
    expect(() =>
      tripolarBayesFactor(
        { ...analysis, high: { ...analysis.high, bits: 0 } },
        { perBitEffectSd: 1e-4 },
      ),
    ).toThrow(code('invalid_plan'))
    expect(() =>
      tripolarBayesFactor(null as unknown as typeof analysis, { perBitEffectSd: 1e-4 }),
    ).toThrow(code('invalid_plan'))
  })
})
