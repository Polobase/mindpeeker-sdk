/**
 * NIST SP 800-90B §4.4 continuous health-test cutoffs at the recommended
 * false-positive rate α = 2⁻²⁰, shared by `ContinuousHealth` and the
 * `./numerics` subpath (so sibling packages compute identical cutoffs).
 */
import { NegentropyError } from '../errors.js'
import { binomialPmfPq } from './binomial.js'

const ALPHA = 2 ** -20

function validateH(fn: string, h: number): void {
  if (typeof h !== 'number' || !Number.isFinite(h) || !(h > 0)) {
    throw new NegentropyError(
      'invalid_config',
      `${fn}: min-entropy H must be a finite number > 0, got ${h}`,
    )
  }
}

/**
 * SP 800-90B §4.4.1 Repetition Count Test cutoff C = 1 + ⌈20/H⌉ at α = 2⁻²⁰,
 * for H in bits per sample (finite, > 0). Throws `invalid_config` when H is so
 * small that the cutoff is no longer a safe integer.
 */
export function rctCutoff(h: number): number {
  validateH('rctCutoff', h)
  const cutoff = 1 + Math.ceil(20 / h)
  if (!Number.isSafeInteger(cutoff)) {
    throw new NegentropyError(
      'invalid_config',
      `rctCutoff: H = ${h} gives an unrepresentable cutoff`,
    )
  }
  return cutoff
}

/**
 * SP 800-90B §4.4.2 Adaptive Proportion Test cutoff
 * C = 1 + CRITBINOM(W, 2⁻ᴴ, 1 − α): one plus the smallest k with
 * P(Binomial(W, 2⁻ᴴ) > k) ≤ 2⁻²⁰.
 *
 * Exact at every H > 0: the upper tail is summed from k = W downward with
 * Loader's binomial pmf, p = 2⁻ᴴ and its complement q = −expm1(−H·ln 2) taken
 * separately, so neither the lower tail underflowing float64 (0.19⁵¹² ≈ 1e-371)
 * nor 2⁻ᴴ rounding to 1 (H ≲ 1e-16) can silently disable the test.
 *
 * A result of W + 1 is the exact answer — not a numerical fallback — and
 * means the test cannot fire: it happens precisely when p^W > α, i.e.
 * H < 20/W (0.039 bits at W = 512, 0.0195 at W = 1024). Cost O(W).
 */
export function aptCutoff(h: number, windowSize: number): number {
  validateH('aptCutoff', h)
  if (!Number.isSafeInteger(windowSize) || windowSize < 1) {
    throw new NegentropyError(
      'invalid_config',
      `aptCutoff: windowSize must be a positive integer, got ${windowSize}`,
    )
  }
  const p = 2 ** -h
  const q = -Math.expm1(-h * Math.LN2)
  let tail = 0 // P(X > k) for the current k
  for (let k = windowSize; k >= 0; k--) {
    const mass = binomialPmfPq(k, windowSize, p, q)
    if (tail + mass > ALPHA) return 1 + k
    tail += mass
  }
  return 1
}
