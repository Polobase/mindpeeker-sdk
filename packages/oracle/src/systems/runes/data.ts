/**
 * The Elder Futhark: 24 runes in three ættir of eight. Glyphs are the
 * Unicode Runic block (U+16A0–U+16FF); names use the common reconstructed
 * Proto-Germanic forms as popularized in modern rune divination (Thorsson,
 * *Futhark: A Handbook of Rune Magic*, 1984); Gundarsson (*Teutonic Magic*,
 * 1990, pp. 97–98) lists the identical order and spellings.
 *
 * **Ætt names vary**: 1 Freyr's (Blum) or Freyja's (Gundarsson) ætt;
 * 2 Heimdall's or Hagal's ætt (Blum 1982 and Arcarti use Hagal; Gundarsson
 * gives both); 3 Tyr's (Tiwaz's) ætt. This table uses Freyr, Heimdall, Tyr.
 *
 * **Invertibility** (`invertible`): a rune can appear *merkstave*
 * ("dark-stave", i.e. upside-down) only when its glyph is distinguishable
 * after a $180°$ rotation. Nine runes are point-symmetric and therefore
 * non-invertible — Gebo ᚷ, Hagalaz ᚺ, Nauthiz ᚾ, Isa ᛁ, Jera ᛃ, Eihwaz ᛇ,
 * Sowilo ᛊ, Ingwaz ᛜ, Dagaz ᛞ — the standard nine-rune non-reversible set
 * of the divination literature (Thorsson 1984; Aswynn, *Leaves of
 * Yggdrasil*, 1990), which coincides exactly with the geometric criterion.
 * The remaining 15 are invertible.
 *
 * Note: the row is the historical 24. The modern blank rune (Ralph Blum,
 * *The Book of Runes*, 1982) is an opt-in of `castRunes` (`blank: true`),
 * flagged `modern`. Other rows (Younger Futhark, Anglo-Saxon futhorc) live
 * in `rows.ts`.
 */

export type AettName = 'Freyr' | 'Heimdall' | 'Tyr'

export interface Rune {
  /** Lowercase ASCII id, unique within its row (`fehu`, `uruz`, …; `blank`). */
  readonly id: string
  readonly name: string
  /** Unicode Runic block glyph, e.g. ᚠ; `''` for the blank rune. */
  readonly glyph: string
  /**
   * Ætt: 1 = Freyr's, 2 = Heimdall's (Hagal's), 3 = Tyr's — eights in the
   * Elder Futhark, 6/5/5 in the Younger Futhark. `null` for the Anglo-Saxon
   * futhorc rows (no ætt division is modeled) and the blank rune.
   */
  readonly aett: 1 | 2 | 3 | null
  readonly aettName: AettName | null
  /**
   * Elder Futhark: `false` iff the glyph is invariant under 180° rotation
   * (the nine-rune non-reversible set; no merkstave). Every other row carries
   * `false` because no reversal convention is modeled for it — casts reject
   * `merkstave: true` there — and the blank rune has no orientation.
   */
  readonly invertible: boolean
  /** `true` only for the blank rune (Blum 1982), a modern addition to the row. */
  readonly modern: boolean
  /** Position in the row (futhark order); the blank rune comes last. */
  readonly index: number
}

// [name, glyph, invertible]
const ROWS: readonly (readonly [string, string, boolean])[] = [
  ['Fehu', 'ᚠ', true],
  ['Uruz', 'ᚢ', true],
  ['Thurisaz', 'ᚦ', true],
  ['Ansuz', 'ᚨ', true],
  ['Raidho', 'ᚱ', true],
  ['Kenaz', 'ᚲ', true],
  ['Gebo', 'ᚷ', false],
  ['Wunjo', 'ᚹ', true],
  ['Hagalaz', 'ᚺ', false],
  ['Nauthiz', 'ᚾ', false],
  ['Isa', 'ᛁ', false],
  ['Jera', 'ᛃ', false],
  ['Eihwaz', 'ᛇ', false],
  ['Perthro', 'ᛈ', true],
  ['Algiz', 'ᛉ', true],
  ['Sowilo', 'ᛊ', false],
  ['Tiwaz', 'ᛏ', true],
  ['Berkano', 'ᛒ', true],
  ['Ehwaz', 'ᛖ', true],
  ['Mannaz', 'ᛗ', true],
  ['Laguz', 'ᛚ', true],
  ['Ingwaz', 'ᛜ', false],
  ['Dagaz', 'ᛞ', false],
  ['Othala', 'ᛟ', true],
]

const AETT_NAMES: readonly AettName[] = ['Freyr', 'Heimdall', 'Tyr']

/** The 24 Elder Futhark runes in futhark order. */
export const ELDER_FUTHARK: readonly Rune[] = Object.freeze(
  ROWS.map(([name, glyph, invertible], index) =>
    Object.freeze({
      id: name.toLowerCase(),
      name,
      glyph,
      aett: (Math.floor(index / 8) + 1) as 1 | 2 | 3,
      aettName: AETT_NAMES[Math.floor(index / 8)] as AettName,
      invertible,
      modern: false,
      index,
    }),
  ),
)
