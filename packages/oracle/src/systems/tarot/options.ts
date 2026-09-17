import { MAX_UNIFORM } from '../../core/uniform.js'
import { OracleError } from '../../errors.js'
import { TAROT_DECK, type TarotCard } from './data.js'

/**
 * Integer weights for a card's orientation: reversed with probability
 * exactly `reversed / (reversed + upright)`. A total that is a power of two
 * ($2^k$) is drawn from $k$ bits per card; any other total by rejection
 * sampling (one `weightedIndexRational` per card).
 */
export interface ReversalWeights {
  readonly reversed: number
  readonly upright: number
}

/** `true` = reversed with probability 1/2 (1 bit); an object gives other odds. */
export type Reversals = boolean | ReversalWeights

/**
 * Normalized reversal model: weights `[upright, reversed]` (index 1 =
 * reversed) and the bit count per card for a dyadic total, else `null`.
 *
 * @internal
 */
export interface ReversalModel {
  readonly weights: readonly [number, number]
  readonly bitsPerCard: number | null
}

/**
 * Validate a `reversals` option at the public boundary. `undefined` and
 * `false` mean off (`null`); `true` is `{ reversed: 1, upright: 1 }`.
 *
 * @internal
 * @throws OracleError `'invalid_input'` unless a boolean or an object of two
 *   non-negative integers with a total in $[1, 2^{48}]$
 */
export function resolveReversals(value: unknown): ReversalModel | null {
  if (value === undefined || value === false) return null
  if (value === true) return Object.freeze({ weights: [1, 1] as const, bitsPerCard: 1 })
  if (typeof value !== 'object' || value === null) {
    throw new OracleError(
      'invalid_input',
      `reversals must be a boolean or { reversed, upright }, got ${String(value)}`,
    )
  }
  const { reversed, upright } = value as Partial<ReversalWeights>
  for (const [name, w] of [
    ['reversed', reversed],
    ['upright', upright],
  ] as const) {
    if (typeof w !== 'number' || !Number.isSafeInteger(w) || w < 0) {
      throw new OracleError(
        'invalid_input',
        `reversals.${name} must be a non-negative integer, got ${String(w)}`,
      )
    }
  }
  const total = (reversed as number) + (upright as number)
  if (total < 1 || total > MAX_UNIFORM) {
    throw new OracleError(
      'invalid_input',
      `reversals weights must sum to an integer in [1, 2^48], got ${total}`,
    )
  }
  const k = Math.round(Math.log2(total))
  return Object.freeze({
    weights: Object.freeze([upright as number, reversed as number]) as readonly [number, number],
    bitsPerCard: 2 ** k === total ? k : null,
  })
}

/**
 * Validate a `significator` option: a card id (`'m11'`, `'w12'`, …) or a
 * card object from {@link TAROT_DECK} (matched by `id`, so a JSON copy
 * works). Returns the canonical card, or `undefined` when absent.
 *
 * @internal
 * @throws OracleError `'invalid_input'` for anything that names no card
 */
export function resolveSignificator(value: unknown): TarotCard | undefined {
  if (value === undefined) return undefined
  const id =
    typeof value === 'string'
      ? value
      : typeof value === 'object' && value !== null
        ? (value as { id?: unknown }).id
        : undefined
  const card = typeof id === 'string' ? TAROT_DECK.find((c) => c.id === id) : undefined
  if (card === undefined) {
    throw new OracleError(
      'invalid_input',
      `significator must be a card id or card from TAROT_DECK, got ${String(value)}`,
    )
  }
  return card
}
