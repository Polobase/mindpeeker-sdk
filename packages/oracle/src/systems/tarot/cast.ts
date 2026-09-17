import { bitReader } from '../../core/bits.js'
import {
  accountingFrom,
  type CastReaderOptions,
  checkCastOptions,
  withCastReader,
} from '../../core/cast-reader.js'
import { drawWithoutReplacement } from '../../core/draw.js'
import type { ByteReader } from '../../core/reader.js'
import { weightedIndex, weightedIndexRational } from '../../core/weighted.js'
import { OracleError } from '../../errors.js'
import type { EntropyAccounting, OracleInput } from '../../types.js'
import {
  type Spread,
  type SpreadName,
  type SpreadPosition,
  TAROT_DECK,
  type TarotCard,
} from './data.js'
import {
  type ReversalModel,
  type Reversals,
  resolveReversals,
  resolveSignificator,
} from './options.js'
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
  /** The withdrawn Significator, when one was given (never among `cards`). */
  readonly significator?: TarotCard
}

/**
 * `signal` aborts the cast with an OracleError `'aborted'` (also on a shared
 * reader); `chunkBytes` (default 32) is requested from a `ByteSource` the
 * cast opens. See {@link CastReaderOptions}.
 */
export interface CastSpreadOptions extends CastReaderOptions {
  /**
   * Card orientation. `true`: each card reversed with probability exactly
   * $1/2$ (one bit). `{ reversed, upright }`: reversed with probability
   * exactly $r/(r+u)$ — e.g. `{ reversed: 1, upright: 3 }` is 1/4 from two
   * bits per card; a non-power-of-two total such as `{ reversed: 1,
   * upright: 2 }` is rejection-sampled per card. Default off. No canonical
   * reversal rate exists (Waite gives reversed meanings; the Golden Dawn's
   * Book T ignores orientation), so any rate is the caller's pre-registered
   * model.
   */
  reversals?: Reversals
  /**
   * Withdraw this card before the deal — a card id (`'m11'`) or a card of
   * {@link TAROT_DECK} — and deal from the remaining 77 (Waite 1911, Part III
   * §7: the Significator is chosen and laid down first, "then shuffle and cut
   * the rest of the pack"). Choosing it (Waite's court-card rules by age and
   * sex, or a trump matching the question) is up to the caller.
   */
  significator?: string | TarotCard
}

/**
 * Deal a spread without replacement from the 78-card deck — or from the 77
 * cards left after withdrawing a `significator`.
 *
 * Consumption order (fixed, so equal bytes give equal readings): first the
 * Fisher–Yates permutation prefix over the canonical deck order (one
 * {@link drawWithoutReplacement} of `positions.length` cards over $N = 78$,
 * or $N = 77$ with the significator removed and the rest in canonical
 * order — uniform over all $N!/(N-m)!$ ordered deals), then the orientation
 * of each card in deal order:
 *
 * - `reversals: true` — one MSB-first bit per card ($P = 1/2$);
 * - weights with total $2^k$ — $k$ MSB-first bits per card via
 *   {@link weightedIndex} ($P(\text{reversed}) = r/2^k$, bit value
 *   $v \ge u$ ⇒ reversed);
 * - any other total $W$ — one {@link weightedIndexRational} per card
 *   ($P = r/W$, rejection-sampled; `bitsUsed` counts its whole bytes).
 *
 * With $P(\text{reversed}) = 1/2$ the number of equiprobable readings is
 * $$\frac{N!}{(N-m)!} \cdot 2^{m}$$ (and $N!/(N-m)!$ without reversals).
 * Expected consumption: `expectedBytes(spread, { reversals, significator })`.
 *
 * Lifecycle: a reader the cast opens (e.g. a `ByteSource` stream) is closed
 * before the promise settles; a `ByteReader` you pass in stays open.
 *
 * @param spreadOrName a {@link SpreadName} key of {@link SPREADS}, or any
 *   custom {@link Spread} object with at least 1 and at most 78 positions
 *   (77 with a significator; the result carries a frozen copy of it)
 * @throws OracleError `'invalid_spread'` for unknown names (inherited keys
 *   such as `'constructor'` included) and malformed, empty, or oversized spreads
 * @throws OracleError `'invalid_input'` for invalid `reversals` (non-boolean
 *   non-object, negative/non-integer/all-zero weights), an unknown
 *   `significator`, a non-object `opts`, or a reader already used by another
 *   cast; plus every {@link ByteReader} read error
 */
export async function castSpread(
  input: OracleInput | ByteReader,
  spreadOrName: SpreadName | Spread = 'single',
  opts: CastSpreadOptions = {},
): Promise<SpreadCast> {
  const spread = resolveSpread(spreadOrName)
  checkCastOptions(opts, 'castSpread')
  const reversals = resolveReversals(opts.reversals)
  const significator = resolveSignificator(opts.significator)
  const deck =
    significator === undefined ? TAROT_DECK : TAROT_DECK.filter((c) => c !== significator)
  if (spread.positions.length > deck.length) {
    throw new OracleError(
      'invalid_spread',
      `spread has ${spread.positions.length} positions but only ${deck.length} cards remain after the significator`,
    )
  }
  return withCastReader(input, opts, (reader) =>
    dealFrom(reader, spread, deck, reversals, significator),
  )
}

async function orientations(
  reader: ByteReader,
  count: number,
  model: ReversalModel,
): Promise<{ flags: boolean[]; bitsUsed: number }> {
  const flags: boolean[] = []
  if (model.bitsPerCard !== null) {
    const bits = bitReader(reader)
    for (let i = 0; i < count; i++) flags.push((await weightedIndex(bits, model.weights)) === 1)
    return { flags, bitsUsed: bits.bitsUsed }
  }
  const before = reader.bytesConsumed
  for (let i = 0; i < count; i++) {
    flags.push((await weightedIndexRational(reader, model.weights)) === 1)
  }
  return { flags, bitsUsed: 8 * (reader.bytesConsumed - before) }
}

async function dealFrom(
  reader: ByteReader,
  spread: Spread,
  deck: readonly TarotCard[],
  reversals: ReversalModel | null,
  significator: TarotCard | undefined,
): Promise<SpreadCast> {
  const count = spread.positions.length
  const accounting = accountingFrom(reader)
  const startBytes = reader.bytesConsumed
  const indices = await drawWithoutReplacement(reader, deck.length, count)
  let bitsUsed = 8 * (reader.bytesConsumed - startBytes)

  let reversedFlags: readonly boolean[] = indices.map(() => false)
  if (reversals !== null) {
    const drawn = await orientations(reader, count, reversals)
    reversedFlags = drawn.flags
    bitsUsed += drawn.bitsUsed
  }

  const cards = indices.map((cardIndex, i) =>
    Object.freeze({
      card: deck[cardIndex] as TarotCard,
      reversed: reversedFlags[i] as boolean,
      position: spread.positions[i] as SpreadPosition,
    }),
  )

  return Object.freeze({
    spread,
    cards: Object.freeze(cards),
    ...(significator !== undefined ? { significator } : {}),
    ...accounting(),
    bitsUsed,
  })
}
