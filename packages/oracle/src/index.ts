/**
 * @mindpeeker/oracle — bias-free mapping from entropy streams to archetypal
 * systems (I-Ching, Tarot, Elder Futhark runes, geomancy).
 *
 * The package guarantees exactly one thing: given uniform input bytes,
 * every symbol is selected with its exact stated probability — rejection
 * sampling instead of modulo, dyadic weights instead of float thresholds,
 * Fisher–Yates instead of ad-hoc shuffles — and the same bytes always
 * reproduce the same reading. What the symbols *mean* is cultural, not
 * mathematical.
 */

export { type BitReader, bitReader } from './core/bits.js'
export { drawWithoutReplacement } from './core/draw.js'
export { type ByteReader, type ByteReaderOptions, byteReader } from './core/reader.js'
export { MAX_UNIFORM, uniformInt } from './core/uniform.js'
export { weightedIndex } from './core/weighted.js'
export { OracleError, type OracleErrorCode, type OracleErrorOptions } from './errors.js'
export {
  type CastShieldOptions,
  castShield,
  type FigureQuartet,
  houses,
  type ShieldCast,
} from './systems/geomancy/cast.js'
export {
  type Element,
  type FigureRow,
  figureFromBinary,
  GEOMANTIC_FIGURES,
  type GeomanticFigure,
} from './systems/geomancy/data.js'
export {
  type CastHexagramOptions,
  type CastLine,
  type CastMethod,
  castHexagram,
  type HexagramCast,
  LINE_WEIGHTS,
  type LineValue,
} from './systems/iching/cast.js'
export {
  HEXAGRAMS,
  type Hexagram,
  hexagramFromBinary,
  TRIGRAMS,
  type Trigram,
  type TrigramKey,
} from './systems/iching/data.js'
export {
  type CastRunesOptions,
  castRunes,
  type DrawnRune,
  type RuneCast,
} from './systems/runes/cast.js'
export { type AettName, ELDER_FUTHARK, type Rune } from './systems/runes/data.js'
export {
  type CastSpreadOptions,
  castSpread,
  type DrawnCard,
  type SpreadCast,
} from './systems/tarot/cast.js'
export {
  SPREADS,
  type Spread,
  type SpreadName,
  type SpreadPosition,
  type Suit,
  TAROT_DECK,
  type TarotCard,
} from './systems/tarot/data.js'
export type {
  ByteSource,
  ByteStreamOptions,
  EntropyAccounting,
  OracleInput,
} from './types.js'
