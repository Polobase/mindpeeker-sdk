/**
 * Binomial distribution: pmf via Loader's saddle-point algorithm (the one
 * behind R's dbinom — stirlerr + bd0, relative accuracy ~1e-14 even for
 * n ≫ 10⁹), tails via the regularized incomplete beta.
 */
import { NegentropyError } from '../errors.js'
import { assertNotNaN } from './assert.js'
import { betaInc } from './beta.js'
import { stirlingCorrection } from './gamma.js'

const LN_2PI = 1.8378770664093453 // ln(2π)

// stirlerr(n) = ln n! − [(n + ½)ln n − n + ½ln 2π] for n = 0…15 (mpmath, 40 digits; n = 0 unused)
const STIRLERR = [
  0.0, 0.08106146679532726, 0.0413406959554093, 0.02767792568499834, 0.020790672103765093,
  0.016644691189821193, 0.013876128823070748, 0.01189670994589177, 0.010411265261972096,
  0.009255462182712733, 0.00833056343336287, 0.007573675487951841, 0.00694284010720953,
  0.006408994188004207, 0.0059513701127588475, 0.005554733551962801,
]

function stirlerr(n: number): number {
  return n < STIRLERR.length ? (STIRLERR[n] as number) : stirlingCorrection(n)
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
 * Binomial pmf with the success probability p and its complement q passed
 * separately (callers with p = 2^−h near 1 can supply an exact q).
 * Integer 0 ≤ k ≤ n assumed.
 */
export function binomialPmfPq(k: number, n: number, p: number, q: number): number {
  if (p === 0) return k === 0 ? 1 : 0
  if (q === 0) return k === n ? 1 : 0
  if (k === 0) return Math.exp(n * Math.log(q))
  if (k === n) return Math.exp(n * Math.log(p))
  const lc = stirlerr(n) - stirlerr(k) - stirlerr(n - k) - bd0(k, n * p) - bd0(n - k, n * q)
  const lf = LN_2PI + Math.log(k) + Math.log1p(-k / n)
  return Math.exp(lc - 0.5 * lf)
}

function validateBinomial(fn: string, k: number, n: number, p: number): void {
  assertNotNaN(k, `${fn}: k`)
  assertNotNaN(p, `${fn}: p`)
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new NegentropyError(
      'invalid_config',
      `${fn}: n must be a non-negative safe integer, got ${n}`,
    )
  }
  if (!(p >= 0 && p <= 1)) {
    throw new NegentropyError('invalid_config', `${fn}: p must be in [0, 1], got ${p}`)
  }
}

/**
 * Binomial probability mass P(X = k) for X ~ Binomial(n, p). Non-integer or
 * out-of-range k has mass 0.
 */
export function binomialPmf(k: number, n: number, p: number): number {
  validateBinomial('binomialPmf', k, n, p)
  if (!Number.isInteger(k) || k < 0 || k > n) return 0
  return binomialPmfPq(k, n, p, 1 - p)
}

/**
 * Binomial CDF P(X ≤ k) for X ~ Binomial(n, p); k is floored (so ±∞ give the
 * exact limits). Computed as $I_{1-p}(n-k,\,k+1)$ — exact tails, no normal
 * approximation.
 */
export function binomialCdf(k: number, n: number, p: number): number {
  validateBinomial('binomialCdf', k, n, p)
  const j = Math.floor(k)
  if (j < 0) return 0
  if (j >= n) return 1
  if (p === 0) return 1
  if (p === 1) return 0
  return betaInc(n - j, j + 1, 1 - p)
}

/**
 * Binomial survival function P(X > k) (strictly greater, the scipy `sf`
 * convention) for X ~ Binomial(n, p); k is floored. Computed as
 * $I_p(k+1,\,n-k)$, so tiny upper tails keep full relative precision.
 */
export function binomialSf(k: number, n: number, p: number): number {
  validateBinomial('binomialSf', k, n, p)
  const j = Math.floor(k)
  if (j < 0) return 1
  if (j >= n) return 0
  if (p === 0) return 0
  if (p === 1) return 1
  return betaInc(j + 1, n - j, p)
}
