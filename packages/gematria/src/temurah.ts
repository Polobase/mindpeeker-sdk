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
 * - **Achbi** (אכב״י) splits the alphabet into two elevens and reverses each
 *   half onto itself: א↔כ, ב↔י, ג↔ט, ד↔ח, ה↔ז with ו fixed, and ל↔ת, מ↔ש,
 *   נ↔ר, ס↔ק, ע↔צ with פ fixed ($i \mapsto 10 - i$ within each half). Like
 *   every commutation it is named after its first two pairs, A↔K and B↔I
 *   (Mathers; Ginsburg's table no. 11). An involution.
 * - **Aibat** (איב״ט) is the neighbouring commutation, Ginsburg's no. 10:
 *   א↔י, ב↔ט, ג↔ח, ד↔ז, ה↔ו and ל↔ש, מ↔ר, נ↔ק, ס↔צ, ע↔פ, here with the
 *   eleventh letter of each half (כ, ת) fixed ($i \mapsto (9 - i) \bmod 11$
 *   within each half). This is the mapping 0.1.x shipped under the name `achbi`.
 * - **{@link temurahShift}** is the generic cyclic shift by any $n \bmod 22$.
 *
 * The folded-halves `achbi`/`aibat` keep their self-paired letters fixed
 * (ו/פ, כ/ת). Mathers' 22-table construction ({@link tziruph}) instead pairs
 * those two letters with each other, so `achbi(x)` and `tziruph(x, ACHBI)` differ
 * exactly at ו↔פ, and `aibat(x)` and `tziruph(x, AIBAT)` exactly at כ↔ת.
 *
 * These return the *substituted string*; the corresponding `he-atbash` /
 * `he-albam` ciphers give the substituted word's Hechrachi value, so
 * `value(atbash(x), 'he-hechrachi') === value(x, 'he-atbash')`. Text is
 * normalized for Hebrew first (niqqud stripped), final forms fold to their base
 * before substitution, and non-Hebrew characters pass through unchanged.
 *
 * Sources: S. L. MacGregor Mathers, *The Kabbalah Unveiled* (1887, the names of
 * the twenty-two commutations); Christian D. Ginsburg, *The Kabbalah* (1865,
 * p. 55: "10. Aibat. 11. Achbi."); Gershom Scholem, *Kabbalah* (Temurah); Lon
 * Milo DuQuette, *Llewellyn's Complete Book of Ceremonial Magick* (Avgad).
 */

import { HE_BASE, heIndex } from './ciphers/hebrew.js'
import { GematriaError } from './errors.js'
import { normalizeFor } from './normalize.js'
import { requireString } from './validate.js'

/**
 * Substitute every Hebrew letter of `text` by the base letter at
 * `mapIndex(index)` (0-based over the 22).
 *
 * @throws GematriaError `'invalid_input'` if `text` is not a string
 * @internal shared with `tziruph`
 */
export function substituteHebrew(text: string, mapIndex: (i: number) => number): string {
  requireString(text)
  const norm = normalizeFor(text, 'hebrew')
  let out = ''
  for (const ch of norm) {
    const i = heIndex(ch)
    out += i >= 0 ? (HE_BASE[mapIndex(i)] as string) : ch
  }
  return out
}

/**
 * Atbash substitution (א↔ת, …). An involution on Hebrew letters.
 *
 * @throws GematriaError `'invalid_input'` if `text` is not a string
 */
export function atbash(text: string): string {
  return substituteHebrew(text, (i) => 21 - i)
}

/**
 * Albam substitution ($i \mapsto (i + 11) \bmod 22$). An involution.
 *
 * @throws GematriaError `'invalid_input'` if `text` is not a string
 */
export function albam(text: string): string {
  return substituteHebrew(text, (i) => (i + 11) % 22)
}

/**
 * Avgad substitution: each letter → the next, cyclically (ת→א).
 *
 * @throws GematriaError `'invalid_input'` if `text` is not a string
 */
export function avgad(text: string): string {
  return substituteHebrew(text, (i) => (i + 1) % 22)
}

/**
 * Achbi substitution (אכב״י): reverse each half of eleven onto itself — א↔כ,
 * ב↔י, ג↔ט, ד↔ח, ה↔ז with ו fixed; ל↔ת, מ↔ש, נ↔ר, ס↔ק, ע↔צ with פ fixed.
 * An involution. (0.1.x shipped Aibat under this name; see {@link aibat}.)
 *
 * @throws GematriaError `'invalid_input'` if `text` is not a string
 */
export function achbi(text: string): string {
  return substituteHebrew(text, (i) => {
    const block = i < 11 ? 0 : 11
    return block + 10 - (i - block)
  })
}

/**
 * Aibat substitution (איב״ט): within each half of eleven, $i \mapsto (9 - i)
 * \bmod 11$ — א↔י, ב↔ט, ג↔ח, ד↔ז, ה↔ו; ל↔ש, מ↔ר, נ↔ק, ס↔צ, ע↔פ — with the
 * eleventh letter of each half (כ, ת) fixed. An involution. This is the mapping
 * the 0.1.x `achbi` implemented.
 *
 * @throws GematriaError `'invalid_input'` if `text` is not a string
 */
export function aibat(text: string): string {
  return substituteHebrew(text, (i) => {
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
 * @throws GematriaError `'invalid_input'` unless `text` is a string and `n` is a
 *   finite number
 */
export function temurahShift(text: string, n: number): string {
  requireString(text)
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new GematriaError('invalid_input', `shift must be a finite number, got ${String(n)}`)
  }
  const shift = ((Math.trunc(n) % 22) + 22) % 22
  return substituteHebrew(text, (i) => (i + shift) % 22)
}
