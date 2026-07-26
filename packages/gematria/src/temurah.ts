/**
 * Temurah — Hebrew letter-substitution ciphers that transform a *word into a
 * word*, one of the three divisions of the literal Kabbalah (Scholem).
 *
 * - **Atbash** maps letter $i$ (0-based over the 22) to letter $21 - i$
 *   (א↔ת, ב↔ש, …). It is its own inverse: $\text{atbash}(\text{atbash}(x)) = x$.
 * - **Albam** maps letter $i$ to $(i + 11) \bmod 22$ (splitting the alphabet in
 *   half and pairing the halves). Also an involution: applying it twice shifts
 *   by $22 \equiv 0$.
 * - **Avgad** (אבג״ד) maps each letter to the *next* in the 22-letter order,
 *   cyclically ($i \mapsto (i + 1) \bmod 22$, so ת→א). Not an involution; it is
 *   {@link temurahShift} by 1. It encrypts יהוה as כוזו, found on mezuzot.
 * - **Achbi** (אכב״י) splits the alphabet into two elevens and folds each so
 *   that א↔י, ב↔ט, … ($i \mapsto (9 - i) \bmod 11$ within each half, leaving
 *   the eleventh letter — כ / ת — fixed). An involution. Sources vary on the
 *   exact Achbi pairing; this follows the pairing in Ginsburg's table.
 * - **{@link temurahShift}** is the generic cyclic shift by any $n \bmod 22$.
 *
 * These return the *substituted string*; the corresponding `he-atbash` /
 * `he-albam` ciphers give the substituted word's Hechrachi value, so
 * `value(atbash(x), 'he-hechrachi') === value(x, 'he-atbash')`. Final forms
 * fold to their base before substitution, and non-Hebrew characters pass
 * through unchanged.
 *
 * Sources: S. L. MacGregor Mathers, *The Kabbalah Unveiled*; Gershom Scholem,
 * *Kabbalah* (Temurah); Christian Ginsburg, *The Kabbalah* (the twenty-two
 * alphabetical commutations, incl. Achbi); Lon Milo DuQuette, *Llewellyn's
 * Complete Book of Ceremonial Magick* (Avgad).
 */

import { HE_BASE, heIndex } from './ciphers/hebrew.js'
import { GematriaError } from './errors.js'
import { normalizeFor } from './normalize.js'

function substitute(text: string, mapIndex: (i: number) => number): string {
  const norm = normalizeFor(text, 'hebrew')
  let out = ''
  for (const ch of norm) {
    const i = heIndex(ch)
    out += i >= 0 ? (HE_BASE[mapIndex(i)] as string) : ch
  }
  return out
}

/** Atbash substitution (א↔ת, …). An involution on Hebrew letters. */
export function atbash(text: string): string {
  return substitute(text, (i) => 21 - i)
}

/** Albam substitution ($i \mapsto (i + 11) \bmod 22$). An involution. */
export function albam(text: string): string {
  return substitute(text, (i) => (i + 11) % 22)
}

/** Avgad substitution: each letter → the next, cyclically (ת→א). */
export function avgad(text: string): string {
  return substitute(text, (i) => (i + 1) % 22)
}

/**
 * Achbi substitution: split the 22 letters into two elevens and fold each so
 * that א↔י, ב↔ט, … within its half, leaving the eleventh letter of each half
 * (כ, ת) fixed. An involution.
 */
export function achbi(text: string): string {
  return substitute(text, (i) => {
    const block = i < 11 ? 0 : 11
    return block + ((9 - (i - block) + 11) % 11)
  })
}

/**
 * Generic cyclic temurah shift: each letter → the one `n` places later in the
 * 22-letter order, modulo 22 (negative `n` shifts earlier). `temurahShift(x, 1)`
 * is {@link avgad}; `temurahShift(x, 11)` is {@link albam}. Undo a shift with
 * its negative: `temurahShift(temurahShift(x, n), -n) === x`.
 *
 * @throws GematriaError `'invalid_input'` unless `n` is a finite number
 */
export function temurahShift(text: string, n: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new GematriaError('invalid_input', `shift must be a finite number, got ${n}`)
  }
  const shift = ((Math.trunc(n) % 22) + 22) % 22
  return substitute(text, (i) => (i + shift) % 22)
}
