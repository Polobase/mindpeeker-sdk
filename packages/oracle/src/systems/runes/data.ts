/**
 * The Elder Futhark: 24 runes in three ættir of eight. Glyphs are the
 * Unicode Runic block (U+16A0–U+16FF); names use the common reconstructed
 * Proto-Germanic forms as popularized in modern rune divination (Thorsson,
 * *Futhark: A Handbook of Rune Magic*, 1984).
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
 * Note: the deck is the historical 24 — no modern "blank rune" (a 1980s
 * addition popularized by Blum that has no epigraphic basis).
 */

export type AettName = 'Freyr' | 'Heimdall' | 'Tyr'

export interface Rune {
  /** Lowercase id, matching the mindpeeker frontend (`fehu`, `uruz`, …). */
  readonly id: string
  readonly name: string
  /** Unicode Runic block glyph, e.g. ᚠ. */
  readonly glyph: string
  /** Ætt (family of eight): 1 = Freyr's, 2 = Heimdall's, 3 = Tyr's. */
  readonly aett: 1 | 2 | 3
  readonly aettName: AettName
  /** `false` iff the glyph is invariant under 180° rotation (no merkstave). */
  readonly invertible: boolean
  /** Futhark order, 0–23. */
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
      index,
    }),
  ),
)
