import { RateError } from './errors.js'
import { TAU } from './types.js'

/**
 * Sum of unit phasors, returned as its Cartesian components
 * $\big(\sum_j \cos\theta_j,\ \sum_j \sin\theta_j\big)$. Shared kernel for the
 * directional statistics below (Mardia & Jupp, *Directional Statistics*, 2000,
 * §2.2).
 */
function phasorSum(phases: ArrayLike<number>): { c: number; s: number; n: number } {
  const n = phases.length
  let c = 0
  let s = 0
  for (let i = 0; i < n; i++) {
    const theta = phases[i] as number
    c += Math.cos(theta)
    s += Math.sin(theta)
  }
  return { c, s, n }
}

/**
 * The **mean resultant length** $\bar R \in [0, 1]$ of a set of angles:
 *
 * $$\bar R = \frac{1}{n}\left|\sum_{j=1}^{n} e^{i\theta_j}\right|
 *          = \frac{1}{n}\sqrt{\Big(\sum_j\cos\theta_j\Big)^2
 *                            + \Big(\sum_j\sin\theta_j\Big)^2}$$
 *
 * $\bar R = 1$ iff all angles coincide; $\bar R = 0$ for perfectly balanced
 * directions. It is the concentration summary underlying circular variance and
 * the von Mises MLE (Mardia & Jupp §2.2.1).
 *
 * @throws {RateError} `invalid_rate` if `phases` is empty.
 */
export function resultantLength(phases: ArrayLike<number>): number {
  const { c, s, n } = phasorSum(phases)
  if (n === 0) throw new RateError('invalid_rate', 'resultantLength needs at least one angle')
  return Math.hypot(c, s) / n
}

/**
 * The **circular mean** direction:
 *
 * $$\bar\theta = \operatorname{atan2}\!\Big(\sum_j \sin\theta_j,\ \sum_j
 *   \cos\theta_j\Big) \bmod 2\pi$$
 *
 * Returned in $[0, 2\pi)$. Undefined when the resultant is (near) zero; this
 * function still returns `atan2(0, 0) = 0` in that degenerate case, so pair it
 * with {@link resultantLength} to gate on concentration (Mardia & Jupp §2.2.1).
 *
 * @throws {RateError} `invalid_rate` if `phases` is empty.
 */
export function circularMean(phases: ArrayLike<number>): number {
  const { c, s, n } = phasorSum(phases)
  if (n === 0) throw new RateError('invalid_rate', 'circularMean needs at least one angle')
  const mean = Math.atan2(s, c)
  // atan2 returns (-pi, pi]; shift the negative half up by TAU. A tiny negative
  // mean (e.g. -7e-17, below ulp(TAU)/2) would round `mean + TAU` to exactly
  // TAU and break the half-open [0, 2pi) contract — wrap it back to 0, the
  // nearest representable direction (TAU and 0 are the same point on S^1).
  const wrapped = mean < 0 ? mean + TAU : mean
  return wrapped >= TAU ? 0 : wrapped
}

/**
 * The **circular variance** $V = 1 - \bar R \in [0, 1]$ (Mardia & Jupp
 * §2.3.1). $V = 0$ when all angles coincide, $V = 1$ when the resultant
 * vanishes. This matches `scipy.stats.circvar` with its default full-circle
 * range.
 *
 * @throws {RateError} `invalid_rate` if `phases` is empty.
 */
export function circularVariance(phases: ArrayLike<number>): number {
  return 1 - resultantLength(phases)
}
