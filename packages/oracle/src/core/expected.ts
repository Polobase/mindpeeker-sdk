import { OracleError } from '../errors.js'
import type { Spread, SpreadName } from '../systems/tarot/data.js'
import { TAROT_DECK } from '../systems/tarot/data.js'
import { resolveSpread } from '../systems/tarot/spread.js'
import { MAX_UNIFORM } from './uniform.js'

/** A deal of `count` items from `n` without replacement, optionally one bit per item. */
export interface DealSpec {
  readonly n: number
  readonly count: number
  /** One orientation bit per dealt item, drawn after the deal. Default `false`. */
  readonly reversals?: boolean
}

export interface ExpectedBytesOptions {
  /** Reversal bits for a tarot spread (for a {@link DealSpec}, `spec.reversals` wins). */
  reversals?: boolean
}

/** Expected bytes of one `uniformInt(m)`: $k_m / \alpha_m$, and 0 for $m = 1$. */
function expectedUniformBytes(m: number): number {
  if (m <= 1) return 0
  let k = 1
  let range = 256
  while (range < m) {
    k++
    range *= 256
  }
  const accepted = Math.floor(range / m) * m
  return (k * range) / accepted
}

/**
 * Expected byte consumption of a rejection-sampled deal — what to budget
 * for a finite recorded batch. Casting from fewer bytes risks
 * `insufficient_entropy`; the actual count is random (geometric tails).
 *
 * For a deal of $c$ items from $n$ (`drawWithoutReplacement`), step
 * $i$ draws `uniformInt(m)` with $m = n - i$: attempts of
 * $k_m = \lceil \log_{256} m \rceil$ bytes, each accepted with probability
 * $\alpha_m = \lfloor 256^{k_m}/m \rfloor \, m / 256^{k_m}$, so
 * $$E[\text{bytes}] = \sum_{i=0}^{c-1} \frac{k_{n-i}}{\alpha_{n-i}}
 *   + [\text{reversals}] \left\lceil \frac{c}{8} \right\rceil,$$
 * where the $m = 1$ term is $0$ and the reversal bits cost exactly
 * $\lceil c/8 \rceil$ bytes (one fresh MSB-first bit reader after the deal).
 * A tarot spread is the deal $n = 78$, $c = $ its position count — a Celtic
 * Cross with reversals expects $\approx 13.63$ bytes. `{ n: W, count: 1 }`
 * is the expected cost of one `uniformInt(W)` / `weightedIndexRational`
 * with total $W$.
 *
 * The result is the float value of an exact rational. Rune merkstave bits
 * are not covered (they depend on which runes were drawn).
 *
 * @throws OracleError `'invalid_spread'` for an invalid spread / name
 * @throws OracleError `'invalid_input'` unless $0 \le c \le n \le 2^{48}$ are
 *   integers (the {@link uniformInt} bound — `drawWithoutReplacement` itself
 *   accepts $n \le 2^{32}$) and `reversals` is a boolean when present
 */
export function expectedBytes(
  spec: DealSpec | Spread | SpreadName,
  opts: ExpectedBytesOptions = {},
): number {
  let n: number
  let count: number
  let reversals: unknown
  if (
    typeof spec === 'string' ||
    (typeof spec === 'object' && spec !== null && 'positions' in spec)
  ) {
    n = TAROT_DECK.length
    count = resolveSpread(spec).positions.length
    reversals = opts?.reversals
  } else if (typeof spec === 'object' && spec !== null) {
    n = spec.n
    count = spec.count
    reversals = spec.reversals ?? opts?.reversals
  } else {
    throw new OracleError(
      'invalid_input',
      'expectedBytes needs a deal spec, spread, or spread name',
    )
  }
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > MAX_UNIFORM) {
    throw new OracleError(
      'invalid_input',
      `expectedBytes n must be an integer in [0, 2^48], got ${n}`,
    )
  }
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > n) {
    throw new OracleError(
      'invalid_input',
      `expectedBytes count must be an integer in [0, n=${n}], got ${count}`,
    )
  }
  if (reversals !== undefined && typeof reversals !== 'boolean') {
    throw new OracleError('invalid_input', 'expectedBytes reversals must be a boolean')
  }
  let total = 0
  for (let i = 0; i < count; i++) total += expectedUniformBytes(n - i)
  return reversals === true ? total + Math.ceil(count / 8) : total
}
