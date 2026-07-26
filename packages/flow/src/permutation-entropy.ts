/**
 * Permutation entropy: the Shannon entropy of a series' Bandt–Pompe ordinal
 * patterns — a robust, near-model-free complexity measure. Assembled from this
 * package's own `ordinalPatterns` symbolization and plug-in `shannonEntropy`,
 * so it inherits their conventions (`FlowError`, `2 ≤ order ≤ 12`) and adds no
 * dependency.
 */

import { type OrdinalPatternOptions, ordinalPatterns } from './adapters.js'
import { shannonEntropy } from './entropy.js'

// order! for order 0..12 (12! = 479001600 < 2^31, the package symbol limit).
const FACTORIAL = Object.freeze([
  1, 1, 2, 6, 24, 120, 720, 5_040, 40_320, 362_880, 3_628_800, 39_916_800, 479_001_600,
] as const)

export interface PermutationEntropyOptions extends OrdinalPatternOptions {
  /** Divide by log₂(order!) so the result lands in [0, 1]. Default false. */
  normalize?: boolean
}

/**
 * Permutation entropy (Bandt & Pompe 2002), in bits:
 * $$H_{PE} = -\sum_{\pi} p(\pi)\,\log_2 p(\pi)$$
 * over the $m!$ ordinal patterns of order $m$. `normalize` divides by
 * $\log_2(m!)$ (max entropy, all patterns equiprobable) → [0, 1]. White noise
 * approaches the maximum; a monotone or constant series scores 0. Blind to
 * amplitude (only the rank pattern matters) — see `weightedPermutationEntropy`.
 */
export function permutationEntropy(
  values: ArrayLike<number>,
  order: number,
  opts: PermutationEntropyOptions = {},
): number {
  // ordinalPatterns validates order/delay/finiteness/length and throws FlowError
  const codes = ordinalPatterns(values, order, opts)
  const pe = shannonEntropy(codes, { alphabet: FACTORIAL[order] as number })
  return opts.normalize === true ? pe / Math.log2(FACTORIAL[order] as number) : pe
}

/**
 * Weighted permutation entropy (Fadlallah et al. 2013, Phys. Rev. E 87,
 * 022911): each ordinal pattern is weighted by the variance (amplitude
 * energy) of the window that produced it, so low-amplitude noise patterns
 * contribute less than salient large-swing ones:
 * $$H_{WPE} = -\sum_{\pi} p_w(\pi)\,\log_2 p_w(\pi),\quad
 *   p_w(\pi) = \frac{\sum_{s:\,\pi_s=\pi} w_s}{\sum_s w_s},\;
 *   w_s = \mathrm{Var}(\text{window}_s)$$
 * A constant series has all weights 0 → returns 0. `normalize` divides by
 * $\log_2(m!)$.
 */
export function weightedPermutationEntropy(
  values: ArrayLike<number>,
  order: number,
  opts: PermutationEntropyOptions = {},
): number {
  const codes = ordinalPatterns(values, order, opts) // reuse validation + Lehmer codes
  const delay = opts.delay ?? 1
  const count = codes.length
  const weightByCode = new Map<number, number>()
  let totalWeight = 0
  for (let s = 0; s < count; s++) {
    let mean = 0
    for (let j = 0; j < order; j++) mean += values[s + j * delay] as number
    mean /= order
    let variance = 0
    for (let j = 0; j < order; j++) {
      const d = (values[s + j * delay] as number) - mean
      variance += d * d
    }
    variance /= order
    const code = codes[s] as number
    weightByCode.set(code, (weightByCode.get(code) ?? 0) + variance)
    totalWeight += variance
  }
  if (!(totalWeight > 0)) return 0 // constant window energy everywhere
  let wpe = 0
  for (const w of weightByCode.values()) {
    if (w > 0) {
      const p = w / totalWeight
      wpe -= p * Math.log2(p)
    }
  }
  return opts.normalize === true ? wpe / Math.log2(FACTORIAL[order] as number) : wpe
}
