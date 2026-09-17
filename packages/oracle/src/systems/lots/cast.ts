import { bitReader } from '../../core/bits.js'
import {
  accountingFrom,
  type CastReaderOptions,
  checkCastOptions,
  withCastReader,
} from '../../core/cast-reader.js'
import type { ByteReader } from '../../core/reader.js'
import { uniformInt } from '../../core/uniform.js'
import { weightedIndex } from '../../core/weighted.js'
import { OracleError } from '../../errors.js'
import type { EntropyAccounting, OracleInput } from '../../types.js'

/**
 * Stick-set sizes: 100 (the usual temple set), 78 (the "Chi Chi" sets
 * exported to the United States from 1915), 60 (the sexagenary-cycle
 * *liushi jiazi* sets common in Taiwanese Mazu temples), 64 (sets keyed to
 * the hexagrams, found in online and some temple variants).
 */
export type LotSticks = 100 | 78 | 60 | 64

const STICKS: readonly LotSticks[] = [100, 78, 60, 64]

/**
 * A throw of the two crescent moon blocks (*jiaobei*), each flat on one side
 * and round on the other:
 *
 * - `'holy'` — one flat, one round (*shengjiao*): the answer is confirmed;
 * - `'twoFlat'` — both flat faces up;
 * - `'twoRound'` — both round faces up.
 *
 * Sources disagree on which double throw is the "angry"/no answer and which
 * the "laughing" one, so the outcomes are named by what lands, not by
 * reading. A block standing on its end (a rethrow) is not modeled.
 */
export type JiaobeiThrow = 'holy' | 'twoFlat' | 'twoRound'

const THROWS: readonly JiaobeiThrow[] = ['holy', 'twoFlat', 'twoRound']

/**
 * Exact fair-block model of one jiaobei throw as dyadic weights over
 * `['holy', 'twoFlat', 'twoRound']`: $P = 2/4, 1/4, 1/4$ (two independent
 * fair blocks; the mixed outcome can happen two ways).
 */
export const JIAOBEI_WEIGHTS: readonly number[] = Object.freeze([2, 1, 1])

/** One shake of the cylinder, with the confirming throw when requested. */
export interface LotAttempt {
  /** The stick that fell, 1-based. */
  readonly lot: number
  /** The jiaobei throw for this stick (absent without `confirm`). */
  readonly blocks?: JiaobeiThrow
}

export interface LotCast extends EntropyAccounting {
  readonly sticks: LotSticks
  /** The final lot: the confirmed stick, else the last stick drawn. */
  readonly lot: number
  /** Present iff `confirm` was requested: whether a holy throw confirmed `lot`. */
  readonly confirmed?: boolean
  /** Every stick drawn, in order, with its throw. */
  readonly attempts: readonly LotAttempt[]
}

/**
 * `signal` aborts the cast with an OracleError `'aborted'` (also on a shared
 * reader); `chunkBytes` (default 32) is requested from a `ByteSource` the
 * cast opens. See {@link CastReaderOptions}.
 */
export interface CastLotOptions extends CastReaderOptions {
  /** Size of the stick set. Default 100. */
  sticks?: LotSticks
  /**
   * Confirm each stick with a jiaobei throw and shake again until a `'holy'`
   * throw: `true` repeats without bound (a finite input can run out), a
   * positive integer $m$ allows at most $m$ sticks. Default `false` (one
   * stick, no throw).
   */
  confirm?: boolean | number
}

/**
 * Kau cim (*qiuqian*, Chinese fortune sticks): shake one numbered stick out
 * of a cylinder, optionally confirming it with the moon blocks and shaking
 * again until the gods say yes. Returns the lot number only — no lot poems.
 *
 * Model and consumption, per attempt: the stick is
 * $1 + $ {@link uniformInt}`(sticks)` (one byte per rejection attempt,
 * accepted with probability $\lfloor 256/n \rfloor n / 256$ — always for 64),
 * then, with `confirm`, one throw via {@link weightedIndex} over
 * {@link JIAOBEI_WEIGHTS} from a fresh MSB-first bit reader (2 bits, one
 * byte). Exact consequences:
 *
 * - every stick is uniform on $1..n$ and independent of the throws, so the
 *   final `lot` is exactly uniform on $1..n$ with or without confirmation;
 * - the number of attempts until confirmation is Geometric(1/2) — mean 2 —
 *   and with `confirm: m` the cast is `confirmed` with probability
 *   $1 - 2^{-m}$.
 *
 * Modeled, not measured: sticks are assumed to fall uniformly and the
 * crescent blocks as fair two-sided pieces; real blocks are asymmetric and
 * no measured probabilities are used.
 *
 * `bitsUsed` = 8 per stick byte (rejected ones included) + 2 per throw.
 *
 * @throws OracleError `'invalid_input'` for `sticks` not in {100, 78, 60,
 *   64}, `confirm` not a boolean or a positive safe integer, a non-object
 *   `opts`, or a reader already used by another cast; plus every
 *   {@link ByteReader} read error
 */
export async function castLot(
  input: OracleInput | ByteReader,
  opts: CastLotOptions = {},
): Promise<LotCast> {
  checkCastOptions(opts, 'castLot')
  const sticks = opts.sticks === undefined ? 100 : opts.sticks
  if (!STICKS.includes(sticks)) {
    throw new OracleError(
      'invalid_input',
      `castLot sticks must be 100, 78, 60, or 64, got ${String(opts.sticks)}`,
    )
  }
  const confirm: unknown = opts.confirm === undefined ? false : opts.confirm
  let maxAttempts: number
  if (typeof confirm === 'boolean') {
    maxAttempts = confirm ? Number.POSITIVE_INFINITY : 1
  } else if (typeof confirm === 'number' && Number.isSafeInteger(confirm) && confirm >= 1) {
    maxAttempts = confirm
  } else {
    throw new OracleError(
      'invalid_input',
      `castLot confirm must be a boolean or a positive integer, got ${String(opts.confirm)}`,
    )
  }
  const confirming = confirm !== false
  return withCastReader(input, opts, async (reader) => {
    const accounting = accountingFrom(reader)
    const attempts: LotAttempt[] = []
    let bitsUsed = 0
    let confirmed = false
    while (attempts.length < maxAttempts && !confirmed) {
      const before = reader.bytesConsumed
      const lot = 1 + (await uniformInt(reader, sticks))
      bitsUsed += 8 * (reader.bytesConsumed - before)
      if (!confirming) {
        attempts.push(Object.freeze({ lot }))
        break
      }
      const bits = bitReader(reader)
      const blocks = THROWS[await weightedIndex(bits, JIAOBEI_WEIGHTS)] as JiaobeiThrow
      bitsUsed += bits.bitsUsed
      attempts.push(Object.freeze({ lot, blocks }))
      confirmed = blocks === 'holy'
    }
    return Object.freeze({
      sticks,
      lot: (attempts[attempts.length - 1] as LotAttempt).lot,
      ...(confirming ? { confirmed } : {}),
      attempts: Object.freeze(attempts),
      ...accounting(),
      bitsUsed,
    })
  })
}
