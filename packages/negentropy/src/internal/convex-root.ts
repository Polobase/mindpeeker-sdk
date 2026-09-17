/**
 * Root finding for the time-uniform boundaries. Every log e-process used here
 * is convex in its running statistic (the log of a mixture of exponentials in
 * that statistic), so Newton's method started on the side where f ≥ 0 moves
 * monotonically toward the root and never crosses it — the returned point
 * keeps f ≥ 0, i.e. the boundary is never reported on the anti-conservative
 * side of the exact root. A bisection fallback guards against rounding.
 */
import { NegentropyError } from '../errors.js'

const MAX_ITER = 400
const MAX_EXPANSIONS = 2000
const REL_TOL = 1e-13

function unsolved(what: string): never {
  throw new NegentropyError('numerical', `${what} did not converge — please report this input`)
}

/**
 * Walk from `start` in `direction` (±1) with a doubling step until f ≥ 0.
 * `start` must satisfy f < 0; returns the first point with f ≥ 0.
 */
export function expandToNonNegative(
  f: (x: number) => number,
  start: number,
  initialStep: number,
  direction: 1 | -1,
): number {
  let step = initialStep
  let x = start + direction * step
  for (let i = 0; i < MAX_EXPANSIONS; i++) {
    if (f(x) >= 0) return x
    step *= 2
    x = start + direction * step
    if (!Number.isFinite(x)) break
  }
  return unsolved('boundary bracket expansion')
}

/**
 * Root of a convex function that is strictly monotone between `pos` (f ≥ 0)
 * and `neg` (f < 0), found by Newton steps from the `pos` side. Returns a
 * point with f ≥ 0 within ~1e-13 relative of the root.
 */
export function convexRoot(
  f: (x: number) => number,
  df: (x: number) => number,
  pos: number,
  neg: number,
): number {
  let p = pos
  let n = neg
  let fp = f(p)
  if (!(fp >= 0)) return unsolved('boundary root (no sign change)')
  for (let i = 0; i < MAX_ITER; i++) {
    const scale = REL_TOL * Math.max(1, Math.abs(p))
    if (fp === 0 || Math.abs(p - n) <= scale) return p
    const step = fp / df(p)
    // a converged Newton iterate: the remaining step is below the resolution
    if (Math.abs(step) <= scale) return p
    let next = p - step
    const between = n < p ? next > n && next < p : next < n && next > p
    if (!Number.isFinite(next) || !between) next = (p + n) / 2
    const fn = f(next)
    if (fn >= 0) {
      const moved = Math.abs(next - p)
      p = next
      fp = fn
      if (moved <= scale) return p
    } else {
      n = next
    }
  }
  return unsolved('boundary root')
}
