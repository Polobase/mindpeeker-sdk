import { OracleError } from '../../errors.js'
import type { ShieldCast } from './cast.js'
import { addFigures, canonicalFigure, type GeomanticFigure } from './data.js'

/**
 * How the twelve figures I–XII of a shield are placed in the astrological
 * houses — a documented multi-system choice (Skinner 1980, Appendix III,
 * lists more than one):
 *
 * - `'sequential'` — figure $k$ in house $k$: Mothers → 1–4, Daughters →
 *   5–8, Nephews → 9–12 (Greer, *The Art and Practice of Geomancy*, 2009,
 *   ch. 6). The 0.1 behaviour of {@link houses}.
 * - `'goldenDawn'` — Mothers angular, Daughters succedent, Nephews cadent:
 *   I→10, II→1, III→4, IV→7, V→11, VI→2, VII→5, VIII→8, IX→12, X→3,
 *   XI→6, XII→9 (Crowley, *Liber XCVI*, 1909, ch. III; Skinner 1980,
 *   Appendix III, p. 239).
 */
export type HouseSystem = 'sequential' | 'goldenDawn'

/**
 * For each house system, the house number (1–12) of figure I … XII:
 * `HOUSE_SYSTEMS[system][k - 1]` is the house of figure $k$.
 */
export const HOUSE_SYSTEMS: Readonly<Record<HouseSystem, readonly number[]>> = Object.freeze({
  sequential: Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
  goldenDawn: Object.freeze([10, 1, 4, 7, 11, 2, 5, 8, 12, 3, 6, 9]),
})

export interface HousesOptions {
  /** Placement of figures I–XII. Default `'sequential'`. */
  system?: HouseSystem
}

/** The Part of Fortune of a shield chart. */
export interface PartOfFortune {
  /** Total points of figures I–XII, in $[48, 96]$. */
  readonly total: number
  /** $((\text{total} - 1) \bmod 12) + 1$ — the remainder, with 0 read as 12. */
  readonly index: number
  /** Figure number `index` of I–XII (the Liber XCVI reading). */
  readonly figure: GeomanticFigure
}

/** Validate a shield-shaped value; returns figures I–XII and the Judge (canonical objects). */
function chartOf(
  shield: unknown,
  fn: string,
): { twelve: GeomanticFigure[]; judge: GeomanticFigure } {
  if (typeof shield !== 'object' || shield === null) {
    throw new OracleError('invalid_input', `${fn} expects a shield chart`)
  }
  const { mothers, daughters, nieces, judge } = shield as Partial<ShieldCast>
  const twelve: GeomanticFigure[] = []
  for (const quartet of [mothers, daughters, nieces]) {
    if (!Array.isArray(quartet) || quartet.length !== 4) {
      throw new OracleError(
        'invalid_input',
        `${fn} expects mothers, daughters, and nieces of four figures each`,
      )
    }
    for (const figure of quartet) twelve.push(canonicalFigure(figure, fn))
  }
  return { twelve, judge: canonicalFigure(judge, fn) }
}

/**
 * Project a shield chart onto the twelve astrological houses: element
 * $h - 1$ of the result is the figure in house $h$. A pure projection — no
 * entropy involved. See {@link HouseSystem} for the two placements.
 *
 * Example (Liber XCVI): under `'goldenDawn'` the Ascendant (house 1) holds
 * figure II, the Midheaven (house 10) figure I.
 *
 * @throws OracleError `'invalid_input'` for a malformed shield, a non-object
 *   `opts`, or an unknown `system` (inherited keys such as `'constructor'`
 *   included)
 */
export function houses(shield: ShieldCast, opts: HousesOptions = {}): readonly GeomanticFigure[] {
  if (typeof opts !== 'object' || opts === null) {
    throw new OracleError('invalid_input', 'houses options must be an object')
  }
  const system: unknown = opts.system === undefined ? 'sequential' : opts.system
  if (typeof system !== 'string' || !Object.hasOwn(HOUSE_SYSTEMS, system)) {
    throw new OracleError('invalid_input', `unknown house system '${String(opts.system)}'`)
  }
  const { twelve } = chartOf(shield, 'houses')
  const placement = HOUSE_SYSTEMS[system as HouseSystem]
  const chart = new Array<GeomanticFigure>(12)
  twelve.forEach((figure, k) => {
    chart[(placement[k] as number) - 1] = figure
  })
  return Object.freeze(chart)
}

/**
 * The Reconciler, figure XVI: Mother I added to the Judge (XV),
 * $\text{XVI} = \text{I} \oplus \text{XV}$ row-wise (Crowley, *Liber XCVI*,
 * 1909, ch. II: "The Reconciler = I + XV"; Skinner 1980, p. 216, step 13).
 * A pure function of the chart. Skinner's optional second reconciler (the
 * Judge added to the figure in the house of the question, p. 219) is not
 * computed: it needs the question's house.
 *
 * @throws OracleError `'invalid_input'` for a malformed shield
 */
export function reconciler(shield: ShieldCast): GeomanticFigure {
  const { twelve, judge } = chartOf(shield, 'reconciler')
  return addFigures(twelve[0] as GeomanticFigure, judge)
}

/**
 * The Part of Fortune: add the points of figures I–XII, divide by 12, and
 * the remainder names the figure — *Liber XCVI* (1909, ch. II): "I + II +
 * … + XII = 74 points = 6 × 12 + 2, ∴ ⊗ falls with II". A remainder of 0 is
 * read as 12 (the sources do not state this case; $\text{total} \bmod 12 =
 * 0$ means the count lands on the last figure).
 *
 * **Parity theorem.** The total is always even, so the Part of Fortune only
 * ever falls on figure II, IV, VI, VIII, X, or XII. The Daughters transpose
 * the Mothers, so both quartets have the same number $A$ of active rows; a
 * sum's active-row count has the parity of its parents' total, so the
 * Nephews together have $\equiv 2A \equiv 0 \pmod 2$ active rows; hence
 * I–XII have an even number of active rows and $96 - \text{active}$ points
 * (verified exhaustively over all $2^{16}$ charts in the tests).
 *
 * `index` is the figure number; Skinner (1980, p. 218) reads the same
 * remainder as a **house** number instead — the figure there is
 * `houses(shield, { system })[index - 1]`, which differs from `figure`
 * under `'goldenDawn'`.
 *
 * @throws OracleError `'invalid_input'` for a malformed shield
 */
export function partOfFortune(shield: ShieldCast): PartOfFortune {
  const { twelve } = chartOf(shield, 'partOfFortune')
  const total = twelve.reduce((sum, figure) => sum + figure.points, 0)
  const index = ((total - 1) % 12) + 1
  return Object.freeze({ total, index, figure: twelve[index - 1] as GeomanticFigure })
}
