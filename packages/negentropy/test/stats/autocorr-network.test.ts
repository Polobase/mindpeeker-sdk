import { describe, expect, test } from 'bun:test'
import { NegentropyError } from '../../src/errors.js'
import { networkAutocorrelation } from '../../src/stats/autocorr-network.js'
import { gaussians } from '../helpers/byte-sources.js'
import { sequentialFixtures as fixtures } from '../helpers/sequential-fixtures.js'

describe('networkAutocorrelation', () => {
  test('matches an independent numpy computation (lag z, integrated, envelope)', () => {
    const ref = fixtures.autocorrelation
    const result = networkAutocorrelation(fixtures.series.ar, ref.maxLag, { p: ref.p })
    expect(result.n).toBe(fixtures.series.ar.length)
    for (let l = 0; l < ref.maxLag; l++) {
      expect(result.acf[l] as number).toBeCloseTo(ref.acf[l] as number, 12)
      expect(result.z[l] as number).toBeCloseTo(ref.z[l] as number, 10)
      expect(result.integrated[l] as number).toBeCloseTo(ref.integrated[l] as number, 10)
      expect(result.envelope[l] as number).toBeCloseTo(ref.envelope[l] as number, 12)
    }
    expect(result.band).toBeCloseTo(1.959963984540054 / Math.sqrt(result.n), 14)
    // the AR(0.3) fixture: lag 1 far outside the white-noise band
    expect(result.z[0] as number).toBeGreaterThan(5)
  })

  test('H0: |z₁| exceeds 1.96 about 5% of the time, I(L) within its pointwise envelope about 95%', () => {
    const reps = 1000
    const n = 2000
    const maxLag = 10
    const g = gaussians(reps * n, 0x3a)
    let lagOut = 0
    let integratedOut = 0
    for (let r = 0; r < reps; r++) {
      const result = networkAutocorrelation(g.subarray(r * n, (r + 1) * n), maxLag)
      if (Math.abs(result.z[0] as number) > 1.959963984540054) lagOut++
      const last = maxLag - 1
      if (Math.abs(result.integrated[last] as number) > (result.envelope[last] as number)) {
        integratedOut++
      }
    }
    const tolerance = 4 * Math.sqrt((0.05 * 0.95) / reps)
    expect(Math.abs(lagOut / reps - 0.05)).toBeLessThan(tolerance)
    // the biased ACF has mean ≈ −1/n per lag, so I(10) is centred slightly below 0
    expect(Math.abs(integratedOut / reps - 0.05)).toBeLessThan(tolerance)
  }, 30_000)

  test('persistence spread over many small lags shows in the integrated statistic', () => {
    // a slowly varying common component: every lag correlation ≈ 0.02, no single lag significant
    const n = 20_000
    const g = gaussians(n, 0x3b)
    const slow = gaussians(n / 50, 0x3c)
    const series = Float64Array.from(
      { length: n },
      (_, t) => (g[t] as number) + 0.15 * (slow[Math.floor(t / 50)] as number),
    )
    const result = networkAutocorrelation(series, 30)
    expect(result.integrated[29] as number).toBeGreaterThan(3 * (result.envelope[29] as number))
  })

  test('validation', () => {
    expect(() => networkAutocorrelation([1, 2, 3], 3)).toThrow(NegentropyError)
    expect(() => networkAutocorrelation([1, 2, 3], 1, { p: 0 })).toThrow(NegentropyError)
    expect(() => networkAutocorrelation([1, Number.NaN, 3], 1)).toThrow(NegentropyError)
    expect(() => networkAutocorrelation([2, 2, 2], 1)).toThrow(NegentropyError)
  })
})
