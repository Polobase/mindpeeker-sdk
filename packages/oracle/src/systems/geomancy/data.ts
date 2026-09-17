/**
 * The sixteen geomantic figures (Western geomancy / Arabic ʿilm al-raml).
 *
 * A figure is four rows — Fire, Air, Water, Earth from the top — each row
 * *active* (one point) or *passive* (two points). `pattern` encodes the
 * rows Fire → Earth with $1 =$ active, matching the `binary` key of the
 * mindpeeker frontend's `geomancy.json`. A figure's `points` is its total
 * dot count: $\sum_r (2 - \text{pattern}_r) \in [4, 8]$.
 *
 * Attributions are identity data, not doctrine, and follow the Golden Dawn
 * table printed in Crowley's *Liber XCVI, A Handbook of Geomancy* (Equinox
 * I:2, 1909, ch. I — public domain), cross-checked against Skinner,
 * *Terrestrial Astrology: Divination by Geomancy* (1980), pp. 99–104:
 *
 * - `sign` — the zodiac sign of the figure; `null` for Caput and Cauda
 *   Draconis, which the Golden Dawn gives to the Moon's North and South
 *   Node instead (`node`).
 * - `element` — the element column of that table (Skinner/GD), with
 *   Fortuna Minor = Fire. Liber XCVI itself gives Fortuna Minor = **Air**
 *   (four figures per element; Skinner: "sometimes Fortuna Minor has Air
 *   attributed to it") — see {@link figureElement}.
 * - `planet` — the planetary ruler; the nodes carry two ('Saturn/Mars',
 *   'Jupiter/Venus').
 *
 * Names and English meanings are the standard table (Agrippa, *Fourth Book
 * of Occult Philosophy*, 1655 ed.; Greer, *The Art and Practice of
 * Geomancy*, 2009).
 */

import { OracleError } from '../../errors.js'

export type Element = 'Fire' | 'Air' | 'Water' | 'Earth'

export type ZodiacSign =
  | 'Aries'
  | 'Taurus'
  | 'Gemini'
  | 'Cancer'
  | 'Leo'
  | 'Virgo'
  | 'Libra'
  | 'Scorpio'
  | 'Sagittarius'
  | 'Capricorn'
  | 'Aquarius'
  | 'Pisces'

/** One row of a figure: 1 = active (single point), 0 = passive (two points). */
export type FigureRow = 0 | 1

export interface GeomanticFigure {
  /** Kebab-case id matching the mindpeeker frontend (`fortuna-major`, …). */
  readonly id: string
  /** Latin name, e.g. 'Fortuna Major'. */
  readonly name: string
  /** English translation of the Latin, e.g. 'Greater Fortune'. */
  readonly meaning: string
  /** Golden Dawn element (Skinner 1980); Fortuna Minor = Fire. */
  readonly element: Element
  /** Traditional planetary ruler, e.g. 'Saturn' or 'Saturn/Mars' for the nodes. */
  readonly planet: string
  /** Golden Dawn zodiac sign (Liber XCVI, ch. I); `null` for the two nodes. */
  readonly sign: ZodiacSign | null
  /** `'north'` for Caput Draconis, `'south'` for Cauda Draconis, else `null`. */
  readonly node: 'north' | 'south' | null
  /** Rows Fire → Earth, 1 = active (single point). */
  readonly pattern: readonly [FigureRow, FigureRow, FigureRow, FigureRow]
  /** `pattern` as a string, e.g. '0011' — the frontend lookup key. */
  readonly binary: string
  /** Total points, 4–8. Even/odd parity drives the Judge theorem. */
  readonly points: number
}

type Row = readonly [
  string,
  string,
  string,
  string,
  Element,
  string,
  ZodiacSign | 'north' | 'south',
]

// [id, name, meaning, binary Fire→Earth, element (GD), planet, sign or node (Liber XCVI ch. I)]
const ROWS: readonly Row[] = [
  ['via', 'Via', 'The Way', '1111', 'Water', 'Moon', 'Cancer'],
  [
    'cauda-draconis',
    'Cauda Draconis',
    'Tail of the Dragon',
    '1110',
    'Fire',
    'Saturn/Mars',
    'south',
  ],
  ['puer', 'Puer', 'The Boy', '1101', 'Fire', 'Mars', 'Aries'],
  ['fortuna-minor', 'Fortuna Minor', 'Lesser Fortune', '1100', 'Fire', 'Sun', 'Leo'],
  ['puella', 'Puella', 'The Girl', '1011', 'Air', 'Venus', 'Libra'],
  ['amissio', 'Amissio', 'Loss', '1010', 'Earth', 'Venus', 'Taurus'],
  ['carcer', 'Carcer', 'The Prison', '1001', 'Earth', 'Saturn', 'Capricorn'],
  ['laetitia', 'Laetitia', 'Joy', '1000', 'Water', 'Jupiter', 'Pisces'],
  [
    'caput-draconis',
    'Caput Draconis',
    'Head of the Dragon',
    '0111',
    'Earth',
    'Jupiter/Venus',
    'north',
  ],
  ['conjunctio', 'Conjunctio', 'Conjunction', '0110', 'Earth', 'Mercury', 'Virgo'],
  ['acquisitio', 'Acquisitio', 'Gain', '0101', 'Fire', 'Jupiter', 'Sagittarius'],
  ['rubeus', 'Rubeus', 'Red', '0100', 'Water', 'Mars', 'Scorpio'],
  ['fortuna-major', 'Fortuna Major', 'Greater Fortune', '0011', 'Fire', 'Sun', 'Leo'],
  ['albus', 'Albus', 'White', '0010', 'Air', 'Mercury', 'Gemini'],
  ['tristitia', 'Tristitia', 'Sorrow', '0001', 'Air', 'Saturn', 'Aquarius'],
  ['populus', 'Populus', 'The People', '0000', 'Water', 'Moon', 'Cancer'],
]

/** All sixteen figures. Order matches the frontend table (Via … Populus). */
export const GEOMANTIC_FIGURES: readonly GeomanticFigure[] = Object.freeze(
  ROWS.map(([id, name, meaning, binary, element, planet, signOrNode]) => {
    const pattern = Object.freeze(
      [...binary].map((c) => (c === '1' ? 1 : 0)),
    ) as unknown as GeomanticFigure['pattern']
    const points = pattern.reduce<number>((sum, row) => sum + (2 - row), 0)
    const node = signOrNode === 'north' || signOrNode === 'south' ? signOrNode : null
    const sign = node === null ? (signOrNode as ZodiacSign) : null
    return Object.freeze({
      id,
      name,
      meaning,
      element,
      planet,
      sign,
      node,
      pattern,
      binary,
      points,
    })
  }),
)

const BY_BINARY: ReadonlyMap<string, GeomanticFigure> = new Map(
  GEOMANTIC_FIGURES.map((f) => [f.binary, f]),
)

/**
 * Look up a figure by its four-row string (Fire → Earth, `'1'` = active).
 * Returns `undefined` for anything that is not one of the 16 valid keys.
 */
export function figureFromBinary(binary: string): GeomanticFigure | undefined {
  return BY_BINARY.get(binary)
}

/**
 * Element attribution systems: `'goldenDawn'` (Skinner 1980 / GD, the
 * `element` field) and `'liber96'` (Crowley, *Liber XCVI*, 1909, ch. I),
 * which differ only in Fortuna Minor (Fire vs Air).
 */
export type GeomanticElementSystem = 'goldenDawn' | 'liber96'

/**
 * The element of `figure` under an attribution system — identity data, so
 * a pure lookup. Default `'goldenDawn'` (= `figure.element`).
 *
 * @throws OracleError `'invalid_input'` for an unknown figure or system
 */
export function figureElement(
  figure: GeomanticFigure,
  system: GeomanticElementSystem = 'goldenDawn',
): Element {
  const canonical = canonicalFigure(figure, 'figureElement')
  if (system !== 'goldenDawn' && system !== 'liber96') {
    throw new OracleError('invalid_input', `unknown element system '${String(system)}'`)
  }
  return system === 'liber96' && canonical.id === 'fortuna-minor' ? 'Air' : canonical.element
}

/**
 * Resolve a figure-shaped value to the canonical table entry by its
 * `binary` key (so a JSON round-tripped figure is accepted).
 *
 * @internal
 * @throws OracleError `'invalid_input'` when `value` is not a figure
 */
export function canonicalFigure(value: unknown, fn: string): GeomanticFigure {
  const binary =
    typeof value === 'object' && value !== null ? (value as { binary?: unknown }).binary : undefined
  const figure = typeof binary === 'string' ? BY_BINARY.get(binary) : undefined
  if (figure === undefined) {
    throw new OracleError('invalid_input', `${fn} expects a geomantic figure`)
  }
  return figure
}

/**
 * Geomantic addition: rows combine independently, and a row is active in
 * the sum iff the two parent rows' total point count is odd — with
 * active $= 1$ that is exactly $r = a \oplus b$ (Skinner 1980, p. 96).
 *
 * @internal
 */
export function addFigures(a: GeomanticFigure, b: GeomanticFigure): GeomanticFigure {
  const binary = a.pattern.map((row, i) => row ^ (b.pattern[i] as number)).join('')
  return BY_BINARY.get(binary) as GeomanticFigure
}
