import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NegentropyError } from '../../src/errors.js'
import { negentropyVasicek, vasicekEntropy } from '../../src/estimators/vasicek.js'
import { gaussians, prngUniforms } from '../helpers/byte-sources.js'

interface VasicekFixtures {
  cases: Array<{ label: string; samples: number[]; m: number; entropy: number }>
}

const fixtures = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'fixtures', 'vasicek.json'), 'utf8'),
) as VasicekFixtures

describe('vasicekEntropy', () => {
  test('hand-computed KAT: [1,2,3,4] with m=1 → (3/2)·ln2', () => {
    // clamped spacings 1,2,2,1; scale n/(2m)=2 → mean of ln2, ln4, ln4, ln2
    expect(vasicekEntropy([1, 2, 3, 4], 1)).toBeCloseTo(1.5 * Math.LN2, 12)
  })

  test('matches scipy differential_entropy on the fixture grid', () => {
    for (const c of fixtures.cases) {
      expect(Math.abs(vasicekEntropy(c.samples, c.m) - c.entropy)).toBeLessThan(1e-10)
    }
  })

  test('uniform(0,1) → H ≈ 0; standard normal → H ≈ ½ln(2πe)', () => {
    expect(Math.abs(vasicekEntropy(prngUniforms(100_000, 0x9999)))).toBeLessThan(0.02)
    expect(Math.abs(vasicekEntropy(gaussians(100_000, 0x8888)) - 1.4189385332046727)).toBeLessThan(
      0.02,
    )
  })

  test('scale equivariance: H(3x) − H(x) = ln 3', () => {
    const x = gaussians(20_000, 0x7777)
    const scaled = new Float64Array(x.length)
    for (let i = 0; i < x.length; i++) scaled[i] = 3 * (x[i] as number)
    expect(vasicekEntropy(scaled) - vasicekEntropy(x)).toBeCloseTo(Math.log(3), 8)
  })

  test('ties throw with a dither hint', () => {
    const lattice = new Float64Array(1000)
    for (let i = 0; i < lattice.length; i++) lattice[i] = i % 5
    try {
      vasicekEntropy(lattice)
      expect.unreachable()
    } catch (error) {
      const err = error as NegentropyError
      expect(err.code).toBe('insufficient_data')
      expect(err.message).toContain('dither')
    }
  })

  test('rejects bad inputs', () => {
    expect(() => vasicekEntropy([1, 2, 3])).toThrow(NegentropyError)
    expect(() => vasicekEntropy([1, 2, 3, 4, 5, 6], 3)).toThrow(NegentropyError) // m ≥ n/2
    expect(() => vasicekEntropy([1, 2, 3, 4], 0)).toThrow(NegentropyError)
  })
})

describe('negentropyVasicek', () => {
  test('≈ 0 for Gaussian, ≈ ½ln(2πe/12) ≈ 0.176 for uniform', () => {
    expect(Math.abs(negentropyVasicek(gaussians(100_000, 0x6666)))).toBeLessThan(0.02)
    const uniformJ = negentropyVasicek(prngUniforms(100_000, 0x5555))
    expect(Math.abs(uniformJ - 0.5 * Math.log((2 * Math.PI * Math.E) / 12))).toBeLessThan(0.02)
  })

  test('is scale-invariant', () => {
    const x = gaussians(20_000, 0x4444)
    const scaled = new Float64Array(x.length)
    for (let i = 0; i < x.length; i++) scaled[i] = 42 * (x[i] as number)
    expect(negentropyVasicek(scaled)).toBeCloseTo(negentropyVasicek(x), 8)
  })
})
