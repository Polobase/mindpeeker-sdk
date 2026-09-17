import { bitReader } from '../../core/bits.js'
import {
  accountingFrom,
  type CastReaderOptions,
  checkCastOptions,
  withCastReader,
} from '../../core/cast-reader.js'
import type { ByteReader } from '../../core/reader.js'
import { OracleError } from '../../errors.js'
import type { EntropyAccounting, OracleInput } from '../../types.js'

/** One outcome of the sixteen-cowrie cast: how many shells fall mouth up. */
export interface CowrieOdu {
  /** Number of cowries mouth up, 0–16. */
  readonly count: number
  /** The odu name for that count, e.g. 'Eji Ogbe' for 8. */
  readonly name: string
  /**
   * Number of the $2^{16}$ equiprobable shell patterns with this count,
   * $\binom{16}{\text{count}}$ — so $P = \text{ways} / 65536$ exactly.
   */
  readonly ways: number
}

// Names by count, from the chapter titles of Bascom, *Sixteen Cowries: Yoruba
// Divination from Africa to the New World* (Indiana University Press, 1980),
// Part Two: "Okanran 1 cowrey", "Eji Oko 2 cowries", …, "Opira 0 cowries".
const NAMES: readonly string[] = [
  'Opira',
  'Okanran',
  'Eji Oko',
  'Ogunda',
  'Irosun',
  'Ose',
  'Obara',
  'Odi',
  'Eji Ogbe',
  'Osa',
  'Ofun',
  'Owonrin',
  'Ejila Sebora',
  'Ika',
  'Oturupon',
  'Ofun Kanran',
  'Irete',
]

function binomial16(k: number): number {
  let c = 1
  for (let i = 0; i < k; i++) c = (c * (16 - i)) / (i + 1)
  return c
}

/**
 * The seventeen outcomes of the sixteen-cowrie (*merindinlogun*) cast,
 * indexed by the number of shells that fall mouth up, with the odu names of
 * Bascom's *Sixteen Cowries* (1980): 0 Opira, 1 Okanran, 2 Eji Oko,
 * 3 Ogunda, 4 Irosun, 5 Ose, 6 Obara, 7 Odi, 8 Eji Ogbe, 9 Osa, 10 Ofun,
 * 11 Owonrin, 12 Ejila Sebora, 13 Ika, 14 Oturupon, 15 Ofun Kanran,
 * 16 Irete. Names vary between houses and the diaspora (e.g. Lucumí
 * *diloggun* usage); these are Bascom's.
 */
export const COWRIE_ODU: readonly CowrieOdu[] = Object.freeze(
  NAMES.map((name, count) => Object.freeze({ count, name, ways: binomial16(count) })),
)

export interface CowrieCast extends EntropyAccounting {
  /** Number of shells mouth up, 0–16. */
  readonly up: number
  /** The odu for `up`: `COWRIE_ODU[up]`. */
  readonly odu: CowrieOdu
  /** Each shell in cast order: `true` = mouth up. */
  readonly shells: readonly boolean[]
}

/**
 * `signal` aborts the cast with an OracleError `'aborted'` (also on a shared
 * reader); `chunkBytes` (default 32) is requested from a `ByteSource` the
 * cast opens. See {@link CastReaderOptions}.
 */
export interface CastCowriesOptions extends CastReaderOptions {
  /** Number of shells. Only the sixteen-cowrie cast is modeled: `16` (default). */
  shells?: 16
}

/**
 * Cast sixteen cowries: **exactly 16 MSB-first bits** (2 bytes), one fair
 * bit per shell (`1` = mouth up), so the number up is Binomial(16, 1/2):
 * $$P(\text{up} = k) = \binom{16}{k} / 2^{16},$$
 * from $1/65536$ for Opira (0) and Irete (16) to $12870/65536 \approx 19.6\%$
 * for Eji Ogbe (8). Dyadic, so there is no rejection.
 *
 * Modeled, not measured: a cowrie is not a fair coin, and no measured
 * face probability is used — the fair-shell model is the stated null.
 *
 * @throws OracleError `'invalid_input'` for `shells` other than 16, a
 *   non-object `opts`, or a reader already used by another cast; plus every
 *   {@link ByteReader} read error
 */
export async function castCowries(
  input: OracleInput | ByteReader,
  opts: CastCowriesOptions = {},
): Promise<CowrieCast> {
  checkCastOptions(opts, 'castCowries')
  if (opts.shells !== undefined && opts.shells !== 16) {
    throw new OracleError(
      'invalid_input',
      `castCowries models the sixteen-cowrie cast only (shells: 16), got ${String(opts.shells)}`,
    )
  }
  return withCastReader(input, opts, async (reader) => {
    const accounting = accountingFrom(reader)
    const bits = bitReader(reader)
    const shells: boolean[] = []
    for (let i = 0; i < 16; i++) shells.push((await bits.nextBit()) === 1)
    const up = shells.filter(Boolean).length
    return Object.freeze({
      up,
      odu: COWRIE_ODU[up] as CowrieOdu,
      shells: Object.freeze(shells),
      ...accounting(),
      bitsUsed: bits.bitsUsed,
    })
  })
}
