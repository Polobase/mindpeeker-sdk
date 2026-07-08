import { bitReader } from '../../core/bits.js'
import { drawWithoutReplacement } from '../../core/draw.js'
import { type ByteReader, byteReader } from '../../core/reader.js'
import { OracleError } from '../../errors.js'
import type { EntropyAccounting, OracleInput } from '../../types.js'
import {
  SPREADS,
  type Spread,
  type SpreadName,
  type SpreadPosition,
  TAROT_DECK,
  type TarotCard,
} from './data.js'

/** One drawn card, bound to its spread position. */
export interface DrawnCard {
  readonly card: TarotCard
  /** Always `false` unless the cast requested reversals. */
  readonly reversed: boolean
  readonly position: SpreadPosition
}

export interface SpreadCast extends EntropyAccounting {
  readonly spread: Spread
  /** One card per spread position, in position order. Never repeats a card. */
  readonly cards: readonly DrawnCard[]
}

export interface CastSpreadOptions {
  /**
   * Give each card an orientation bit: reversed with probability exactly
   * $1/2$. Default `false`.
   */
  reversals?: boolean
  /** Aborts the cast with an OracleError `'aborted'`. */
  signal?: AbortSignal
}

/**
 * Deal a spread from a full 78-card deck without replacement.
 *
 * Consumption order (fixed, so equal bytes give equal readings): first the
 * Fisher–Yates permutation prefix over the canonical deck (one
 * {@link drawWithoutReplacement} of `positions.length` cards — uniform over
 * all $78!/(78-m)!$ ordered deals), then, if `reversals`, one MSB-first bit
 * per card in deal order. The number of distinct equiprobable readings is
 * $$\frac{78!}{(78-m)!} \cdot 2^{m \cdot [\text{reversals}]}.$$
 *
 * @param spreadOrName a {@link SpreadName} key of {@link SPREADS}, or any
 *   custom {@link Spread} object with at least 1 and at most 78 positions
 * @throws OracleError `'invalid_spread'` for unknown names or empty/oversized spreads
 */
export async function castSpread(
  input: OracleInput | ByteReader,
  spreadOrName: SpreadName | Spread = 'single',
  opts: CastSpreadOptions = {},
): Promise<SpreadCast> {
  const spread = typeof spreadOrName === 'string' ? SPREADS[spreadOrName] : spreadOrName
  if (spread === undefined) {
    throw new OracleError('invalid_spread', `unknown spread '${String(spreadOrName)}'`)
  }
  const count = spread.positions?.length ?? 0
  if (!Number.isInteger(count) || count < 1 || count > TAROT_DECK.length) {
    throw new OracleError(
      'invalid_spread',
      `spread must have between 1 and ${TAROT_DECK.length} positions, got ${count}`,
    )
  }

  const reader = byteReader(input, { signal: opts.signal })
  const startBytes = reader.bytesConsumed
  const indices = await drawWithoutReplacement(reader, TAROT_DECK.length, count)
  const drawBits = 8 * (reader.bytesConsumed - startBytes)

  let reversedFlags: readonly boolean[]
  let bitsUsed = drawBits
  if (opts.reversals === true) {
    const bits = bitReader(reader)
    const flags: boolean[] = []
    for (let i = 0; i < count; i++) flags.push((await bits.nextBit()) === 1)
    reversedFlags = flags
    bitsUsed += bits.bitsUsed
  } else {
    reversedFlags = indices.map(() => false)
  }

  const cards = indices.map((cardIndex, i) =>
    Object.freeze({
      card: TAROT_DECK[cardIndex] as TarotCard,
      reversed: reversedFlags[i] as boolean,
      position: spread.positions[i] as SpreadPosition,
    }),
  )

  return Object.freeze({
    spread,
    cards: Object.freeze(cards),
    bytesConsumed: reader.bytesConsumed - startBytes,
    bitsUsed,
  })
}
