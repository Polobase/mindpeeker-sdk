import { NegentropyError } from '../errors.js'
import { KahanSum } from '../internal/kahan.js'

/** ½·ln(2πe) — the differential entropy of a unit-variance Gaussian, in nats. */
const HALF_LN_2PIE = 1.4189385332046727

/**
 * Vasicek m-spacings differential entropy estimate (nats):
 * H = (1/n)Σ ln((n/(2m))·(x₍ᵢ₊ₘ₎ − x₍ᵢ₋ₘ₎)) with boundary clamping, matching
 * scipy's `differential_entropy(method='vasicek')`. Default window
 * m = ⌊√n + ½⌋. Negatively biased at small n; scale-equivariant:
 * H(a·x) = H(x) + ln|a|.
 *
 * Lattice-valued data (bytes, trial sums) has ties → zero spacings → −∞;
 * dither it first (see `ditheredTrialZ`/`probitBytes`).
 */
export function vasicekEntropy(x: ArrayLike<number>, m?: number): number {
  const n = x.length
  if (n < 4) {
    throw new NegentropyError('insufficient_data', `vasicekEntropy needs ≥ 4 samples, got ${n}`)
  }
  const window = m ?? Math.floor(Math.sqrt(n) + 0.5)
  if (!Number.isInteger(window) || window < 1 || window >= n / 2) {
    throw new NegentropyError(
      'invalid_config',
      `m-spacings window must be an integer in [1, n/2), got ${window} for n=${n}`,
    )
  }
  const sorted = Float64Array.from(x as ArrayLike<number>)
  sorted.sort()
  const acc = new KahanSum()
  const scale = n / (2 * window)
  for (let i = 0; i < n; i++) {
    const lo = sorted[Math.max(0, i - window)] as number
    const hi = sorted[Math.min(n - 1, i + window)] as number
    const spacing = hi - lo
    if (!(spacing > 0)) {
      throw new NegentropyError(
        'insufficient_data',
        'zero m-spacing (tied samples) — lattice-valued input must be dithered first',
      )
    }
    acc.add(Math.log(scale * spacing))
  }
  return acc.value / n
}

/**
 * Negentropy against the maximum-entropy Gaussian of equal (population)
 * variance: J = ½ln(2πeσ̂²) − Ĥ_vasicek(x). Scale-invariant; can dip slightly
 * negative from estimator bias — not clamped, by honesty.
 */
export function negentropyVasicek(x: ArrayLike<number>, m?: number): number {
  const h = vasicekEntropy(x, m)
  const n = x.length
  let sum = 0
  for (let i = 0; i < n; i++) sum += x[i] as number
  const mean = sum / n
  let m2 = 0
  for (let i = 0; i < n; i++) m2 += ((x[i] as number) - mean) ** 2
  const variance = m2 / n
  return HALF_LN_2PIE + 0.5 * Math.log(variance) - h
}
