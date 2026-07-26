/**
 * Aiq Beker — the *Qabalah of the Nine Chambers* (Aiq Bekar / אי״ק בכ״ר). The
 * twenty-two letters and the five final forms are sorted into nine "chambers"
 * (triads) by their place in the ones/tens/hundreds decades, so that the three
 * letters of a chamber share the same reduced digit:
 *
 * $$[\text{א},\text{י},\text{ק}]\,[\text{ב},\text{כ},\text{ר}]\,
 * [\text{ג},\text{ל},\text{ש}]\,[\text{ד},\text{מ},\text{ת}]\,
 * [\text{ה},\text{נ},\text{ך}]\,[\text{ו},\text{ס},\text{ם}]\,
 * [\text{ז},\text{ע},\text{ן}]\,[\text{ח},\text{פ},\text{ף}]\,
 * [\text{ט},\text{צ},\text{ץ}].$$
 *
 * The hundreds continue past ת(400) into the five finals ך=500 … ץ=900, so each
 * chamber is exactly (units, tens, hundreds). Qabalists use the chambers as a
 * substitution cipher (exchange any letter with another in its chamber) and to
 * trace names as sigils on the planetary kameas. {@link chamberReduce} is the
 * companion *theosophical reduction*: repeatedly sum a number's digits down to
 * one — the digital root — which sends every letter of a chamber to the same
 * value.
 *
 * Sources: Lon Milo DuQuette, *Llewellyn's Complete Book of Ceremonial Magick*
 * (the nine chambers, finals in the hundreds, sigils on the kameas); Israel
 * Regardie & the Ciceros, *The Golden Dawn* / *Self-Initiation* (Aiq Beker).
 */

import { GematriaError } from './errors.js'
import { digitRoot, normalizeFor } from './normalize.js'

/** A letter's place in the Aiq Beker grid. */
export interface AiqBekerCell {
  /** Chamber number, 1..9 (grouped by units/tens/hundreds decade). */
  readonly chamber: number
  /** Position within the chamber, 1..3 (1 = units, 2 = tens, 3 = hundreds). */
  readonly position: number
}

/**
 * The nine chambers, each `[units, tens, hundreds]`, with the hundreds slot
 * continuing into the final forms ך..ץ for chambers 5–9.
 */
export const NINE_CHAMBERS: readonly (readonly string[])[] = Object.freeze([
  Object.freeze(['א', 'י', 'ק']),
  Object.freeze(['ב', 'כ', 'ר']),
  Object.freeze(['ג', 'ל', 'ש']),
  Object.freeze(['ד', 'מ', 'ת']),
  Object.freeze(['ה', 'נ', 'ך']),
  Object.freeze(['ו', 'ס', 'ם']),
  Object.freeze(['ז', 'ע', 'ן']),
  Object.freeze(['ח', 'פ', 'ף']),
  Object.freeze(['ט', 'צ', 'ץ']),
])

const CELL_BY_CHAR: ReadonlyMap<string, AiqBekerCell> = new Map(
  NINE_CHAMBERS.flatMap((row, ci) =>
    row.map((ch, pi): [string, AiqBekerCell] => [
      ch,
      Object.freeze({ chamber: ci + 1, position: pi + 1 }),
    ]),
  ),
)

/**
 * The Aiq Beker chamber and position of a single Hebrew letter. Niqqud are
 * stripped; final forms are distinct members (they occupy the hundreds slots),
 * so ך and כ live in different chambers. The first Hebrew letter found in
 * `letter` is used.
 *
 * @throws GematriaError `'invalid_input'` if `letter` is not a string or holds
 *   no Hebrew letter
 */
export function aiqBeker(letter: string): AiqBekerCell {
  if (typeof letter !== 'string') {
    throw new GematriaError('invalid_input', `letter must be a string, got ${typeof letter}`)
  }
  for (const ch of normalizeFor(letter, 'hebrew')) {
    const cell = CELL_BY_CHAR.get(ch)
    if (cell) return cell
  }
  throw new GematriaError('invalid_input', `not a Hebrew letter: ${letter}`)
}

/**
 * Theosophical (chamber) reduction: repeatedly sum the decimal digits of a
 * non-negative integer until a single digit remains — the digital root. Every
 * member of an Aiq Beker chamber reduces to the same value (e.g. א/י/ק =
 * 1/10/100 all reduce to 1).
 *
 * @throws GematriaError `'invalid_input'` unless `value` is a non-negative integer
 */
export function chamberReduce(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new GematriaError(
      'invalid_input',
      `chamberReduce expects a non-negative integer, got ${value}`,
    )
  }
  return digitRoot(value)
}
