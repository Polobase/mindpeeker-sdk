import { describe, expect, test } from 'bun:test'
import { fft, realDftMagnitudes, realPowerSpectrum } from '../../src/internal/dft.js'
import { prngUniforms } from '../helpers/byte-sources.js'

/** Naive O(n²) DFT — the independent oracle for the fast paths. */
function naiveDft(x: readonly number[]): { re: number[]; im: number[] } {
  const n = x.length
  const re: number[] = []
  const im: number[] = []
  for (let k = 0; k < n; k++) {
    let sr = 0
    let si = 0
    for (let j = 0; j < n; j++) {
      const a = (-2 * Math.PI * k * j) / n
      sr += (x[j] as number) * Math.cos(a)
      si += (x[j] as number) * Math.sin(a)
    }
    re.push(sr)
    im.push(si)
  }
  return { re, im }
}

describe('fft', () => {
  test('matches the naive DFT for power-of-two and arbitrary lengths', () => {
    for (const n of [16, 17, 31, 64, 100]) {
      const x = Array.from(prngUniforms(n, 0x1000 + n))
      const re = Float64Array.from(x)
      const im = new Float64Array(n)
      fft(re, im)
      const ref = naiveDft(x)
      for (let k = 0; k < n; k++) {
        expect(re[k] as number).toBeCloseTo(ref.re[k] as number, 8)
        expect(im[k] as number).toBeCloseTo(ref.im[k] as number, 8)
      }
    }
  })

  test('realPowerSpectrum and realDftMagnitudes agree with the naive DFT', () => {
    const n = 100 // non-power-of-two → Bluestein
    const x = Array.from(prngUniforms(n, 0x2000))
    const ref = naiveDft(x)
    const psd = realPowerSpectrum(x)
    const mags = realDftMagnitudes(x)
    for (let k = 0; k < psd.length; k++) {
      const mag2 = (ref.re[k] as number) ** 2 + (ref.im[k] as number) ** 2
      expect(psd[k] as number).toBeCloseTo(mag2, 6)
    }
    for (let k = 0; k < mags.length; k++) {
      expect(mags[k] as number).toBeCloseTo(
        Math.sqrt((ref.re[k] as number) ** 2 + (ref.im[k] as number) ** 2),
        6,
      )
    }
  })

  test('a pure tone concentrates all power in one bin', () => {
    const n = 64
    const x = Array.from({ length: n }, (_, t) => Math.cos((2 * Math.PI * 8 * t) / n))
    const psd = realPowerSpectrum(x)
    // bin 8 dominates; all others are ~0
    for (let k = 0; k < psd.length; k++) {
      if (k === 8) expect(psd[k] as number).toBeGreaterThan(100)
      else expect(psd[k] as number).toBeLessThan(1e-6)
    }
  })
})
