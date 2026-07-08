/**
 * The sixteen geomantic figures (Western geomancy / Arabic ʿilm al-raml).
 *
 * A figure is four rows — Fire, Air, Water, Earth from the top — each row
 * *active* (one point) or *passive* (two points). `pattern` encodes the
 * rows Fire → Earth with $1 =$ active, matching the `binary` key of the
 * mindpeeker frontend's `geomancy.json`. A figure's `points` is its total
 * dot count: $\sum_r (2 - \text{pattern}_r) \in [4, 8]$.
 *
 * Names, English translations, and planetary rulers are the standard table
 * (Agrippa, *Fourth Book of Occult Philosophy*, 1655 ed.; Greer, *The Art
 * and Practice of Geomancy*, 2009). Elements are the Golden Dawn zodiacal
 * attributions (Regardie, *The Golden Dawn*; element of the attributed
 * sign). Elemental/planetary attributions vary between traditions — these
 * are data, not doctrine.
 */

export type Element = 'Fire' | 'Air' | 'Water' | 'Earth'

/** One row of a figure: 1 = active (single point), 0 = passive (two points). */
export type FigureRow = 0 | 1

export interface GeomanticFigure {
  /** Kebab-case id matching the mindpeeker frontend (`fortuna-major`, …). */
  readonly id: string
  /** Latin name, e.g. 'Fortuna Major'. */
  readonly name: string
  /** English translation of the Latin, e.g. 'Greater Fortune'. */
  readonly meaning: string
  readonly element: Element
  /** Traditional planetary ruler, e.g. 'Saturn' or 'Saturn/Mars' for the nodes. */
  readonly planet: string
  /** Rows Fire → Earth, 1 = active (single point). */
  readonly pattern: readonly [FigureRow, FigureRow, FigureRow, FigureRow]
  /** `pattern` as a string, e.g. '0011' — the frontend lookup key. */
  readonly binary: string
  /** Total points, 4–8. Even/odd parity drives the Judge theorem. */
  readonly points: number
}

// [id, name, meaning, binary Fire→Earth, element (GD zodiacal), planet]
const ROWS: readonly (readonly [string, string, string, string, Element, string])[] = [
  ['via', 'Via', 'The Way', '1111', 'Water', 'Moon'],
  ['cauda-draconis', 'Cauda Draconis', 'Tail of the Dragon', '1110', 'Fire', 'Saturn/Mars'],
  ['puer', 'Puer', 'The Boy', '1101', 'Fire', 'Mars'],
  ['fortuna-minor', 'Fortuna Minor', 'Lesser Fortune', '1100', 'Fire', 'Sun'],
  ['puella', 'Puella', 'The Girl', '1011', 'Air', 'Venus'],
  ['amissio', 'Amissio', 'Loss', '1010', 'Earth', 'Venus'],
  ['carcer', 'Carcer', 'The Prison', '1001', 'Earth', 'Saturn'],
  ['laetitia', 'Laetitia', 'Joy', '1000', 'Water', 'Jupiter'],
  ['caput-draconis', 'Caput Draconis', 'Head of the Dragon', '0111', 'Earth', 'Jupiter/Venus'],
  ['conjunctio', 'Conjunctio', 'Conjunction', '0110', 'Earth', 'Mercury'],
  ['acquisitio', 'Acquisitio', 'Gain', '0101', 'Fire', 'Jupiter'],
  ['rubeus', 'Rubeus', 'Red', '0100', 'Water', 'Mars'],
  ['fortuna-major', 'Fortuna Major', 'Greater Fortune', '0011', 'Fire', 'Sun'],
  ['albus', 'Albus', 'White', '0010', 'Air', 'Mercury'],
  ['tristitia', 'Tristitia', 'Sorrow', '0001', 'Air', 'Saturn'],
  ['populus', 'Populus', 'The People', '0000', 'Water', 'Moon'],
]

/** All sixteen figures. Order matches the frontend table (Via … Populus). */
export const GEOMANTIC_FIGURES: readonly GeomanticFigure[] = Object.freeze(
  ROWS.map(([id, name, meaning, binary, element, planet]) => {
    const pattern = Object.freeze(
      [...binary].map((c) => (c === '1' ? 1 : 0)),
    ) as unknown as GeomanticFigure['pattern']
    const points = pattern.reduce<number>((sum, row) => sum + (2 - row), 0)
    return Object.freeze({ id, name, meaning, element, planet, pattern, binary, points })
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
