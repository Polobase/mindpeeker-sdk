import { describe, expect, test } from 'bun:test'
import { negentropyKurtosis, negentropyLogcosh } from '../../src/estimators/negentropy.js'
import { ditheredTrialZ, probitBytes } from '../../src/estimators/pipeline.js'
import { negentropyVasicek, vasicekEntropy } from '../../src/estimators/vasicek.js'
import { theoreticalCalibration } from '../../src/stats/calibration.js'
import { trialsFromBytes } from '../../src/stats/trials.js'
import { prngBytes } from '../helpers/byte-sources.js'

describe('probitBytes (exact-null mode)', () => {
  test('healthy bytes map to samples with standard-normal moments', () => {
    const x = probitBytes(prngBytes(200_000, 0x1111))
    const n = x.length
    let sum = 0
    for (const v of x) sum += v
    const mean = sum / n
    let m2 = 0
    let m3 = 0
    let m4 = 0
    for (const v of x) {
      const d = v - mean
      m2 += d * d
      m3 += d * d * d
      m4 += d * d * d * d
    }
    const variance = m2 / n
    expect(Math.abs(mean)).toBeLessThan(4 / Math.sqrt(n))
    expect(Math.abs(variance - 1)).toBeLessThan(4 * Math.sqrt(2 / n))
    expect(Math.abs(m3 / n / variance ** 1.5)).toBeLessThan(4 * Math.sqrt(6 / n))
    expect(Math.abs(m4 / n / variance ** 2 - 3)).toBeLessThan(4 * Math.sqrt(24 / n))
  })

  test('is deterministic per seed and independent across seeds', () => {
    const bytes = prngBytes(1000, 0x2222)
    expect([...probitBytes(bytes, { seed: 7 })]).toEqual([...probitBytes(bytes, { seed: 7 })])
    expect(probitBytes(bytes, { seed: 7 })[0]).not.toBe(probitBytes(bytes, { seed: 8 })[0])
  })

  test('preserves byte ordering: byte 0 maps deep left, byte 255 deep right', () => {
    const low = probitBytes(new Uint8Array(100).fill(0))
    const high = probitBytes(new Uint8Array(100).fill(255))
    for (const v of low) expect(v).toBeLessThan(-2.5)
    for (const v of high) expect(v).toBeGreaterThan(2.5)
  })

  test('Vasicek on probit-mapped healthy bytes recovers Gaussian entropy', () => {
    const x = probitBytes(prngBytes(100_000, 0x3333))
    expect(Math.abs(vasicekEntropy(x) - 1.4189385332046727)).toBeLessThan(0.02)
  })
})

describe('ditheredTrialZ', () => {
  const cal = theoreticalCalibration('s')

  test('breaks the lattice: no ties, Vasicek becomes usable and ≈ Gaussian', () => {
    const series = trialsFromBytes(prngBytes(500_000, 0x4444), 's')
    const dithered = ditheredTrialZ(series, cal)
    expect(new Set(dithered).size).toBe(dithered.length) // continuous now
    // fine lattice (spacing 1/√50) → dithered binomial z ≈ standard normal
    expect(Math.abs(vasicekEntropy(dithered) - 1.4189385332046727)).toBeLessThan(0.05)
    expect(Math.abs(negentropyVasicek(dithered))).toBeLessThan(0.05)
  })

  test('null: moment J at the 1/n level, exkurt near −2/k', () => {
    const series = trialsFromBytes(prngBytes(2_500_000, 0x5555), 's')
    const dithered = ditheredTrialZ(series, cal)
    const moment = negentropyKurtosis(dithered)
    expect(moment.j).toBeLessThan(50 / dithered.length)
    expect(Math.abs(moment.exkurt)).toBeLessThan(0.1) // −2/k = −0.01 plus noise
  })

  test('signal: two-point byte blocks light up every estimator', () => {
    // alternating 1000-byte blocks of 0x00 and 0xFF → trial sums 0/200 → ±z two-point
    const bytes = new Uint8Array(100_000)
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(i / 1000) % 2 === 0 ? 0 : 255
    const series = trialsFromBytes(bytes, 's')
    const dithered = ditheredTrialZ(series, cal)
    const moment = negentropyKurtosis(dithered)
    expect(moment.exkurt).toBeLessThan(-1.9) // two-point → −2
    expect(moment.j).toBeGreaterThan(0.07) // → 1/12
    expect(Math.abs(negentropyLogcosh(dithered).z)).toBeGreaterThan(10)
  })
})
