import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NegentropyError } from '../../src/errors.js'
import { autocorrelation } from '../../src/estimators/autocorrelation.js'
import { gaussians } from '../helpers/byte-sources.js'

interface EstimatorFixtures {
  autocorrelation: Array<{ label: string; samples: number[]; maxLag: number; acf: number[] }>
}
const fixtures = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'fixtures', 'estimators.json'), 'utf8'),
) as EstimatorFixtures

describe('autocorrelation', () => {
  test('lag 0 is exactly 1', () => {
    expect(autocorrelation(gaussians(500, 0x1), 10)[0]).toBe(1)
  })

  test('matches the numpy fixture (white noise + AR(1))', () => {
    for (const c of fixtures.autocorrelation) {
      const acf = autocorrelation(c.samples, c.maxLag)
      expect(acf.length).toBe(c.maxLag + 1)
      for (let lag = 0; lag <= c.maxLag; lag++) {
        expect(acf[lag] as number).toBeCloseTo(c.acf[lag] as number, 10)
      }
    }
  })

  test('white noise stays inside the ±1.96/√n band at most lags', () => {
    const n = 4000
    const acf = autocorrelation(gaussians(n, 0x5eed), 40)
    const band = 1.96 / Math.sqrt(n)
    let outside = 0
    for (let lag = 1; lag <= 40; lag++) if (Math.abs(acf[lag] as number) > band) outside++
    expect(outside).toBeLessThan(6) // ~5% of 40 expected under H0
  })

  test('validation', () => {
    expect(() => autocorrelation([1], 1)).toThrow(NegentropyError) // n < 2
    expect(() => autocorrelation([1, 2, 3], 3)).toThrow(NegentropyError) // maxLag ≥ n
    expect(() => autocorrelation(new Array(10).fill(4), 3)).toThrow(NegentropyError) // constant
  })
})
