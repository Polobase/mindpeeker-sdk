/**
 * NIST SP 800-90B §4.4 continuous health-test cutoffs at the recommended
 * per-sample false-positive probability α = 2⁻²⁰.
 *
 * The APT computation is a port of `@mindpeeker/negentropy`'s exact log-space
 * algorithm (entropy stays dependency-free, so the code is duplicated rather
 * than imported); a cross-package test asserts both agree cutoff for cutoff.
 */
import { EntropyError } from '../errors.js'

/** Per-sample false-positive probability of each continuous test. */
export const HEALTH_ALPHA = 2 ** -20

const LN_2PI = 1.8378770664093453 // ln(2π)

// stirlerr(n) = ln n! − [(n + ½)ln n − n + ½ln 2π] for n = 0…15 (n = 0 unused)
const STIRLERR = [
  0.0, 0.08106146679532726, 0.0413406959554093, 0.02767792568499834, 0.020790672103765093,
  0.016644691189821193, 0.013876128823070748, 0.01189670994589177, 0.010411265261972096,
  0.009255462182712733, 0.00833056343336287, 0.007573675487951841, 0.00694284010720953,
  0.006408994188004207, 0.0059513701127588475, 0.005554733551962801,
]

// Stirling-series coefficients B_2j / (2j(2j−1)), j = 1…8
const STIRLING = [
  1 / 12,
  -1 / 360,
  1 / 1260,
  -1 / 1680,
  1 / 1188,
  -691 / 360360,
  1 / 156,
  -3617 / 122400,
]

function stirlerr(n: number): number {
  if (n < STIRLERR.length) return STIRLERR[n] as number
  const inv = 1 / n
  const inv2 = inv * inv
  let sum = 0
  for (let j = STIRLING.length - 1; j >= 0; j--) sum = sum * inv2 + (STIRLING[j] as number)
  return sum * inv
}

/** Loader's bd0(x, M) = x·ln(x/M) + M − x, stable when x ≈ M. */
function bd0(x: number, np: number): number {
  if (Math.abs(x - np) < 0.1 * (x + np)) {
    let v = (x - np) / (x + np)
    let s = (x - np) * v
    if (Math.abs(s) < Number.MIN_VALUE) return s
    let ej = 2 * x * v
    v *= v
    for (let j = 1; j < 1000; j++) {
      ej *= v
      const next = s + ej / (2 * j + 1)
      if (next === s) return next
      s = next
    }
  }
  return x * Math.log(x / np) + np - x
}

/**
 * Binomial pmf P(X = k), X ~ Binomial(n, p), by Loader's saddle-point
 * algorithm (the one behind R's `dbinom`), with p and its complement q passed
 * separately so p = 2⁻ᴴ near 1 keeps an exact q. Integer 0 ≤ k ≤ n assumed.
 */
function binomialPmfPq(k: number, n: number, p: number, q: number): number {
  if (p === 0) return k === 0 ? 1 : 0
  if (q === 0) return k === n ? 1 : 0
  if (k === 0) return Math.exp(n * Math.log(q))
  if (k === n) return Math.exp(n * Math.log(p))
  const lc = stirlerr(n) - stirlerr(k) - stirlerr(n - k) - bd0(k, n * p) - bd0(n - k, n * q)
  const lf = LN_2PI + Math.log(k) + Math.log1p(-k / n)
  return Math.exp(lc - 0.5 * lf)
}

function validateH(fn: string, h: number): void {
  if (typeof h !== 'number' || !Number.isFinite(h) || !(h > 0)) {
    throw new EntropyError(
      'invalid_request',
      `${fn}: min-entropy H must be a finite number > 0, got ${String(h)}`,
    )
  }
}

/**
 * SP 800-90B §4.4.1 Repetition Count Test cutoff $C = 1 + \lceil 20/H \rceil$
 * at α = 2⁻²⁰, for H in bits per sample (finite, > 0).
 */
export function rctCutoff(h: number): number {
  validateH('rctCutoff', h)
  const cutoff = 1 + Math.ceil(20 / h)
  if (!Number.isSafeInteger(cutoff)) {
    throw new EntropyError('invalid_request', `rctCutoff: H = ${h} gives an unrepresentable cutoff`)
  }
  return cutoff
}

/**
 * SP 800-90B §4.4.2 Adaptive Proportion Test cutoff
 * $C = 1 + \mathrm{CRITBINOM}(W, 2^{-H}, 1 - \alpha)$: one plus the smallest k
 * with $P(\mathrm{Binomial}(W, 2^{-H}) > k) \le 2^{-20}$.
 *
 * Exact at every H > 0: the upper tail is summed from k = W downward, with
 * p = 2⁻ᴴ and q = −expm1(−H·ln 2) kept separate, so neither the lower tail
 * underflowing float64 nor 2⁻ᴴ rounding to 1 can silently disable the test.
 * A result of W + 1 is the exact answer — the test cannot fire — and happens
 * precisely when $p^W > \alpha$, i.e. H < 20/W (0.039 bits at W = 512).
 */
export function aptCutoff(h: number, windowSize: number): number {
  validateH('aptCutoff', h)
  if (!Number.isSafeInteger(windowSize) || windowSize < 1) {
    throw new EntropyError(
      'invalid_request',
      `aptCutoff: windowSize must be a positive integer, got ${String(windowSize)}`,
    )
  }
  const p = 2 ** -h
  const q = -Math.expm1(-h * Math.LN2)
  let tail = 0 // P(X > k) for the current k
  for (let k = windowSize; k >= 0; k--) {
    const mass = binomialPmfPq(k, windowSize, p, q)
    if (tail + mass > HEALTH_ALPHA) return 1 + k
    tail += mass
  }
  return 1
}
