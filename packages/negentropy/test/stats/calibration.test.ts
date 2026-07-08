import { describe, expect, test } from 'bun:test'
import { NegentropyError } from '../../src/errors.js'
import { calibrate, theoreticalCalibration } from '../../src/stats/calibration.js'
import { trialsFromBytes } from '../../src/stats/trials.js'
import { stoufferZ, zScores } from '../../src/stats/zscores.js'
import { gaussians, prngBytes } from '../helpers/byte-sources.js'

describe('theoreticalCalibration', () => {
  test('Binomial(200, ½): mean 100, sd √50', () => {
    const cal = theoreticalCalibration('anu')
    expect(cal.mean).toBe(100)
    expect(cal.sd).toBe(Math.sqrt(50))
    expect(cal.basis).toBe('theoretical')
    expect(cal.trials).toBe(0)
  })
})

describe('calibrate', () => {
  test('recovers ≈(k/2, √(k/4)) on healthy PRNG trials', () => {
    const series = trialsFromBytes(prngBytes(250_000), 's', { bitsPerTrial: 200 })
    const cal = calibrate(series)
    expect(cal.basis).toBe('empirical')
    expect(cal.trials).toBe(10_000)
    expect(Math.abs(cal.mean - 100)).toBeLessThan(4 * Math.sqrt(50 / 10_000))
    expect(Math.abs(cal.sd - Math.sqrt(50))).toBeLessThan(0.3)
  })

  test('rejects short series with insufficient_data', () => {
    const series = trialsFromBytes(prngBytes(1000), 's', { bitsPerTrial: 200 })
    expect(series.sums.length).toBeLessThan(500)
    try {
      calibrate(series)
      expect.unreachable()
    } catch (error) {
      expect((error as NegentropyError).code).toBe('insufficient_data')
    }
  })

  test('rejects a constant series', () => {
    const series = trialsFromBytes(new Uint8Array(20_000).fill(0xaa), 's', { bitsPerTrial: 200 })
    try {
      calibrate(series)
      expect.unreachable()
    } catch (error) {
      expect((error as NegentropyError).code).toBe('insufficient_data')
    }
  })
})

describe('zScores', () => {
  test('known answers under theoretical calibration', () => {
    const cal = theoreticalCalibration('s', 200)
    const series = {
      source: 's',
      bitsPerTrial: 200,
      sums: new Float64Array([100, 110, 95]),
    }
    const zs = zScores(series, cal)
    expect(zs[0]).toBe(0)
    expect(zs[1]).toBeCloseTo(10 / Math.sqrt(50), 12) // 1.4142135623730951
    expect(zs[2]).toBeCloseTo(-Math.SQRT1_2, 12)
  })

  test('z of PRNG trials has mean ≈ 0, variance ≈ 1', () => {
    const series = trialsFromBytes(prngBytes(500_000, 0x5eed), 's', { bitsPerTrial: 200 })
    const zs = zScores(series, theoreticalCalibration('s'))
    const n = zs.length
    let sum = 0
    for (const z of zs) sum += z
    const mean = sum / n
    let m2 = 0
    for (const z of zs) m2 += (z - mean) ** 2
    expect(Math.abs(mean)).toBeLessThan(4 / Math.sqrt(n))
    expect(Math.abs(m2 / (n - 1) - 1)).toBeLessThan(4 * Math.sqrt(2 / n))
  })

  test('rejects mismatched calibration with calibration_required', () => {
    const series = { source: 'a', bitsPerTrial: 200, sums: new Float64Array([100]) }
    try {
      zScores(series, theoreticalCalibration('b', 200))
      expect.unreachable()
    } catch (error) {
      expect((error as NegentropyError).code).toBe('calibration_required')
    }
    try {
      zScores(series, theoreticalCalibration('a', 128))
      expect.unreachable()
    } catch (error) {
      expect((error as NegentropyError).code).toBe('calibration_required')
    }
  })
})

describe('stoufferZ', () => {
  test('known answers', () => {
    expect(stoufferZ([1, 1])).toBeCloseTo(Math.SQRT2, 14)
    expect(stoufferZ([1, -1])).toBe(0)
    expect(stoufferZ([2.5])).toBe(2.5)
    // two equal z's combine to z·√2 (e.g. two one-sided p=0.05 events)
    const z05 = 1.6448536269514722
    expect(stoufferZ([z05, z05])).toBeCloseTo(z05 * Math.SQRT2, 12)
  })

  test('is ~N(0,1) over iid normal inputs', () => {
    const zs = gaussians(50_000, 0xfeed)
    const combined: number[] = []
    for (let i = 0; i + 5 <= zs.length; i += 5) {
      combined.push(stoufferZ(Array.from(zs.slice(i, i + 5))))
    }
    const n = combined.length
    const mean = combined.reduce((a, b) => a + b, 0) / n
    const variance = combined.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)
    expect(Math.abs(mean)).toBeLessThan(4 / Math.sqrt(n))
    expect(Math.abs(variance - 1)).toBeLessThan(4 * Math.sqrt(2 / n))
  })

  test('rejects empty input', () => {
    expect(() => stoufferZ([])).toThrow(NegentropyError)
  })
})
