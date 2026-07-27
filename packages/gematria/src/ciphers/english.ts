/**
 * The English / Latin ciphers.
 *
 * Historical:
 * - **Ordinal** (`en-ordinal`, "Simple") — A=1 … Z=26.
 * - **Reduction** (`en-reduction`, Pythagorean) — each letter's ordinal reduced
 *   to its digital root (A=1…I=9, J=1…), then summed.
 * - **Reverse** (`en-reverse`) — reverse ordinal, A=26 … Z=1, i.e. $27 - n$.
 * - **Agrippa** (`la-agrippa`) — Heinrich Cornelius Agrippa's 23-letter Latin
 *   table (*Three Books of Occult Philosophy*, Book II, ch. 20, 1533),
 *   A1 B2 C3 D4 E5 F6 G7 H8 I9 K10 L20 M30 N40 O50 P60 Q70 R80 S90 T100 V200
 *   X300 Y400 Z500, with the common Renaissance reconstruction of the later
 *   letters J=600, U=700, W=900. A reconstructed historical system: classical
 *   Latin had no J/U/W and no native alphabetic numerals of this kind.
 * - **Jewish Gematria** (`la-jewish`) — the English-letter cipher used as the
 *   default on gematrix.org and Gematrinator: A1 B2 C3 D4 E5 F6 G7 H8 I9 K10
 *   L20 M30 N40 O50 P60 Q70 R80 S90 T100 U200 X300 Y400 Z500, following the
 *   same ones/tens/hundreds scale as the 22-letter Hebrew alphabet. J, V and
 *   W have no Hebrew counterpart, so the calculators give them high
 *   sofit-style values: J=600, V=700, W=900. Despite the name, this is a
 *   *modern English-letter convention*, not actual Hebrew gematria — for
 *   that, value Hebrew text under `he-hechrachi`. It differs from
 *   `la-agrippa` only at U and V, whose values are swapped.
 * - **NAEQ / ALW** (`en-naeq`, `extended: true`) — the New Aeon English Qabalah
 *   from Aleister Crowley's *Liber Trigrammaton* (Liber XXVII) / *Liber 805*.
 *   The 26 letters take the values A1 L2 W3 H4 S5 D6 O7 Z8 K9 V10 G11 R12 C13
 *   N14 Y15 J16 U17 F18 Q19 B20 M21 X22 I23 T24 E25 P26 — hence its other name,
 *   the "ALW cipher" (A,L,W = 1,2,3). A documented *historical* Thelemic system,
 *   distinct from and NOT to be confused with the modern ×6 wordplay below; it
 *   is `extended` only so it stays out of the default frontend-parity profile.
 *
 * Modern (`modern: true` — 20th–21st-century wordplay, NOT ancient; Latin has
 * no native numerals):
 * - **English/Sumerian ×6** (`en-english`, `en-sumerian`) — the ordinal times
 *   six, A=6 … Z=156. "English" and "Sumerian" name the same values on the
 *   online calculators.
 * - their **reverse** variants (`en-english-reverse`, `en-sumerian-reverse`) —
 *   the reverse ordinal times six, A=156 … Z=6.
 *
 * Sources: Agrippa, *De Occulta Philosophia* Bk II (Latin table). Jewish
 * Gematria/gematrix.org, Gematrinator (jewish-gematria.com,
 * gematrinator.com) for `la-jewish`. Aleister Crowley, *Liber Trigrammaton sub
 * figura XXVII* and *Liber 805* (the NAEQ / ALW English Qabalah). The ×6
 * ciphers are recent inventions popularized by online calculators
 * (gematrinator.com, bartoll.se) — see the README's honest-framing section.
 */

import { digitRoot } from '../normalize.js'
import type { Cipher, CipherId, LetterValue } from '../types.js'
import { ENGLISH_MODERN_CIPHERS } from './english-modern.js'

/** a … z, the domain of every Latin cipher table. */
const LATIN_ALPHABET: readonly string[] = 'abcdefghijklmnopqrstuvwxyz'.split('')

/** Ordinal A=1 … Z=26 (lowercased input), or 0 for a non-letter. */
function ordinal(ch: string): number {
  const code = ch.codePointAt(0) ?? 0
  return code >= 97 && code <= 122 ? code - 96 : 0
}

function reduction(ch: string): number {
  const o = ordinal(ch)
  return o > 0 ? digitRoot(o) : 0
}

function reverse(ch: string): number {
  const o = ordinal(ch)
  return o > 0 ? 27 - o : 0
}

// Agrippa's Latin table: I and V cover I/J and U/V; J/U/W are the documented
// Renaissance extensions.
const AGRIPPA_ROWS: readonly (readonly [string, number])[] = [
  ['a', 1],
  ['b', 2],
  ['c', 3],
  ['d', 4],
  ['e', 5],
  ['f', 6],
  ['g', 7],
  ['h', 8],
  ['i', 9],
  ['j', 600],
  ['k', 10],
  ['l', 20],
  ['m', 30],
  ['n', 40],
  ['o', 50],
  ['p', 60],
  ['q', 70],
  ['r', 80],
  ['s', 90],
  ['t', 100],
  ['u', 700],
  ['v', 200],
  ['w', 900],
  ['x', 300],
  ['y', 400],
  ['z', 500],
]

const AGRIPPA_VALUES: ReadonlyMap<string, number> = new Map(AGRIPPA_ROWS)

function agrippa(ch: string): number {
  return AGRIPPA_VALUES.get(ch) ?? 0
}

// Jewish Gematria (gematrix.org / Gematrinator default): same ones/tens/
// hundreds scale as Agrippa, but swapped at U/V — the only two letters where
// it disagrees with the Agrippa table.
const JEWISH_ROWS: readonly (readonly [string, number])[] = [
  ['a', 1],
  ['b', 2],
  ['c', 3],
  ['d', 4],
  ['e', 5],
  ['f', 6],
  ['g', 7],
  ['h', 8],
  ['i', 9],
  ['j', 600],
  ['k', 10],
  ['l', 20],
  ['m', 30],
  ['n', 40],
  ['o', 50],
  ['p', 60],
  ['q', 70],
  ['r', 80],
  ['s', 90],
  ['t', 100],
  ['u', 200],
  ['v', 700],
  ['w', 900],
  ['x', 300],
  ['y', 400],
  ['z', 500],
]

const JEWISH_VALUES: ReadonlyMap<string, number> = new Map(JEWISH_ROWS)

function jewish(ch: string): number {
  return JEWISH_VALUES.get(ch) ?? 0
}

// NAEQ / ALW (Crowley, Liber Trigrammaton XXVII): the 26 letters in the order
// derived from Liber AL, valued 1..26. Named the "ALW cipher" for A=1 L=2 W=3.
const NAEQ_ROWS: readonly (readonly [string, number])[] = [
  ['a', 1],
  ['l', 2],
  ['w', 3],
  ['h', 4],
  ['s', 5],
  ['d', 6],
  ['o', 7],
  ['z', 8],
  ['k', 9],
  ['v', 10],
  ['g', 11],
  ['r', 12],
  ['c', 13],
  ['n', 14],
  ['y', 15],
  ['j', 16],
  ['u', 17],
  ['f', 18],
  ['q', 19],
  ['b', 20],
  ['m', 21],
  ['x', 22],
  ['i', 23],
  ['t', 24],
  ['e', 25],
  ['p', 26],
]

const NAEQ_VALUES: ReadonlyMap<string, number> = new Map(NAEQ_ROWS)

function naeq(ch: string): number {
  return NAEQ_VALUES.get(ch) ?? 0
}

function english6(ch: string): number {
  return ordinal(ch) * 6
}

function reverse6(ch: string): number {
  const o = ordinal(ch)
  return o > 0 ? (27 - o) * 6 : 0
}

function table(fn: (ch: string) => number): readonly LetterValue[] {
  return Object.freeze(LATIN_ALPHABET.map((char) => Object.freeze({ char, value: fn(char) })))
}

function latinCipher(
  id: CipherId,
  label: string,
  letterValue: (ch: string) => number,
  modern: boolean,
  extended = false,
): Cipher {
  return Object.freeze({
    id,
    label,
    script: 'latin',
    modern,
    extended,
    letterValue,
    table: table(letterValue),
  })
}

/**
 * The English/Latin ciphers: the historical set, the extended NAEQ, the modern
 * ×6 family, then the gematriaq.com-parity calculator ciphers and Plichta's
 * Prime Number Cross (both from `english-modern.ts`). NAEQ is `extended` (kept
 * out of the default profile) rather than `modern` — it is a documented
 * historical Thelemic cipher, not wordplay.
 */
export const ENGLISH_CIPHERS: readonly Cipher[] = Object.freeze([
  latinCipher('en-ordinal', 'Ordinal', ordinal, false),
  latinCipher('en-reduction', 'Reduction (Pythagorean)', reduction, false),
  latinCipher('en-reverse', 'Reverse', reverse, false),
  latinCipher('la-agrippa', 'Agrippa (Latin, reconstructed)', agrippa, false),
  latinCipher('la-jewish', 'Jewish', jewish, false),
  latinCipher('en-naeq', 'New Aeon English Qabalah (NAEQ / ALW)', naeq, false, true),
  latinCipher('en-english', 'English (×6, modern)', english6, true),
  latinCipher('en-sumerian', 'Sumerian (×6, modern)', english6, true),
  latinCipher('en-english-reverse', 'Reverse English (×6, modern)', reverse6, true),
  latinCipher('en-sumerian-reverse', 'Reverse Sumerian (×6, modern)', reverse6, true),
  ...ENGLISH_MODERN_CIPHERS,
])
