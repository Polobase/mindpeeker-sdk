/**
 * Smallest integer n in [lo, hi] with `holds(n)`, for a predicate that is
 * monotone (false … false, true … true) and true at `hi`. Starts at `guess`
 * (clamped into range), gallops outward with doubling steps to bracket the
 * boundary, then bisects — O(log |answer − guess|) evaluations, which keeps
 * expensive exact evaluations close to a good approximation.
 */
export function smallestSatisfying(
  holds: (n: number) => boolean,
  lo: number,
  hi: number,
  guess: number,
): number {
  const start = Math.min(hi, Math.max(lo, Math.round(guess)))
  // Invariant after bracketing: holds(right) is true; left < lo or holds(left) is false.
  let left: number
  let right: number
  if (holds(start)) {
    right = start
    let step = 1
    left = start - step
    while (left >= lo && holds(left)) {
      right = left
      step *= 2
      left = right - step
    }
    left = Math.max(left, lo - 1)
  } else {
    left = start
    let step = 1
    right = start + step
    while (right < hi && !holds(right)) {
      left = right
      step *= 2
      right = left + step
    }
    right = Math.min(right, hi)
  }
  while (right - left > 1) {
    const mid = left + Math.floor((right - left) / 2)
    if (holds(mid)) right = mid
    else left = mid
  }
  return right
}
