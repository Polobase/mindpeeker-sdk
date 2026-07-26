import { NegentropyError } from '../errors.js'
import { realDftMagnitudes, realPowerSpectrum } from '../internal/dft.js'
import { erfc } from '../internal/special.js'

/**
 * NIST SP 800-22 §2.6 Discrete Fourier Transform (spectral) test. Maps bits to
 * ±1, takes the DFT, and checks how many of the first n/2 magnitudes fall below
 * the threshold T = √(ln(1/0.05)·n); a periodic signal produces tall spikes
 * that push the count of small magnitudes away from the expected 95%.
 * $$d = \frac{N_1 - N_0}{\sqrt{n\cdot0.95\cdot0.05/4}},\quad
 *   p = \mathrm{erfc}\!\left(\frac{|d|}{\sqrt2}\right)$$
 * with N₀ = 0.95·n/2 expected and N₁ observed. Needs ≥ 2 bits (≥ ~1000 for the
 * asymptotics to hold, per the spec).
 */
export function spectralTest(bits: Uint8Array): { statistic: number; pValue: number } {
  const n = bits.length
  if (n < 2) {
    throw new NegentropyError('insufficient_data', `spectralTest needs ≥ 2 bits, got ${n}`)
  }
  const signal = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const b = bits[i] as number
    if (b !== 0 && b !== 1) {
      throw new NegentropyError('invalid_config', `spectralTest expects 0/1 bits, got ${b}`)
    }
    signal[i] = 2 * b - 1
  }
  const mags = realDftMagnitudes(signal) // k = 0 … ⌊n/2⌋ − 1
  const threshold = Math.sqrt(Math.log(1 / 0.05) * n)
  const half = mags.length
  let n1 = 0
  for (let k = 0; k < half; k++) if ((mags[k] as number) < threshold) n1++
  const n0 = 0.95 * (n / 2)
  const d = (n1 - n0) / Math.sqrt((n * 0.95 * 0.05) / 4)
  return { statistic: d, pValue: erfc(Math.abs(d) / Math.SQRT2) }
}

export interface SpectralEntropyOptions {
  /** Divide by log₂(bins) so the result lands in [0, 1]. Default false. */
  normalize?: boolean
}

/**
 * Spectral entropy — the Shannon entropy (bits) of the normalized one-sided
 * power spectrum $p_k = P_k / \sum P_k$, $P_k = |X_k|^2$ for k = 0…⌊n/2⌋:
 * $$H_{spec} = -\sum_k p_k \log_2 p_k$$
 * A flat (white) spectrum approaches the maximum log₂(bins); energy
 * concentrated in a few tones (a sinusoid) gives near-zero entropy.
 * `normalize` rescales to [0, 1]. The DC/mean component is included; center
 * the signal first if you want the AC spectrum only.
 */
export function spectralEntropy(x: ArrayLike<number>, opts: SpectralEntropyOptions = {}): number {
  const n = x.length
  if (n < 2) {
    throw new NegentropyError('insufficient_data', `spectralEntropy needs ≥ 2 samples, got ${n}`)
  }
  const psd = realPowerSpectrum(x)
  let total = 0
  for (let k = 0; k < psd.length; k++) total += psd[k] as number
  if (!(total > 0)) {
    throw new NegentropyError(
      'insufficient_data',
      'signal has zero power — spectral entropy undefined',
    )
  }
  let h = 0
  for (let k = 0; k < psd.length; k++) {
    const p = (psd[k] as number) / total
    if (p > 0) h -= p * Math.log2(p)
  }
  return opts.normalize === true ? h / Math.log2(psd.length) : h
}
