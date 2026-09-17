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
 * {@link chamberMates}, {@link aiqBekerSubstitute} and {@link aiqBekerEquivalent}
 * implement that exchange.
 *
 * Sources: Lon Milo DuQuette, *Llewellyn's Complete Book of Ceremonial Magick*
 * (the nine chambers, finals in the hundreds, sigils on the kameas); Israel
 * Regardie & the Ciceros, *The Golden Dawn* / *Self-Initiation* (Aiq Beker);
 * S. L. MacGregor Mathers, *The Kabbalah Unveiled* (1887: the chamber table with
 * the finals as hundreds); Crowley, *Sepher Sephiroth* (Equinox I.8, 1912:
 * "Truth; Temurah of ADM, by Aiq Bekar AMTh").
 */

import { GematriaError } from './errors.js'
import { digitRoot, HEBREW_FINALS, normalizeFor } from './normalize.js'
import { requireString } from './validate.js'

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
 * How final forms are placed in the chambers by {@link chamberMates},
 * {@link aiqBekerSubstitute} and {@link aiqBekerEquivalent}:
 *
 * - `'distinct'` (default, as in {@link aiqBeker} and {@link NINE_CHAMBERS}) —
 *   the finals are the hundreds 500–900, so ם sits with ו and ס.
 * - `'fold'` — a final counts as its base letter (ם as מ, with ד and ת), the
 *   reading of transliterated sources that do not mark finals: *Sepher
 *   Sephiroth* gives אמת (AMTh, 441) as the "Temurah of ADM [אדם, 45], by Aiq
 *   Bekar".
 */
export type ChamberFinals = 'distinct' | 'fold'

/** Options for the Aiq Beker substitution helpers. */
export interface ChamberOptions {
  /** Placement of final forms. Default `'distinct'`. See {@link ChamberFinals}. */
  readonly finals?: ChamberFinals
}

function finalsMode(opts: unknown): ChamberFinals {
  if (opts === undefined) return 'distinct'
  if (typeof opts !== 'object' || opts === null || Array.isArray(opts)) {
    throw new GematriaError('invalid_input', 'chamber options must be an object')
  }
  const finals = (opts as { finals?: unknown }).finals ?? 'distinct'
  if (finals !== 'distinct' && finals !== 'fold') {
    throw new GematriaError(
      'invalid_input',
      `finals must be 'distinct' or 'fold', got ${String(finals)}`,
    )
  }
  return finals
}

/** The chamber cell of one normalized character, or `undefined` if it is no Hebrew letter. */
function cellOf(ch: string, finals: ChamberFinals): AiqBekerCell | undefined {
  return CELL_BY_CHAR.get(finals === 'fold' ? (HEBREW_FINALS[ch] ?? ch) : ch)
}

/**
 * The other two letters of `letter`'s Aiq Beker chamber, in chamber order
 * (units, tens, hundreds). The first Hebrew letter in `letter` is used; niqqud
 * are stripped. `chamberMates('ד')` is `['מ', 'ת']`; `chamberMates('ם')` is
 * `['ו', 'ס']`, or `['ד', 'ת']` with `{ finals: 'fold' }`.
 *
 * @throws GematriaError `'invalid_input'` if `letter` is not a string, holds no
 *   Hebrew letter, or `opts` is invalid
 */
export function chamberMates(letter: string, opts?: ChamberOptions): readonly string[] {
  requireString(letter, 'letter')
  const finals = finalsMode(opts)
  for (const ch of normalizeFor(letter, 'hebrew')) {
    const cell = cellOf(ch, finals)
    if (!cell) continue
    const row = NINE_CHAMBERS[cell.chamber - 1] as readonly string[]
    return Object.freeze(row.filter((_, i) => i !== cell.position - 1))
  }
  throw new GematriaError('invalid_input', `not a Hebrew letter: ${letter}`)
}

/**
 * Aiq Beker substitution: replace every Hebrew letter of `text` by the member
 * of its chamber at `position` — 1 (units), 2 (tens) or 3 (hundreds, finals for
 * chambers 5–9). Niqqud are stripped; other characters pass through. The
 * substituted word keeps each letter's chamber, so its per-letter digital roots
 * — and hence its chamber reduction digit by digit — are unchanged:
 * `aiqBekerSubstitute('אמת', 1)` is `'אדד'`.
 *
 * @throws GematriaError `'invalid_input'` if `text` is not a string, `position`
 *   is not 1, 2 or 3, or `opts` is invalid
 */
export function aiqBekerSubstitute(
  text: string,
  position: 1 | 2 | 3,
  opts?: ChamberOptions,
): string {
  requireString(text)
  if (position !== 1 && position !== 2 && position !== 3) {
    throw new GematriaError('invalid_input', `position must be 1, 2 or 3, got ${String(position)}`)
  }
  const finals = finalsMode(opts)
  let out = ''
  for (const ch of normalizeFor(text, 'hebrew')) {
    const cell = cellOf(ch, finals)
    out += cell
      ? ((NINE_CHAMBERS[cell.chamber - 1] as readonly string[])[position - 1] as string)
      : ch
  }
  return out
}

/**
 * Whether two words are Aiq Beker exchanges of each other: they have the same
 * number of Hebrew letters and each letter of `a` shares its chamber with the
 * letter of `b` at the same place (non-Hebrew characters are ignored). This is
 * the traditional "any letter may be exchanged for another of its chamber";
 * `aiqBekerEquivalent('אדם', 'אמת', { finals: 'fold' })` is `true` (45 ↔ 441,
 * *Sepher Sephiroth*), and `false` with the default distinct finals.
 *
 * @throws GematriaError `'invalid_input'` if either word is not a string or
 *   `opts` is invalid
 */
export function aiqBekerEquivalent(a: string, b: string, opts?: ChamberOptions): boolean {
  requireString(a, 'a')
  requireString(b, 'b')
  const finals = finalsMode(opts)
  const chambers = (text: string): number[] => {
    const out: number[] = []
    for (const ch of normalizeFor(text, 'hebrew')) {
      const cell = cellOf(ch, finals)
      if (cell) out.push(cell.chamber)
    }
    return out
  }
  const ca = chambers(a)
  const cb = chambers(b)
  return ca.length === cb.length && ca.every((chamber, i) => chamber === cb[i])
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
