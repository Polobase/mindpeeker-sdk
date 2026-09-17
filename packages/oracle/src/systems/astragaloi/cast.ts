import { bitReader } from '../../core/bits.js'
import {
  accountingFrom,
  type CastReaderOptions,
  checkCastOptions,
  withCastReader,
} from '../../core/cast-reader.js'
import type { ByteReader } from '../../core/reader.js'
import { weightedIndex, weightedIndexRational } from '../../core/weighted.js'
import { OracleError } from '../../errors.js'
import type { EntropyAccounting, OracleInput } from '../../types.js'

/** The four scoring faces of an astragalus (knucklebone). */
export type AstragalusFace = 1 | 3 | 4 | 6

/** Face values in weight order: the narrow sides 1 and 6, the broad sides 3 and 4. */
export const ASTRAGALUS_FACES: readonly AstragalusFace[] = Object.freeze([1, 3, 4, 6])

/** Face models: `'hagstrom'` weights 1:4:4:1, `'uniform'` 1:1:1:1. */
export type AstragalusModel = 'hagstrom' | 'uniform'

/**
 * Integer weights over {@link ASTRAGALUS_FACES}:
 *
 * - `hagstrom` — $P(1) = P(6) = 1/10$, $P(3) = P(4) = 4/10$: the rounded
 *   face frequencies commonly attributed to Hagström's throwing experiments
 *   (1932) and used as the standard model in the history-of-probability
 *   literature. Non-dyadic, drawn with rejection sampling.
 * - `uniform` — each face $1/4$: the naive fair-die null, for comparison.
 */
export const ASTRAGALUS_WEIGHTS: Readonly<Record<AstragalusModel, readonly number[]>> =
  Object.freeze({
    hagstrom: Object.freeze([1, 4, 4, 1]),
    uniform: Object.freeze([1, 1, 1, 1]),
  })

/** Largest number of bones in one cast. */
const MAX_BONES = 64

export interface AstragaloiCast extends EntropyAccounting {
  readonly model: AstragalusModel
  /** Each bone's face, in throw order. */
  readonly bones: readonly AstragalusFace[]
  /** Sum of the faces. */
  readonly sum: number
  /** The unordered throw as sorted digits, e.g. `'13346'` (56 keys for five bones). */
  readonly key: string
}

/**
 * `signal` aborts the cast with an OracleError `'aborted'` (also on a shared
 * reader); `chunkBytes` (default 32) is requested from a `ByteSource` the
 * cast opens. See {@link CastReaderOptions}.
 */
export interface CastAstragaloiOptions extends CastReaderOptions {
  /** Face model. Default `'hagstrom'`. */
  model?: AstragalusModel
}

/**
 * Throw `count` astragaloi (default 5, as in the five-astragal oracle
 * inscriptions of Asia Minor with their 56 unordered throws), each face
 * independent with the exact probabilities of {@link ASTRAGALUS_WEIGHTS}:
 *
 * - `'hagstrom'`: one {@link weightedIndexRational} over $[1, 4, 4, 1]$ per
 *   bone — one byte per attempt, accepted with probability $250/256$;
 *   `bitsUsed` $= 8 \cdot$ `bytesConsumed`.
 * - `'uniform'`: 2 MSB-first bits per bone via {@link weightedIndex}, no
 *   rejection ($\lceil 2c/8 \rceil$ bytes).
 *
 * An unordered throw with face counts $(n_1, n_3, n_4, n_6)$ has probability
 * $$\frac{c!}{n_1!\,n_3!\,n_4!\,n_6!} \prod_f p_f^{\,n_f},$$
 * e.g. five 1s: $10^{-5}$ under `'hagstrom'`, $4^{-5}$ under `'uniform'`.
 *
 * **Modeled vs measured.** The 1:4:4:1 model is a rounded summary, not a
 * physical constant: real knucklebones differ bone by bone (species, wear,
 * shaping), and how far tali depart from any single model is discussed in
 * the history of probability (e.g. Bellhouse & Genest, "The Role of Dice in
 * the Emergence of the Probability Calculus", *International Statistical
 * Review*, 2025, doi:10.1111/insr.70003). Treat it as the stated null of a
 * pre-registered design, not a fact about a given set of bones.
 *
 * @throws OracleError `'invalid_input'` unless `count` is an integer in
 *   $[1, 64]$; also for an unknown `model`, a non-object `opts`, or a reader
 *   already used by another cast; plus every {@link ByteReader} read error
 */
export async function castAstragaloi(
  input: OracleInput | ByteReader,
  count = 5,
  opts: CastAstragaloiOptions = {},
): Promise<AstragaloiCast> {
  if (!Number.isInteger(count) || count < 1 || count > MAX_BONES) {
    throw new OracleError(
      'invalid_input',
      `castAstragaloi count must be an integer in [1, ${MAX_BONES}], got ${count}`,
    )
  }
  checkCastOptions(opts, 'castAstragaloi')
  const model: unknown = opts.model === undefined ? 'hagstrom' : opts.model
  if (model !== 'hagstrom' && model !== 'uniform') {
    throw new OracleError('invalid_input', `unknown astragalus model '${String(opts.model)}'`)
  }
  return withCastReader(input, opts, async (reader) => {
    const accounting = accountingFrom(reader)
    const bones: AstragalusFace[] = []
    let bitsUsed: number
    if (model === 'uniform') {
      const bits = bitReader(reader)
      for (let i = 0; i < count; i++) {
        bones.push(
          ASTRAGALUS_FACES[await weightedIndex(bits, ASTRAGALUS_WEIGHTS.uniform)] as AstragalusFace,
        )
      }
      bitsUsed = bits.bitsUsed
    } else {
      const before = reader.bytesConsumed
      for (let i = 0; i < count; i++) {
        bones.push(
          ASTRAGALUS_FACES[
            await weightedIndexRational(reader, ASTRAGALUS_WEIGHTS.hagstrom)
          ] as AstragalusFace,
        )
      }
      bitsUsed = 8 * (reader.bytesConsumed - before)
    }
    return Object.freeze({
      model,
      bones: Object.freeze(bones),
      sum: bones.reduce<number>((s, face) => s + face, 0),
      key: [...bones].sort((a, b) => a - b).join(''),
      ...accounting(),
      bitsUsed,
    })
  })
}
