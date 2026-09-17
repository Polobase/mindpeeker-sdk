import { ceilHalf } from './bigint.js'

/**
 * Estimated modular multiplications for one fold exponentiation $a^{r}$ with a
 * 128-bit challenge $r$ (128 squarings + ~64 multiplies) plus the product with the
 * second branch. Only steers the recompute-vs-checkpoint decision; progress
 * counts squarings.
 */
export const FOLD_WEIGHT = 193

/** Largest round index for which subset-sum leaves are enumerated ($2^{20}$ leaves). */
const MAX_LEAF_LEVEL = 20

/** How one Pietrzak round obtains its midpoint $\mu_i = x_i^{2^{t_i}}$. */
export interface RoundPlan {
  /** Claim length $T_i$ at the start of the round. */
  readonly T: number
  /** $t_i = \lceil T_i/2 \rceil$. */
  readonly half: number
  /** `true`: recombine stored checkpoints; `false`: square $x_i$ $t_i$ times. */
  readonly fromCheckpoints: boolean
  /** Sequential squarings this round performs. */
  readonly squarings: number
}

/** Squarings from the nearest stored power $\le e$: $e - \min(\lfloor e/c \rfloor, m) \cdot c$. */
export function checkpointOffset(e: number, interval: number, lastIndex: number): number {
  return e - Math.min(Math.floor(e / interval), lastIndex) * interval
}

/**
 * Deterministic proving plan for delay $T$, optionally with checkpoints every
 * `interval` squarings (powers $x^{2^{jc}}$, $j \le \lfloor T/c \rfloor$).
 *
 * With checkpoints, round $i$'s midpoint unfolds through
 * $x_{k}^{2^e} = (x_{k-1}^{2^e})^{r_{k-1}} \cdot x_{k-1}^{2^{e + t_{k-1}}}$ into
 * $2^i$ leaves $x^{2^{e_S}}$, $e_S = t_i + \sum_{j \in S} t_j$ for
 * $S \subseteq \{0, \dots, i-1\}$, each a few squarings from a stored power, plus
 * $2^i - 1$ fold exponentiations. The round uses checkpoints iff that costs fewer
 * multiplications than recomputing $t_i$ squarings; since $t_i$ halves while the
 * leaf count doubles, the first round that recomputes ends the checkpoint phase.
 * The plan depends only on $T$ and $c$, so its squaring total is known up front.
 */
export function planPietrzak(T: number, interval?: number): readonly RoundPlan[] {
  const rounds: RoundPlan[] = []
  const lastIndex = interval === undefined ? 0 : Math.floor(T / interval)
  let sums: number[] = [0]
  let useCheckpoints = interval !== undefined
  let t = T
  let level = 0
  while (t > 1) {
    const half = ceilHalf(t)
    let plan: RoundPlan = { T: t, half, fromCheckpoints: false, squarings: half }
    if (useCheckpoints && interval !== undefined) {
      const folds = (sums.length - 1) * FOLD_WEIGHT
      if (level > MAX_LEAF_LEVEL || folds >= half) {
        useCheckpoints = false
      } else {
        let leafSquarings = 0
        for (const s of sums) leafSquarings += checkpointOffset(half + s, interval, lastIndex)
        if (leafSquarings + folds < half) {
          plan = { T: t, half, fromCheckpoints: true, squarings: leafSquarings }
          const next = sums.slice()
          for (const s of sums) next.push(s + half)
          sums = next
        } else {
          useCheckpoints = false
        }
      }
    }
    rounds.push(plan)
    t = half
    level++
  }
  return rounds
}
