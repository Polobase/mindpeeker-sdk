/**
 * Almost-coincidences (Diaconis & Mosteller 1989, Problem 4): two of n
 * uniform points among c equally spaced positions fall within d of each other
 * — birthdays within a day, events within a week.
 */
import { CoincidenceError } from './errors.js'
import { lnFallingOverPower, oneMinusExp, reachesTarget } from './internal/numerics.js'
import { smallestSatisfying } from './internal/search.js'
import {
  nonNegativeInteger,
  optionsObject,
  positiveFinite,
  positiveInteger,
  targetProbability,
} from './internal/validate.js'
import type { NearMatchOptions, NearTopology } from './types.js'

function topologyOf(options: NearMatchOptions | undefined): NearTopology {
  const opts = optionsObject<NearMatchOptions>('options', options)
  const topology = opts.topology ?? 'circle'
  if (topology !== 'circle' && topology !== 'line') {
    throw new CoincidenceError(
      'invalid_input',
      `options.topology must be 'circle' or 'line', got ${String(topology)}`,
      { argument: 'options.topology' },
    )
  }
  return topology
}

function lnNearNoMatch(n: number, c: number, d: number, topology: NearTopology): number {
  if (n <= 1) return 0
  if (topology === 'circle') {
    if (2 * d + 1 >= c || n * (d + 1) > c) return Number.NEGATIVE_INFINITY
    // ∏_{i=1}^{n−1} (c − nd − i)/c
    return lnFallingOverPower(c - n * d - 1, n - 1, c)
  }
  const a = c - (n - 1) * d
  if (a < n) return Number.NEGATIVE_INFINITY
  // ∏_{i=0}^{n−1} (c − (n−1)d − i)/c
  return lnFallingOverPower(a, n, c)
}

/**
 * Exact probability that **no two** of n independent uniform points among c
 * positions lie within distance d of each other (distance ≤ d counts as a
 * near match; d = 0 is the birthday problem).
 *
 * - `circle` (default; position c neighbours position 1, as calendar days do):
 *   Abramson & Moser (1970),
 *   $$P = \frac{(c - nd - 1)!}{(c - n(d+1))!\;c^{\,n-1}} = \prod_{i=1}^{n-1}\Bigl(1 - \frac{nd + i}c\Bigr),$$
 *   0 when $n(d+1) > c$ or ($n \ge 2$ and $2d + 1 \ge c$).
 * - `line` (an interval without wrap-around):
 *   $$P = \frac{(c - (n-1)d)!}{(c - (n-1)d - n)!\;c^{\,n}},$$
 *   0 when $c - (n-1)d < n$.
 *
 * Both closed forms are confirmed against brute-force enumeration in the
 * fixtures generator.
 *
 * @param n points (people), a non-negative safe integer
 * @param c positions (days), a positive safe integer
 * @param d closeness window, a non-negative safe integer
 */
export function nearNoMatch(n: number, c: number, d: number, options?: NearMatchOptions): number {
  nonNegativeInteger('n', n)
  positiveInteger('c', c)
  nonNegativeInteger('d', d)
  return Math.exp(lnNearNoMatch(n, c, d, topologyOf(options)))
}

/**
 * Exact probability that at least two of n uniform points among c positions
 * lie within distance d; see {@link nearNoMatch}. With 365 days, 14 people
 * give a birthday within one day of another with probability 0.5375
 * (Abramson & Moser's "14 people suffice").
 */
export function nearMatch(n: number, c: number, d: number, options?: NearMatchOptions): number {
  nonNegativeInteger('n', n)
  positiveInteger('c', c)
  nonNegativeInteger('d', d)
  return oneMinusExp(lnNearNoMatch(n, c, d, topologyOf(options)))
}

/**
 * Smallest n with exact `nearMatch(n, c, d) ≥ p`. `peopleForNearMatch(0.5, 365, 1)`
 * is 14; within a week (d = 7) it is 7.
 */
export function peopleForNearMatch(
  p: number,
  c: number,
  d: number,
  options?: NearMatchOptions,
): number {
  targetProbability('p', p)
  positiveInteger('c', c)
  nonNegativeInteger('d', d)
  const topology = topologyOf(options)
  // first n at which the no-match probability is exactly 0
  const hi =
    topology === 'circle'
      ? 2 * d + 1 >= c
        ? 2
        : Math.floor(c / (d + 1)) + 1
      : Math.floor((c + d) / (d + 1)) + 1
  if (p === 1) return hi
  const guess = Math.sqrt((-2 * c * Math.log1p(-p)) / (2 * d + 1))
  return smallestSatisfying((n) => reachesTarget(lnNearNoMatch(n, c, d, topology), p), 1, hi, guess)
}

/**
 * Diaconis & Mosteller's approximation after Sevast'yanov (1972), eq. 7.6:
 * about $\sqrt{2\ln(1/(1-p))\,c/(2d+1)}$ points give probability p of a near
 * match within d. At p = ½ the multiplier is $\sqrt{2\ln 2} = 1.1774$, which
 * Diaconis & Mosteller round to 1.2: for d = 1 and c = 365 this returns 12.99
 * (their 13.2) against the exact 14. Returns a real number; `Infinity` for p = 1.
 *
 * @param c positions, a finite number > 0
 */
export function peopleForNearMatchApprox(p: number, c: number, d: number): number {
  targetProbability('p', p)
  positiveFinite('c', c)
  nonNegativeInteger('d', d)
  if (p === 1) return Number.POSITIVE_INFINITY
  return Math.sqrt((-2 * c * Math.log1p(-p)) / (2 * d + 1))
}
