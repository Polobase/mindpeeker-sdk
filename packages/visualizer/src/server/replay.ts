/**
 * Late-joiner replay under the per-socket buffered-amount budget. Pure (no
 * sockets), so the selection rule is unit-tested exactly.
 */

/**
 * Choose which retained frames a newly connected socket is sent, so the
 * replay alone can never push its buffered amount past the budget.
 *
 * `rings[c]` is channel `c`'s retained frames, oldest first. Frames are taken
 * newest first, one per channel per round (round-robin in channel order, so
 * every channel gets a share of a tight budget), while the running total of
 * `byteLength`s stays within `budget`. A channel whose next-older frame does
 * not fit stops there — the replay of each channel is always a contiguous
 * **newest** suffix, so it joins the live frames that follow without a gap.
 * Returns per channel the chosen frames, oldest first; a budget ≤ 0 (or NaN)
 * replays nothing.
 */
export function planReplay<T extends { readonly byteLength: number }>(
  rings: readonly (readonly T[])[],
  budget: number,
): T[][] {
  const chosen: T[][] = rings.map(() => [])
  let remaining = budget > 0 ? budget : 0
  const next = rings.map((ring) => ring.length - 1)
  let open = rings.filter((ring) => ring.length > 0).length
  const closed = rings.map((ring) => ring.length === 0)
  while (open > 0) {
    for (let c = 0; c < rings.length; c++) {
      if (closed[c]) continue
      const index = next[c] as number
      const frame = (rings[c] as readonly T[])[index] as T
      if (frame.byteLength > remaining) {
        closed[c] = true
        open--
        continue
      }
      remaining -= frame.byteLength
      ;(chosen[c] as T[]).push(frame)
      next[c] = index - 1
      if (index === 0) {
        closed[c] = true
        open--
      }
    }
  }
  for (const frames of chosen) frames.reverse()
  return chosen
}
