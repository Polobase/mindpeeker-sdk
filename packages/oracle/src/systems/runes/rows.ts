import type { SpreadPosition } from '../tarot/data.js'
import { type AettName, ELDER_FUTHARK, type Rune } from './data.js'

/**
 * Rune rows other than the Elder Futhark, the blank rune, and the named
 * rune layouts. Glyphs are Unicode Runic block characters whose standard
 * names identify them (e.g. U+16E1 RUNIC LETTER IOR).
 *
 * - `'younger'` — the 16-rune Younger Futhark (Scandinavia, after c. 800),
 *   long-branch glyphs, in the order and Old Norse names of the Norwegian
 *   rune poem (Dickins, *Runic and Heroic Poems of the Old Teutonic
 *   Peoples*, 1915, pp. 24–27 — public domain): fé úr þurs óss reið kaun |
 *   hagall nauðr íss ár sól | týr bjarkan maðr lǫgr ýr. The three ættir
 *   (6/5/5) were "retained even after it was reduced to the Younger form"
 *   (Gundarsson 1990, p. 97).
 * - `'futhorc29'` — the Anglo-Saxon futhorc in the stanza order of the Old
 *   English rune poem (Hickes 1705, ed. Dickins 1915, pp. 12–23): the 24
 *   inherited runes with *ēþel* before *dæg*, then *āc, æsc, ȳr, īor, ēar*.
 * - `'futhorc28'` — the same row without *īor*, the 28-rune futhorc
 *   (Codex Sangallensis 878 and Cotton Domitian A.ix also place *ȳr* before
 *   *ēar*; Codex Vindobonensis 795 has *ēar* before *ȳr* — row orders differ
 *   between manuscripts, so this one is a documented convention, not the
 *   only one).
 * - `'futhorc33'` — `'futhorc29'` plus the four runes Hickes prints after the
 *   poem without verses, in his order *cweorð, calc, stān, gār* (Dickins
 *   1915, note to v. 91; taken from Cotton Domitian A.ix).
 *
 * Names are normalized Old English / Old Norse forms. Orientation is not
 * modeled outside the Elder Futhark (`invertible: false`; casts reject
 * `merkstave: true` for these rows). Which runes of these rows are
 * point-symmetric depends on the glyph form a font or carver uses, so no
 * reversal set is claimed.
 */

/** A rune row selectable in `castRunes`. */
export type Futhark = 'elder' | 'younger' | 'futhorc28' | 'futhorc29' | 'futhorc33'

const AETT_NAMES: readonly AettName[] = ['Freyr', 'Heimdall', 'Tyr']

function row(
  entries: readonly (readonly [string, string, string])[],
  aettOf: (index: number) => 1 | 2 | 3 | null,
): readonly Rune[] {
  return Object.freeze(
    entries.map(([id, name, glyph], index) => {
      const aett = aettOf(index)
      return Object.freeze({
        id,
        name,
        glyph,
        aett,
        aettName: aett === null ? null : (AETT_NAMES[aett - 1] as AettName),
        invertible: false,
        modern: false,
        index,
      })
    }),
  )
}

// [id, name, glyph]
const YOUNGER: readonly (readonly [string, string, string])[] = [
  ['fe', 'Fé', 'ᚠ'],
  ['ur', 'Úr', 'ᚢ'],
  ['thurs', 'Þurs', 'ᚦ'],
  ['oss', 'Óss', 'ᚬ'],
  ['reid', 'Reið', 'ᚱ'],
  ['kaun', 'Kaun', 'ᚴ'],
  ['hagall', 'Hagall', 'ᚼ'],
  ['naudr', 'Nauðr', 'ᚾ'],
  ['iss', 'Íss', 'ᛁ'],
  ['ar', 'Ár', 'ᛅ'],
  ['sol', 'Sól', 'ᛋ'],
  ['tyr', 'Týr', 'ᛏ'],
  ['bjarkan', 'Bjarkan', 'ᛒ'],
  ['madr', 'Maðr', 'ᛘ'],
  ['logr', 'Lǫgr', 'ᛚ'],
  ['yr', 'Ýr', 'ᛦ'],
]

/** The 16-rune Younger Futhark (long-branch glyphs), ættir 6/5/5. */
export const YOUNGER_FUTHARK: readonly Rune[] = row(YOUNGER, (i) => (i < 6 ? 1 : i < 11 ? 2 : 3))

// The Old English rune poem order (29 stanzas).
const POEM: readonly (readonly [string, string, string])[] = [
  ['feoh', 'Feoh', 'ᚠ'],
  ['ur', 'Ur', 'ᚢ'],
  ['thorn', 'Þorn', 'ᚦ'],
  ['os', 'Os', 'ᚩ'],
  ['rad', 'Rad', 'ᚱ'],
  ['cen', 'Cen', 'ᚳ'],
  ['gyfu', 'Gyfu', 'ᚷ'],
  ['wynn', 'Wynn', 'ᚹ'],
  ['haegl', 'Hægl', 'ᚻ'],
  ['nyd', 'Nyd', 'ᚾ'],
  ['is', 'Is', 'ᛁ'],
  ['ger', 'Ger', 'ᛄ'],
  ['eoh', 'Eoh', 'ᛇ'],
  ['peorth', 'Peorð', 'ᛈ'],
  ['eolhx', 'Eolhx', 'ᛉ'],
  ['sigel', 'Sigel', 'ᛋ'],
  ['tir', 'Tir', 'ᛏ'],
  ['beorc', 'Beorc', 'ᛒ'],
  ['eh', 'Eh', 'ᛖ'],
  ['mann', 'Mann', 'ᛗ'],
  ['lagu', 'Lagu', 'ᛚ'],
  ['ing', 'Ing', 'ᛝ'],
  ['ethel', 'Eþel', 'ᛟ'],
  ['daeg', 'Dæg', 'ᛞ'],
  ['ac', 'Ac', 'ᚪ'],
  ['aesc', 'Æsc', 'ᚫ'],
  ['yr', 'Yr', 'ᚣ'],
  ['ior', 'Ior', 'ᛡ'],
  ['ear', 'Ear', 'ᛠ'],
]

const HICKES_EXTRA: readonly (readonly [string, string, string])[] = [
  ['cweorth', 'Cweorð', 'ᛢ'],
  ['calc', 'Calc', 'ᛣ'],
  ['stan', 'Stan', 'ᛥ'],
  ['gar', 'Gar', 'ᚸ'],
]

const noAett = () => null

/** 28-rune Anglo-Saxon futhorc: the rune-poem order without *īor*. */
export const FUTHORC_28: readonly Rune[] = row(
  POEM.filter(([id]) => id !== 'ior'),
  noAett,
)

/** 29-rune Anglo-Saxon futhorc in the Old English rune poem's stanza order. */
export const FUTHORC_29: readonly Rune[] = row(POEM, noAett)

/** 33-rune Anglo-Saxon futhorc: the poem's 29 plus *cweorð, calc, stān, gār*. */
export const FUTHORC_33: readonly Rune[] = row([...POEM, ...HICKES_EXTRA], noAett)

/** Every selectable row, keyed by {@link Futhark}. */
export const FUTHARKS: Readonly<Record<Futhark, readonly Rune[]>> = Object.freeze({
  elder: ELDER_FUTHARK,
  younger: YOUNGER_FUTHARK,
  futhorc28: FUTHORC_28,
  futhorc29: FUTHORC_29,
  futhorc33: FUTHORC_33,
})

const WITH_BLANK = new Map<Futhark, readonly Rune[]>()

/**
 * The drawable set for a row: the row itself, or — with `blank` — the row
 * plus the blank rune at index `row.length` (id `'blank'`, empty glyph, no
 * ætt, never invertible, `modern: true`). The blank "Wyrd" stave was added
 * by Ralph Blum (*The Book of Runes*, 1982: "twenty-four Runes, plus one
 * later innovation, a Blank Rune") and is rejected by traditional
 * runeworkers.
 *
 * @internal cached and frozen per row
 */
export function runeSet(futhark: Futhark, blank: boolean): readonly Rune[] {
  const base = FUTHARKS[futhark]
  if (!blank) return base
  let set = WITH_BLANK.get(futhark)
  if (set === undefined) {
    const blankRune: Rune = Object.freeze({
      id: 'blank',
      name: 'Blank',
      glyph: '',
      aett: null,
      aettName: null,
      invertible: false,
      modern: true,
      index: base.length,
    })
    set = Object.freeze([...base, blankRune])
    WITH_BLANK.set(futhark, set)
  }
  return set
}

/** Name of a built-in rune layout. */
export type RuneLayoutName = 'norns'

/** A rune layout: named positions filled in draw order. */
export interface RuneLayout {
  readonly id: string
  readonly name: string
  readonly positions: readonly SpreadPosition[]
}

const position = (name: string, meaning: string): SpreadPosition => Object.freeze({ name, meaning })

/**
 * Named rune layouts. `norns` — the three-rune cast laid out
 * Urðr–Verðandi–Skuld (Gundarsson, *Teutonic Magic*, 1990, p. 102;
 * meanings paraphrased): "that which is", "that which is coming into being
 * now", and what should result "if nothing is done to change things".
 */
export const RUNE_LAYOUTS: Readonly<Record<RuneLayoutName, RuneLayout>> = Object.freeze({
  norns: Object.freeze({
    id: 'norns',
    name: 'The Three Norns',
    positions: Object.freeze([
      position('Urðr', 'That which is: the roots and layers shaping the situation'),
      position('Verðandi', 'That which is coming into being now'),
      position('Skuld', 'What should result if nothing is done to change things'),
    ]),
  }),
})
