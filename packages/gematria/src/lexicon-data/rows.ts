/**
 * The compact row format of the bundled lexicon data. Rows are expanded into
 * frozen `LexiconEntry` objects by the `@mindpeeker/gematria/lexicon` subpath.
 */

/**
 * Where a lexicon row was taken from (all public domain):
 *
 * - `'sepher-sephiroth'` — Aleister Crowley & Allan Bennett, *Sepher Sephiroth
 *   sub figurâ D*, *The Equinox* I(8), 1912 (special supplement).
 * - `'mathers'` — S. L. MacGregor Mathers, *The Kabbalah Unveiled*, 1887
 *   (Introduction: Shaddai = Metatron = 314, "Shiloh shall come" = Messiah = 358).
 * - `'stirling'` — William Stirling, *The Canon*, 1897 (Greek isopsephy anchors).
 * - `'agrippa'` — H. C. Agrippa, *De Occulta Philosophia* II.xxii, 1533 (the
 *   intelligences and spirits of the planetary squares), cross-checked against
 *   *Sepher Sephiroth*.
 * - `'curated'` — a widely cited value kept from the 0.1 corpus that is not
 *   transcribed from one of the sources above (its arithmetic is still
 *   recomputed like every other row).
 */
export type LexiconSource = 'sepher-sephiroth' | 'mathers' | 'stirling' | 'agrippa' | 'curated'

/** `[word, value, gloss, source, note?]` — the value under the script's canonical cipher. */
export type LexiconRow = readonly [
  word: string,
  value: number,
  gloss: string,
  source: LexiconSource,
  note?: string,
]
