// The bundled Sepher Sephiroth corpus, prepared for the page. CLIENT-ONLY
// (imports `@mindpeeker/gematria/lexicon`, which registers the corpus as the
// default lexicon as a side effect — that is what makes the two-argument
// `lookup(n, cipher)` / `matches(text, cipher)` overloads resolve).

import type { CipherId, Script } from '@mindpeeker/gematria'
import { admissibleWords } from '@mindpeeker/gematria'
import type { LexiconEntry } from '@mindpeeker/gematria/lexicon'
import {
  defaultLexicon,
  FAMOUS_NUMBERS,
  SCRIPT_CIPHER,
  SEPHER_SEPHIROTH,
} from '@mindpeeker/gematria/lexicon'

// Registering explicitly (importing the subpath already does it, but the call
// is the documented, tree-shake-proof path).
defaultLexicon()

export { FAMOUS_NUMBERS, SCRIPT_CIPHER, SEPHER_SEPHIROTH }
export type { LexiconEntry }

export interface LexiconScript {
  readonly script: Script
  readonly label: string
  /** The cipher the stored values are computed with (`SCRIPT_CIPHER`). */
  readonly cipher: CipherId
}

/** The three scripts the bundled corpus actually contains. */
export const LEXICON_SCRIPTS: readonly LexiconScript[] = [
  { script: 'hebrew', label: 'Hebrew', cipher: 'he-hechrachi' },
  { script: 'greek', label: 'Greek', cipher: 'gr-isopsephy' },
  { script: 'latin', label: 'English', cipher: 'en-ordinal' },
]

/** Entries of one script, in corpus order (ascending by value). */
export function entriesOf(script: Script): readonly LexiconEntry[] {
  return SEPHER_SEPHIROTH.filter((e) => e.script === script)
}

/** The words a cipher can actually score — the honest commonness denominator. */
export function wordsFor(cipher: CipherId): readonly string[] {
  return admissibleWords(SEPHER_SEPHIROTH, cipher)
}

/** Gloss lookup for a drawn or matched word (first entry wins). */
export function glossOf(word: string): string | undefined {
  return SEPHER_SEPHIROTH.find((e) => e.word === word)?.gloss
}

export interface WordPair {
  a: string
  b: string
}

/**
 * The README's five hand-picked Hebrew equalities — the example that shows the
 * pairing test doing its job (exact p = 1/120 says only that the pairs were
 * chosen for equal values).
 */
export const CLASSIC_PAIRS: readonly WordPair[] = [
  { a: 'אחד', b: 'אהבה' },
  { a: 'נחש', b: 'משיח' },
  { a: 'אל', b: 'לא' },
  { a: 'אדם', b: 'מה' },
  { a: 'ים', b: 'כל' },
]

/** Five pairs nobody chose for their values — the control arm of the same test. */
export const CONTROL_PAIRS: readonly WordPair[] = [
  { a: 'אור', b: 'חשך' },
  { a: 'מים', b: 'אש' },
  { a: 'שמים', b: 'ארץ' },
  { a: 'ראש', b: 'סוף' },
  { a: 'לב', b: 'נפש' },
]

/** Famous numbers as select/quick-pick rows, ascending. */
export function famousNumbers(): { value: number; note: string }[] {
  return Object.entries(FAMOUS_NUMBERS)
    .map(([value, note]) => ({ value: Number(value), note }))
    .sort((a, b) => a.value - b.value)
}
