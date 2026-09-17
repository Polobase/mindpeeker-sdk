/**
 * @mindpeeker/oracle — bias-free mapping from entropy streams to archetypal
 * systems (I-Ching, Tarot, runes, geomancy, Ifá and sixteen cowries, Chinese
 * fortune sticks, Tibetan Mo, astragaloi, the Homer oracle).
 *
 * The package guarantees exactly one thing: given uniform input bytes,
 * every symbol is selected with its exact stated probability — rejection
 * sampling instead of modulo, dyadic weights instead of float thresholds,
 * Fisher–Yates instead of ad-hoc shuffles — and the same bytes always
 * reproduce the same reading. What the symbols *mean* is cultural, not
 * mathematical.
 */

export { type BitReader, bitReader } from './core/bits.js'
export { type CastReaderOptions, DEFAULT_CAST_CHUNK_BYTES } from './core/cast-reader.js'
export { drawWithoutReplacement } from './core/draw.js'
export { type DealSpec, type ExpectedBytesOptions, expectedBytes } from './core/expected.js'
export { type ByteReader, type ByteReaderOptions, byteReader } from './core/reader.js'
export { type RecordingReader, recordingReader } from './core/recording.js'
export { MAX_UNIFORM, uniformInt } from './core/uniform.js'
export { weightedIndex, weightedIndexRational } from './core/weighted.js'
export { OracleError, type OracleErrorCode, type OracleErrorOptions } from './errors.js'
export {
  ASTRAGALUS_FACES,
  ASTRAGALUS_WEIGHTS,
  type AstragaloiCast,
  type AstragalusFace,
  type AstragalusModel,
  type CastAstragaloiOptions,
  castAstragaloi,
} from './systems/astragaloi/cast.js'
export {
  type CastCowriesOptions,
  COWRIE_ODU,
  type CowrieCast,
  type CowrieOdu,
  castCowries,
} from './systems/cowries/cast.js'
export {
  type CastShieldOptions,
  castShield,
  type FigureQuartet,
  type ShieldCast,
} from './systems/geomancy/cast.js'
export {
  HOUSE_SYSTEMS,
  type HouseSystem,
  type HousesOptions,
  houses,
  type PartOfFortune,
  partOfFortune,
  reconciler,
} from './systems/geomancy/chart.js'
export {
  type Element,
  type FigureRow,
  figureElement,
  figureFromBinary,
  GEOMANTIC_FIGURES,
  type GeomanticElementSystem,
  type GeomanticFigure,
  type ZodiacSign,
} from './systems/geomancy/data.js'
export {
  type CastHomeromanteionOptions,
  castHomeromanteion,
  type HomeromanteionCast,
} from './systems/homeromanteion/cast.js'
export {
  type CastHexagramOptions,
  type CastLine,
  type CastMethod,
  castHexagram,
  type HexagramCast,
  LINE_WEIGHTS,
  type LineMethod,
  type LineValue,
} from './systems/iching/cast.js'
export {
  HEXAGRAMS,
  type Hexagram,
  hexagramFromBinary,
  LEGGE_NAMES,
  TRIGRAMS,
  type Trigram,
  type TrigramKey,
} from './systems/iching/data.js'
export {
  fuXiNumber,
  hexagramFromFuXi,
  inverseHexagram,
  nuclearHexagram,
  oppositeHexagram,
} from './systems/iching/structure.js'
export {
  type CastOduOptions,
  castOdu,
  type OduCast,
  type OduMethod,
} from './systems/ifa/cast.js'
export { ODU_FIGURES, type OduFigure, oduFromBinary } from './systems/ifa/data.js'
export {
  type CastLotOptions,
  castLot,
  JIAOBEI_WEIGHTS,
  type JiaobeiThrow,
  type LotAttempt,
  type LotCast,
  type LotSticks,
} from './systems/lots/cast.js'
export {
  type CastMoOptions,
  castMo,
  MO_SYLLABLES,
  type MoCast,
  type MoSyllable,
} from './systems/mo/cast.js'
export {
  type CastRunesOptions,
  castRunes,
  type DrawnRune,
  type RuneCast,
} from './systems/runes/cast.js'
export { type AettName, ELDER_FUTHARK, type Rune } from './systems/runes/data.js'
export {
  FUTHARKS,
  FUTHORC_28,
  FUTHORC_29,
  FUTHORC_33,
  type Futhark,
  RUNE_LAYOUTS,
  type RuneLayout,
  type RuneLayoutName,
  YOUNGER_FUTHARK,
} from './systems/runes/rows.js'
export { castRuneSets, type RuneSetsCast } from './systems/runes/sets.js'
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
export type { Reversals, ReversalWeights } from './systems/tarot/options.js'
export type {
  ByteSource,
  ByteStreamOptions,
  EntropyAccounting,
  OracleInput,
} from './types.js'
