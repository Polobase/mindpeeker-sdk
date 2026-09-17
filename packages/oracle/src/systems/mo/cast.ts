import {
  accountingFrom,
  type CastReaderOptions,
  checkCastOptions,
  withCastReader,
} from '../../core/cast-reader.js'
import type { ByteReader } from '../../core/reader.js'
import { uniformInt } from '../../core/uniform.js'
import type { EntropyAccounting, OracleInput } from '../../types.js'

/** One face of the Mo die. */
export interface MoSyllable {
  /** Syllable of Manjushri's mantra, as transliterated by Goldberg & Dakpa: `'AH'`, `'RA'`, … */
  readonly syllable: string
  /** Face order on the die, 0–5 (the mantra order AH RA PA TSA NA DHI). */
  readonly index: number
  /** The pips of an ordinary die that stand in for this syllable. */
  readonly pips: number
}

const syllable = (name: string, index: number, pips: number): MoSyllable =>
  Object.freeze({ syllable: name, index, pips })

/**
 * The six faces of the Tibetan Mo die: the syllables of Manjushri's mantra
 * AH RA PA TSA NA DHI, with the ordinary-die equivalents AH 6, RA 2, PA 3,
 * TSA 5, NA 4, DHI 1 (Mipham, *Mo: Tibetan Divination System*, tr. Goldberg
 * & Dakpa, 1990, "Dice Form" — structure only; the translated answer texts
 * are not shipped).
 */
export const MO_SYLLABLES: readonly MoSyllable[] = Object.freeze([
  syllable('AH', 0, 6),
  syllable('RA', 1, 2),
  syllable('PA', 2, 3),
  syllable('TSA', 3, 5),
  syllable('NA', 4, 4),
  syllable('DHI', 5, 1),
])

export interface MoCast extends EntropyAccounting {
  /** First throw — by Mipham's supplementary reading, the inquirer. */
  readonly first: MoSyllable
  /** Second throw — the other party. */
  readonly second: MoSyllable
  /**
   * Answer number 1–36 in the book's key: $6 \cdot \text{first.index} +
   * \text{second.index} + 1$ (AH AH = 1, AH RA = 2, …, RA DHI = 12, …,
   * DHI DHI = 36).
   */
  readonly number: number
}

/**
 * `signal` aborts the cast with an OracleError `'aborted'` (also on a shared
 * reader); `chunkBytes` (default 32) is requested from a `ByteSource` the
 * cast opens. See {@link CastReaderOptions}.
 */
export interface CastMoOptions extends CastReaderOptions {}

/**
 * Tibetan Mo: throw the six-syllable die twice and read the ordered pair —
 * 36 answers, each with probability exactly $1/36$. Each throw is one
 * {@link uniformInt}`(6)`: one byte per attempt, accepted with probability
 * $252/256$ (`bytesConsumed` $\ge 2$, `bitsUsed` $= 8 \cdot$ `bytesConsumed`).
 *
 * The book's confirmation rule — throw two more times: the same pair means a
 * very firm answer, the reversed pair a weak one, a different pair leaves it
 * standing — is a second, independent `castMo` the caller compares.
 *
 * @throws OracleError `'invalid_input'` for a non-object `opts` or a reader
 *   already used by another cast; plus every {@link ByteReader} read error
 */
export async function castMo(
  input: OracleInput | ByteReader,
  opts: CastMoOptions = {},
): Promise<MoCast> {
  checkCastOptions(opts, 'castMo')
  return withCastReader(input, opts, async (reader) => {
    const accounting = accountingFrom(reader)
    const first = MO_SYLLABLES[await uniformInt(reader, 6)] as MoSyllable
    const second = MO_SYLLABLES[await uniformInt(reader, 6)] as MoSyllable
    const counts = accounting()
    return Object.freeze({
      first,
      second,
      number: 6 * first.index + second.index + 1,
      ...counts,
      bitsUsed: 8 * counts.bytesConsumed,
    })
  })
}
