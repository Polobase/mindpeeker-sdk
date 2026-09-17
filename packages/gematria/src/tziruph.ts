/**
 * Tziruph (צירוף) — the twenty-two commutation tables of Temurah, each named
 * after its first two letter pairs: Albath (אלב״ת), Abgath, Agdath, … Athbash.
 * Mathers: "the alphabet is bent exactly in half, in the middle, and one half is
 * put over the other; and then by changing alternately the first letter or the
 * first two letters at the beginning of the second line, twenty-two
 * commutations are produced."
 *
 * **Closed form.** Number the letters $i = 1 \dots 22$ (א = 1 … ת = 22). Table
 * $k \in \{1, \dots, 22\}$ pairs $i$ with
 * $$j \equiv k - i \pmod{22}, \qquad j = 0 \text{ meaning } 22\ (\text{ת}),$$
 * a reflection of the 22-letter circle, so every table is an involution. The
 * name gives $k$: letter א (1) pairs with letter $k - 1$ — Athbash $k = 1$
 * (א↔ת), Albath $k = 2$, Abgath $k = 3$, …, Aibat $k = 11$, Achbi $k = 12$, …,
 * Ashbar $k = 22$. For even $k$ two letters are their own mirror ($2i \equiv k$:
 * $i = k/2$ and $k/2 + 11$). By default (`selfPairs: 'swap'`) they are paired
 * with each other, as in Mathers' printed Albath table, which sets א over ל;
 * with `selfPairs: 'fixed'` they stay unchanged.
 *
 * **Which convention?** Mathers prints only Albath in full. Its layout needs
 * the swap (א↔ל), but the name Agdath (AGDTh — skipping ב, whose mirror under
 * $k = 4$ is itself) reads naturally with ב and מ left fixed. Under `'swap'` every
 * one of the 22 names is the table's first two pairs except Agdath; under
 * `'fixed'` every name except Albath. `'fixed'` is also the folded-halves
 * convention of {@link achbi}: `tziruph(x, ACHBI, { selfPairs: 'fixed' })` equals
 * `achbi(x)`.
 *
 * The Right and Averse "Tables of the Commutations" are exposed as
 * {@link tziruphSquare} (484 cells each).
 *
 * Sources: S. L. MacGregor Mathers, *The Kabbalah Unveiled* (1887), Introduction
 * §14 (the Albath table, the twenty-two names, RVCh → DTzO, the Right and Averse
 * tables); Israel Regardie, *The Complete Golden Dawn System of Magic* (the same
 * text); Christian D. Ginsburg, *The Kabbalah* (1865), p. 55 (the numbered
 * list 1. Albath … 22. Athbash).
 */

import { HE_BASE } from './ciphers/hebrew.js'
import { GematriaError } from './errors.js'
import { substituteHebrew } from './temurah.js'
import { isOptionsObject } from './validate.js'

/** Table number $k$ of Athbash (א↔ת, ב↔ש) — identical to `atbash`. */
export const ATHBASH = 1
/** Table number $k$ of Albath (א↔ל, ב↔ת) — Mathers' worked example, RVCh → DTzO. */
export const ALBATH = 2
/** Table number $k$ of Abgath (א↔ב, ג↔ת). */
export const ABGATH = 3
/** Table number $k$ of Agdath (א↔ג, ד↔ת). */
export const AGDATH = 4
/** Table number $k$ of Adbag (א↔ד, ב↔ג). */
export const ADBAG = 5
/** Table number $k$ of Ahbad (א↔ה, ב↔ד). */
export const AHBAD = 6
/** Table number $k$ of Avbah (א↔ו, ב↔ה). */
export const AVBAH = 7
/** Table number $k$ of Azbav (א↔ז, ב↔ו). */
export const AZBAV = 8
/** Table number $k$ of Achbaz (א↔ח, ב↔ז). */
export const ACHBAZ = 9
/** Table number $k$ of Atbach (א↔ט, ב↔ח). */
export const ATBACH = 10
/** Table number $k$ of Aibat (א↔י, ב↔ט). */
export const AIBAT = 11
/** Table number $k$ of Achbi (א↔כ, ב↔י). */
export const ACHBI = 12
/** Table number $k$ of Albach (א↔ל, ב↔כ). */
export const ALBACH = 13
/** Table number $k$ of Ambal (א↔מ, ב↔ל). */
export const AMBAL = 14
/** Table number $k$ of Anbam (א↔נ, ב↔מ). */
export const ANBAM = 15
/** Table number $k$ of Asban (א↔ס, ב↔נ). */
export const ASBAN = 16
/** Table number $k$ of Aobas (א↔ע, ב↔ס). */
export const AOBAS = 17
/** Table number $k$ of Apbao (א↔פ, ב↔ע). */
export const APBAO = 18
/** Table number $k$ of Atzbap (א↔צ, ב↔פ). */
export const ATZBAP = 19
/** Table number $k$ of Aqbatz (א↔ק, ב↔צ). */
export const AQBATZ = 20
/** Table number $k$ of Arbaq (א↔ר, ב↔ק). */
export const ARBAQ = 21
/** Table number $k$ of Ashbar (א↔ש, ב↔ר). */
export const ASHBAR = 22

/** Metadata of one commutation table. */
export interface TziruphTable {
  /** The closed-form parameter: letter $i$ pairs with $k - i \pmod{22}$. */
  readonly k: number
  /** Conventional English name (Mathers/Ginsburg spelling). */
  readonly name: string
  /** Mathers' transliterated name — the first two pairs (A = א, Th = ת, I = י, O = ע). */
  readonly abbreviation: string
  /** Position in Ginsburg's numbered list (1 = Albath … 22 = Athbash). */
  readonly ginsburg: number
}

const TABLE_NAMES: readonly (readonly [string, string])[] = [
  ['Athbash', 'AThBSh'],
  ['Albath', 'ALBTh'],
  ['Abgath', 'ABGTh'],
  ['Agdath', 'AGDTh'],
  ['Adbag', 'ADBG'],
  ['Ahbad', 'AHBD'],
  ['Avbah', 'AVBH'],
  ['Azbav', 'AZBV'],
  ['Achbaz', 'AChBZ'],
  ['Atbach', 'ATBCh'],
  ['Aibat', 'AIBT'],
  ['Achbi', 'AKBI'],
  ['Albach', 'ALBK'],
  ['Ambal', 'AMBL'],
  ['Anbam', 'ANBM'],
  ['Asban', 'ASBN'],
  ['Aobas', 'AOBS'],
  ['Apbao', 'APBO'],
  ['Atzbap', 'ATzBP'],
  ['Aqbatz', 'AQBTz'],
  ['Arbaq', 'ARBQ'],
  ['Ashbar', 'AShBR'],
]

/** The 22 commutation tables in order of $k$ (1 = Athbash … 22 = Ashbar), frozen. */
export const TZIRUPH_TABLES: readonly TziruphTable[] = Object.freeze(
  TABLE_NAMES.map(([name, abbreviation], i) =>
    Object.freeze({ k: i + 1, name, abbreviation, ginsburg: i === 0 ? 22 : i }),
  ),
)

/** How {@link tziruph} treats the two self-mirrored letters of an even table. */
export type TziruphSelfPairs = 'swap' | 'fixed'

/** Options for {@link tziruph}. */
export interface TziruphOptions {
  /**
   * `'swap'` (default) pairs the two self-mirrored letters of an even table with
   * each other (Mathers' Albath: א↔ל); `'fixed'` leaves them unchanged. No
   * effect on odd tables, which have none.
   */
  readonly selfPairs?: TziruphSelfPairs
}

function checkTable(k: unknown): number {
  if (typeof k !== 'number' || !Number.isInteger(k) || k < 1 || k > 22) {
    throw new GematriaError(
      'invalid_input',
      `tziruph table must be an integer in [1, 22], got ${String(k)}`,
    )
  }
  return k
}

function checkSelfPairs(opts: unknown): TziruphSelfPairs {
  if (opts === undefined) return 'swap'
  if (!isOptionsObject(opts)) {
    throw new GematriaError('invalid_input', 'tziruph options must be an object')
  }
  const mode = opts.selfPairs ?? 'swap'
  if (mode !== 'swap' && mode !== 'fixed') {
    throw new GematriaError(
      'invalid_input',
      `selfPairs must be 'swap' or 'fixed', got ${String(mode)}`,
    )
  }
  return mode
}

/** 0-based partner of 0-based letter `i` in table `k`. */
function partner(k: number, i: number, mode: TziruphSelfPairs): number {
  const j = (((k - 2 - i) % 22) + 22) % 22
  return j === i && mode === 'swap' ? (i + 11) % 22 : j
}

/**
 * Apply commutation table `k` (1 … 22, see {@link TZIRUPH_TABLES} and the named
 * constants {@link ALBATH} … {@link ASHBAR}) to the Hebrew letters of `text`:
 * letter $i$ becomes letter $k - i \pmod{22}$. Every table is an involution.
 * Text is normalized for Hebrew, finals fold to their base letter, and other
 * characters pass through. `tziruph(x, ATHBASH)` equals `atbash(x)`; by Albath,
 * רוח (RVCh) becomes דצע (DTzO).
 *
 * @throws GematriaError `'invalid_input'` if `text` is not a string, `k` is not
 *   an integer in $[1, 22]$, or `opts.selfPairs` is not `'swap'`/`'fixed'`
 */
export function tziruph(text: string, k: number, opts?: TziruphOptions): string {
  const table = checkTable(k)
  const mode = checkSelfPairs(opts)
  return substituteHebrew(text, (i) => partner(table, i, mode))
}

/** Which "Table of the Commutations" {@link tziruphSquare} builds. */
export type TziruphSquareKind = 'right' | 'averse'

/**
 * Mathers' Right or Averse "Table of the Commutations": a 22 × 22 square of
 * Hebrew letters (484 cells), frozen. Each row lists its letters in reading
 * order (index 0 is the first, i.e. rightmost, letter). The **Right** table's
 * row $r$ is the alphabet starting from letter $r$ (א … ת, then ב … א, then
 * ג … ב, …); the **Averse** table's row $r$ is the alphabet backwards starting
 * from ת moved back $r$ places (ת … א, then ש … ת, …). Row $r$ of the Right
 * table is the {@link temurahShift} by $r$.
 *
 * @throws GematriaError `'invalid_input'` for any other `kind`
 */
export function tziruphSquare(kind: TziruphSquareKind): readonly (readonly string[])[] {
  if (kind !== 'right' && kind !== 'averse') {
    throw new GematriaError(
      'invalid_input',
      `square kind must be 'right' or 'averse', got ${String(kind)}`,
    )
  }
  const rows: (readonly string[])[] = []
  for (let r = 0; r < 22; r++) {
    const row: string[] = []
    for (let c = 0; c < 22; c++) {
      const index = kind === 'right' ? (r + c) % 22 : (((21 - r - c) % 22) + 22) % 22
      row.push(HE_BASE[index] as string)
    }
    rows.push(Object.freeze(row))
  }
  return Object.freeze(rows)
}
