import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NegentropyError } from '../../src/errors.js'
import {
  EXP_GAUSSIAN_MEAN,
  EXP_GAUSSIAN_VARIANCE,
  EXP_NULL_VARIANCE,
  LOGCOSH_GAUSSIAN_MEAN,
  LOGCOSH_GAUSSIAN_VARIANCE,
  LOGCOSH_NULL_VARIANCE,
  negentropyExp,
  negentropyKurtosis,
  negentropyLogcosh,
} from '../../src/estimators/negentropy.js'
import { gaussians, prngUniforms } from '../helpers/byte-sources.js'

interface GaussianConstants {
  logcosh: { mean: number; variance: number; b: number; nullVariance: number }
  exp: { mean: number; variance: number; b: number; nullVariance: number }
}
interface MomentsFixtures {
  cases: Array<{
    label: string
    samples: number[]
    skew: number
    exkurt: number
    jMoment: number
    meanLogcosh: number
    meanExp: number
  }>
}

const constants = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'fixtures', 'gaussian-constants.json'), 'utf8'),
) as GaussianConstants
const moments = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'fixtures', 'moments.json'), 'utf8'),
) as MomentsFixtures

/** Unit-variance Laplace via inverse CDF (exkurt = 3, super-Gaussian). */
function laplace(n: number, seed: number): Float64Array {
  const uniforms = prngUniforms(n, seed)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const u = (uniforms[i] as number) - 0.5
    out[i] = (-Math.sign(u) * Math.log(1 - 2 * Math.abs(u))) / Math.SQRT2
  }
  return out
}

describe('null constants', () => {
  test('match the mpmath fixture to 1e-12', () => {
    expect(Math.abs(LOGCOSH_GAUSSIAN_MEAN - constants.logcosh.mean)).toBeLessThan(1e-12)
    expect(Math.abs(LOGCOSH_GAUSSIAN_VARIANCE - constants.logcosh.variance)).toBeLessThan(1e-12)
    expect(Math.abs(LOGCOSH_NULL_VARIANCE - constants.logcosh.nullVariance)).toBeLessThan(1e-14)
    expect(Math.abs(EXP_GAUSSIAN_MEAN - constants.exp.mean)).toBeLessThan(1e-14)
    expect(Math.abs(EXP_GAUSSIAN_VARIANCE - constants.exp.variance)).toBeLessThan(1e-14)
    expect(Math.abs(EXP_NULL_VARIANCE - constants.exp.nullVariance)).toBeLessThan(1e-14)
  })

  test('exp constants equal their closed forms', () => {
    expect(EXP_GAUSSIAN_MEAN).toBe(-Math.SQRT1_2)
    expect(EXP_GAUSSIAN_VARIANCE).toBe(1 / Math.sqrt(3) - 0.5)
  })
})

describe('scipy fixture cross-validation', () => {
  test('moments and contrast means match on stored samples', () => {
    for (const c of moments.cases) {
      const result = negentropyKurtosis(c.samples)
      expect(Math.abs(result.skew - c.skew)).toBeLessThan(1e-10)
      expect(Math.abs(result.exkurt - c.exkurt)).toBeLessThan(1e-10)
      expect(Math.abs(result.j - c.jMoment)).toBeLessThan(1e-10)
      expect(Math.abs(negentropyLogcosh(c.samples).meanG - c.meanLogcosh)).toBeLessThan(1e-10)
      expect(Math.abs(negentropyExp(c.samples).meanG - c.meanExp)).toBeLessThan(1e-10)
    }
  })
})

describe('directional behavior', () => {
  test('Gaussian input: J ≈ 0, |z| small', () => {
    const x = gaussians(20_000, 0xaaaa)
    const moment = negentropyKurtosis(x)
    expect(moment.j).toBeLessThan(50 / x.length) // null level ≈ 1/n
    expect(Math.abs(negentropyLogcosh(x).z)).toBeLessThan(4)
    expect(Math.abs(negentropyExp(x).z)).toBeLessThan(4)
  })

  test('uniform input is sub-Gaussian: exkurt → −6/5, logcosh ABOVE the Gaussian mean', () => {
    // ln cosh u ≈ u²/2 − u⁴/12 ⇒ E[G] ≈ ½ − kurt/12: low kurtosis raises meanG
    const uniforms = prngUniforms(50_000, 0xbbbb)
    const moment = negentropyKurtosis(uniforms)
    expect(Math.abs(moment.exkurt - -1.2)).toBeLessThan(0.05)
    expect(Math.abs(moment.j - 1.44 / 48)).toBeLessThan(0.005)
    const logcosh = negentropyLogcosh(uniforms)
    expect(logcosh.meanG).toBeGreaterThan(LOGCOSH_GAUSSIAN_MEAN)
    expect(logcosh.z).toBeGreaterThan(5)
  })

  test('Laplace input is super-Gaussian: exkurt → 3, logcosh BELOW the Gaussian mean', () => {
    const x = laplace(50_000, 0xcccc)
    const moment = negentropyKurtosis(x)
    expect(Math.abs(moment.exkurt - 3)).toBeLessThan(0.35)
    const logcosh = negentropyLogcosh(x)
    expect(logcosh.meanG).toBeLessThan(LOGCOSH_GAUSSIAN_MEAN)
    expect(logcosh.z).toBeLessThan(-5)
    expect(negentropyExp(x).z).toBeLessThan(-5)
  })

  test('symmetric two-point ±1: exkurt = −2, J = 1/12 exactly in the limit', () => {
    const x = new Float64Array(10_000)
    for (let i = 0; i < x.length; i++) x[i] = i % 2 === 0 ? 1 : -1
    const moment = negentropyKurtosis(x)
    expect(moment.exkurt).toBeCloseTo(-2, 10)
    expect(moment.j).toBeCloseTo(1 / 12, 10)
    expect(negentropyLogcosh(x).z).toBeGreaterThan(20) // strongly sub-Gaussian
  })

  test('exponential(1): skew → 2, exkurt → 6, J → 13/12', () => {
    const uniforms = prngUniforms(200_000, 0xdddd)
    const x = new Float64Array(uniforms.length)
    for (let i = 0; i < x.length; i++) x[i] = -Math.log(1 - (uniforms[i] as number))
    const moment = negentropyKurtosis(x)
    expect(Math.abs(moment.skew - 2)).toBeLessThan(0.15)
    expect(Math.abs(moment.exkurt - 6)).toBeLessThan(1.0)
    expect(Math.abs(moment.j - 13 / 12)).toBeLessThan(0.25)
  })
})

describe('null calibration of the contrast z', () => {
  test('z is ~N(0,1) over replications of Gaussian input', () => {
    const reps = 100
    const n = 5000
    const all = gaussians(reps * n, 0xeeee)
    const zs: number[] = []
    for (let rep = 0; rep < reps; rep++) {
      zs.push(negentropyLogcosh(all.slice(rep * n, (rep + 1) * n)).z)
    }
    const mean = zs.reduce((a, b) => a + b, 0) / reps
    const variance = zs.reduce((a, b) => a + (b - mean) ** 2, 0) / (reps - 1)
    expect(Math.abs(mean)).toBeLessThan(0.35)
    expect(variance).toBeGreaterThan(0.5)
    expect(variance).toBeLessThan(1.6)
  })
})

describe('edge cases', () => {
  test('constant input is degenerate, not Infinity', () => {
    const result = negentropyKurtosis(new Float64Array(100).fill(3))
    expect(result.degenerate).toBe(true)
    expect(result.j).toBeNaN()
    expect(negentropyLogcosh(new Float64Array(100).fill(3)).degenerate).toBe(true)
  })

  test('too few samples throws insufficient_data', () => {
    expect(() => negentropyKurtosis([1, 2, 3])).toThrow(NegentropyError)
  })
})
