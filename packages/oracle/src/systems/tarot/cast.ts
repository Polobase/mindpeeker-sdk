import { bitReader } from '../../core/bits.js'
import {
  accountingFrom,
  type CastReaderOptions,
  checkBooleanOption,
  checkCastOptions,
  withCastReader,
} from '../../core/cast-reader.js'
import { drawWithoutReplacement } from '../../core/draw.js'
import type { ByteReader } from '../../core/reader.js'
import type { EntropyAccounting, OracleInput } from '../../types.js'
import {
  type Spread,
  type SpreadName,
  type SpreadPosition,
  TAROT_DECK,
  type TarotCard,
} from './data.js'
import { resolveSpread } from './spread.js'

/** One drawn card, bound to its spread position. */
export interface DrawnCard {
  readonly card: TarotCard
  /** Always `false` unless the cast requested reversals. */
  readonly reversed: boolean
  readonly position: SpreadPosition
}

export interface SpreadCast extends EntropyAccounting {
  /** The built-in spread, or a frozen copy of a custom spread object. */
  readonly spread: Spread
  /** One card per spread position, in position order. Never repeats a card. */
  readonly cards: readonly DrawnCard[]
}

/**
 * `signal` aborts the cast with an OracleError `'aborted'` (also on a shared
 * reader); `chunkBytes` (default 32) is requested from a `ByteSource` the
 * cast opens. See {@link CastReaderOptions}.
 */
export interface CastSpreadOptions extends CastReaderOptions {
  /**
   * Give each card an orientation bit: reversed with probability exactly
   * $1/2$. Default `false`. Must be a boolean when present.
   */
  reversals?: boolean
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
 * Expected consumption: `expectedBytes(spread, { reversals })`.
 *
 * Lifecycle: a reader the cast opens (e.g. a `ByteSource` stream) is closed
 * before the promise settles; a `ByteReader` you pass in stays open.
 *
 * @param spreadOrName a {@link SpreadName} key of {@link SPREADS}, or any
 *   custom {@link Spread} object with at least 1 and at most 78 positions
 *   (the result carries a frozen copy of it)
 * @throws OracleError `'invalid_spread'` for unknown names (inherited keys
 *   such as `'constructor'` included) and malformed, empty, or oversized spreads
 * @throws OracleError `'invalid_input'` for a non-boolean `reversals`, a
 *   non-object `opts`, or a reader already used by another cast; plus every
 *   {@link ByteReader} read error
 */
export async function castSpread(
  input: OracleInput | ByteReader,
  spreadOrName: SpreadName | Spread = 'single',
  opts: CastSpreadOptions = {},
): Promise<SpreadCast> {
  const spread = resolveSpread(spreadOrName)
  checkCastOptions(opts, 'castSpread')
  checkBooleanOption(opts.reversals, 'reversals')
  const reversals = opts.reversals === true
  return withCastReader(input, opts, (reader) => dealFrom(reader, spread, reversals))
}

async function dealFrom(
  reader: ByteReader,
  spread: Spread,
  reversals: boolean,
): Promise<SpreadCast> {
  const count = spread.positions.length
  const accounting = accountingFrom(reader)
  const startBytes = reader.bytesConsumed
  const indices = await drawWithoutReplacement(reader, TAROT_DECK.length, count)
  const drawBits = 8 * (reader.bytesConsumed - startBytes)

  let reversedFlags: readonly boolean[]
  let bitsUsed = drawBits
  if (reversals) {
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
    ...accounting(),
    bitsUsed,
  })
}
