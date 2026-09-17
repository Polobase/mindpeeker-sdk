import { OracleError } from '../errors.js'
import type { Spread, SpreadName, TarotCard } from '../systems/tarot/data.js'
import { TAROT_DECK } from '../systems/tarot/data.js'
import {
  type ReversalModel,
  type Reversals,
  resolveReversals,
  resolveSignificator,
} from '../systems/tarot/options.js'
import { resolveSpread } from '../systems/tarot/spread.js'
import { MAX_UNIFORM } from './uniform.js'

/** A deal of `count` items from `n` without replacement, optionally oriented per item. */
export interface DealSpec {
  readonly n: number
  readonly count: number
  /**
   * Orientation per dealt item, drawn after the deal — `true` (one bit) or
   * reversal weights, exactly as `castSpread`'s `reversals`. Default `false`.
   */
  readonly reversals?: Reversals
}

/** The `castSpread` options that change consumption — the same option bag works for both. */
export interface ExpectedBytesOptions {
  /** Reversals for a tarot spread (for a {@link DealSpec}, `spec.reversals` wins). */
  reversals?: Reversals
  /**
   * A withdrawn Significator: the spread is dealt from 77 cards. Spreads
   * only — a {@link DealSpec} states its `n` directly.
   */
  significator?: string | TarotCard
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

/** Expected bytes of the orientation phase for $c$ items. */
function expectedReversalBytes(count: number, model: ReversalModel | null): number {
  if (model === null) return 0
  if (model.bitsPerCard !== null) return Math.ceil((count * model.bitsPerCard) / 8)
  return count * expectedUniformBytes(model.weights[0] + model.weights[1])
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
 * $$E[\text{bytes}] = \sum_{i=0}^{c-1} \frac{k_{n-i}}{\alpha_{n-i}} + R,$$
 * where the $m = 1$ term is $0$ and $R$ is the orientation phase: $0$
 * without reversals; $\lceil c \cdot k / 8 \rceil$ for `true` ($k = 1$) or
 * weights with total $2^k$ (one fresh MSB-first bit reader after the deal);
 * $c \cdot k_W/\alpha_W$ for weights with any other total $W$ (one
 * rejection-sampled draw per card).
 *
 * A tarot spread is the deal $n = 78$ ($77$ with a `significator`),
 * $c = $ its position count — a Celtic Cross with reversals expects
 * $\approx 13.63$ bytes. `{ n: W, count: 1 }` is the expected cost of one
 * `uniformInt(W)` / `weightedIndexRational` with total $W$.
 *
 * The result is the float value of an exact rational. Rune merkstave bits
 * are not covered (they depend on which runes were drawn).
 *
 * @throws OracleError `'invalid_spread'` for an invalid spread / name, or a
 *   78-position spread with a significator
 * @throws OracleError `'invalid_input'` unless $0 \le c \le n \le 2^{48}$ are
 *   integers (the {@link uniformInt} bound — `drawWithoutReplacement` itself
 *   accepts $n \le 2^{32}$), `reversals` is valid as for `castSpread`, and
 *   `significator` names a card and is only given for a spread
 */
export function expectedBytes(
  spec: DealSpec | Spread | SpreadName,
  opts: ExpectedBytesOptions = {},
): number {
  if (typeof opts !== 'object' || opts === null) {
    throw new OracleError('invalid_input', 'expectedBytes options must be an object')
  }
  let n: number
  let count: number
  let reversals: unknown
  if (
    typeof spec === 'string' ||
    (typeof spec === 'object' && spec !== null && 'positions' in spec)
  ) {
    const significator = resolveSignificator(opts.significator)
    n = TAROT_DECK.length - (significator === undefined ? 0 : 1)
    count = resolveSpread(spec).positions.length
    if (count > n) {
      throw new OracleError(
        'invalid_spread',
        `spread has ${count} positions but only ${n} cards remain after the significator`,
      )
    }
    reversals = opts.reversals
  } else if (typeof spec === 'object' && spec !== null) {
    if (opts.significator !== undefined) {
      throw new OracleError(
        'invalid_input',
        'expectedBytes significator applies to spreads only; give a DealSpec its n directly',
      )
    }
    n = spec.n
    count = spec.count
    reversals = spec.reversals ?? opts.reversals
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
  const model = resolveReversals(reversals)
  let total = 0
  for (let i = 0; i < count; i++) total += expectedUniformBytes(n - i)
  return total + expectedReversalBytes(count, model)
}
