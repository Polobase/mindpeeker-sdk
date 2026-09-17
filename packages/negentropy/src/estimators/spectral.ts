import { NegentropyError } from '../errors.js'
import { assertBits } from '../internal/assert.js'
import { realDftMagnitudes, realPowerSpectrum } from '../internal/dft.js'
import { erfc } from '../internal/special.js'

export interface SpectralTestOptions {
  /**
   * Null variance of N₁. 'nist' (default, spec parity): n·0.95·0.05/4, as
   * printed in SP 800-22 rev1a. 'kim2004': n·0.95·0.05/3.8, the correction of
   * Kim, Umeno & Hasegawa (2004) (derived via Parseval by Iwasaki 2018). The /4
   * variance is ~5% too small, so under H0 the 'nist' d is over-dispersed
   * (sd ≈ 1.026) and its tail p-values are anti-conservative: d = 2.5 gives
   * p = 0.0124 with /4 but 0.0148 with /3.8.
   */
  variance?: 'nist' | 'kim2004'
}

/**
 * NIST SP 800-22 §2.6 Discrete Fourier Transform (spectral) test. Maps bits to
 * ±1, takes the DFT, and counts how many of the h = ⌊n/2⌋ magnitudes
 * k = 0…h−1 fall below the threshold T = √(ln(1/0.05)·n); a periodic signal
 * produces tall spikes that push the count of small magnitudes away from the
 * expected 95%.
 * $$d = \frac{N_1 - 0.95\,h}{\sqrt{h\cdot0.95\cdot0.05/c}},\quad
 *   p = \mathrm{erfc}\!\left(\frac{|d|}{\sqrt2}\right)$$
 * with c = 2 ('nist', i.e. n·0.95·0.05/4 for even n) or c = 1.9 ('kim2004').
 * Using h = ⌊n/2⌋ for both N₀ and the variance keeps odd n unbiased (the spec's
 * n/2 would centre d at −0.475/σ for odd n). Needs ≥ 2 unpacked bits (≥ ~1000
 * for the asymptotics, per the spec). Note: the spec's printed §2.6.8 worked
 * examples are inconsistent with its own formula; validate against sts-2.1.2
 * output instead.
 */
export function spectralTest(
  bits: Uint8Array,
  opts: SpectralTestOptions = {},
): { statistic: number; pValue: number } {
  const n = bits.length
  if (n < 2) {
    throw new NegentropyError('insufficient_data', `spectralTest needs ≥ 2 bits, got ${n}`)
  }
  const variance = opts.variance ?? 'nist'
  if (variance !== 'nist' && variance !== 'kim2004') {
    throw new NegentropyError(
      'invalid_config',
      `spectralTest variance must be nist|kim2004, got ${variance}`,
    )
  }
  assertBits(bits, 'spectralTest')
  const signal = new Float64Array(n)
  for (let i = 0; i < n; i++) signal[i] = 2 * (bits[i] as number) - 1
  const mags = realDftMagnitudes(signal) // k = 0 … ⌊n/2⌋ − 1
  const threshold = Math.sqrt(Math.log(1 / 0.05) * n)
  const half = mags.length
  let n1 = 0
  for (let k = 0; k < half; k++) if ((mags[k] as number) < threshold) n1++
  const n0 = 0.95 * half
  const divisor = variance === 'nist' ? 2 : 1.9
  const d = (n1 - n0) / Math.sqrt((half * 0.95 * 0.05) / divisor)
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
