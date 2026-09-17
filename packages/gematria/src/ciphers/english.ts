/**
 * The English / Latin ciphers.
 *
 * Historical and published:
 * - **Ordinal** (`en-ordinal`, "Simple English") — A=1 … Z=26.
 * - **Reduction** (`en-reduction`, "Pythagorean") — each letter's ordinal
 *   reduced to its digital root (A1…I9, J1…R9, S1…Z8), then summed. The
 *   `keepTen` option applies Hubbard's rule that S (ordinal 19) may count 10;
 *   under reverse that is H, the mirror of S.
 * - **Agrippa** (`la-agrippa`) — Heinrich Cornelius Agrippa's Latin key, *De
 *   Occulta Philosophia* Book II, ch. xx (1533; Freake tr. 1651): A1 B2 C3 D4 E5
 *   F6 G7 H8 I9 K10 L20 M30 N40 O50 P60 Q70 R80 S90 T100, the vowel V = 200,
 *   X300 Y400 Z500, and — "their places are supplyed with I, and V simple
 *   consonants, as in the names of John, and Valentine, and hi, and hu aspirate
 *   consonants" — consonantal I = 600, consonantal V = 700, HI = 800, HV = 900.
 *   Read with modern letters: U=200, J=600, V=700, W=900. The digraph HI (800)
 *   is not scored (H and I count 8 + 9). J/U/W are Agrippa's own assignments,
 *   not a later reconstruction.
 * - **Jewish Gematria** (`la-jewish`) — the default English-letter cipher of
 *   gematrix.org and Gematrinator, A1…T100 U200 X300 Y400 Z500 J600 V700 W900
 *   (Hubbard, *Number Games*, confirms U200/V700 with "Tisha B'Av" = 911). It is
 *   *the same table* as Agrippa's key read with modern letters: `la-jewish` is
 *   Agrippa's system under a modern name. Both ids are kept.
 * - **NAEQ / ALW** (`en-naeq`, `extended: true`) — the New Aeon English
 *   Qabalah: A1 L2 W3 H4 S5 D6 O7 Z8 K9 V10 G11 R12 C13 N14 Y15 J16 U17 F18 Q19
 *   B20 M21 X22 I23 T24 E25 P26, hence its name "ALW cipher". It was discovered
 *   by James Lees in November 1976, derived from *Liber AL vel Legis* — not
 *   from *Liber Trigrammaton* (that is the Trigrammaton Qabalah, `en-tq`).
 *
 * Modern (`modern: true` — 20th–21st-century wordplay, NOT ancient; Latin has
 * no native numerals):
 * - **English/Sumerian ×6** (`en-english`, `en-sumerian`) — the ordinal times
 *   six, A=6 … Z=156. "English" and "Sumerian" name the same values on the
 *   online calculators.
 *
 * No cipher here has a *reverse* twin: reverse is a parameter over the a…z
 * alphabet, so `value(text, cipher, true)` mirrors any of them (a↔z).
 *
 * Sources: Agrippa, *De Occulta Philosophia* II.xx (Latin key); Gematrinator /
 * gematrix.org (`la-jewish`); Hubbard, *Number Games* (the Simple, Pythagorean,
 * Jewish and Sumerian tables and the S/H "1 or 10" rule); the New Aeon English
 * Qabalah literature (James Lees, 1976). The ×6 ciphers are recent inventions
 * popularized by online calculators — see the README's honest-framing section.
 */

import { digitRoot } from '../normalize.js'
import type { Cipher } from '../types.js'
import { ENGLISH_MODERN_CIPHERS } from './english-modern.js'
import { LATIN_EXTRA_CIPHERS } from './latin-extra.js'
import { latinCipher, ordinal, rowsValue } from './latin-shared.js'

function reduction(ch: string): number {
  const o = ordinal(ch)
  return o > 0 ? digitRoot(o) : 0
}

/**
 * `en-reduction` under Hubbard's `keepTen` rule: the letter with ordinal 19 (S)
 * scores 10 instead of 1. Reverse mirrors it onto H like every other value.
 */
export function reductionKeepTen(ch: string): number {
  return ordinal(ch) === 19 ? 10 : reduction(ch)
}

// Agrippa's key read with modern letters (II.xx): vowel V → U = 200,
// consonantal I → J = 600, consonantal V → V = 700, HV → W = 900.
const AGRIPPA_KEY = rowsValue([
  ['a', 1],
  ['b', 2],
  ['c', 3],
  ['d', 4],
  ['e', 5],
  ['f', 6],
  ['g', 7],
  ['h', 8],
  ['i', 9],
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
  ['x', 300],
  ['y', 400],
  ['z', 500],
  ['j', 600],
  ['v', 700],
  ['w', 900],
])

// NAEQ / ALW: the 26 letters in the order A L W H S D O Z K V G R C N Y J U F Q
// B M X I T E P, valued 1..26.
const NAEQ_ORDER = 'alwhsdozkvgrcnyjufqbmxitep'
const naeq = rowsValue([...NAEQ_ORDER].map((ch, i) => [ch, i + 1] as const))

function english6(ch: string): number {
  return ordinal(ch) * 6
}

/**
 * The English/Latin ciphers: the historical set, the extended NAEQ, the modern
 * ×6 family, the gematriaq.com-parity calculator ciphers and Plichta's Prime
 * Number Cross (`english-modern.ts`), then the SDK-added extended Latin tables
 * (`latin-extra.ts`: TQ, AQ, Elizabethan, Roman). NAEQ is `extended` (kept out
 * of the default profile) rather than `modern` — it is a documented Thelemic
 * system, not calculator wordplay.
 */
export const ENGLISH_CIPHERS: readonly Cipher[] = Object.freeze([
  latinCipher(
    'en-ordinal',
    'Ordinal',
    'Simple English / Ordinal: each letter scores its position, A=1 … Z=26. Kept modern: false ' +
      'for frontend parity, although English-letter gematria is itself a modern convention.',
    ordinal,
    false,
  ),
  latinCipher(
    'en-reduction',
    'Reduction (Pythagorean)',
    "Pythagorean / Reduction: each letter's ordinal reduced to its digital root (A1…I9, J1…R9, " +
      "S1…Z8). Option keepTen applies Hubbard's rule S=10 (H=10 under reverse).",
    reduction,
    false,
  ),
  latinCipher(
    'la-agrippa',
    'Agrippa (Latin)',
    "Agrippa's Latin key, De Occulta Philosophia II.xx: A1…I9 K10…T100, vowel V (U)=200, X300 " +
      'Y400 Z500, consonantal I (J)=600, consonantal V=700, HV (W)=900; the digraph HI=800 is ' +
      'not scored. The same table as la-jewish.',
    AGRIPPA_KEY,
    false,
  ),
  latinCipher(
    'la-jewish',
    'Jewish',
    "'Jewish Gematria' of gematrix.org and Gematrinator: A1…T100 U200 X300 Y400 Z500 J600 V700 " +
      "W900 — Agrippa's Latin key under a modern name; an English-letter convention, not Hebrew " +
      'gematria.',
    AGRIPPA_KEY,
    false,
  ),
  latinCipher(
    'en-naeq',
    'New Aeon English Qabalah (NAEQ / ALW)',
    'New Aeon English Qabalah (ALW cipher): A1 L2 W3 H4 S5 D6 O7 Z8 K9 V10 … E25 P26, discovered ' +
      'by James Lees in November 1976 from Liber AL vel Legis.',
    naeq,
    false,
    true,
  ),
  latinCipher(
    'en-english',
    'English (×6, modern)',
    'Modern online-calculator cipher: the ordinal times six, A=6 … Z=156 (same values as ' +
      "'Sumerian').",
    english6,
    true,
  ),
  latinCipher(
    'en-sumerian',
    'Sumerian (×6, modern)',
    'Modern online-calculator cipher: the ordinal times six, A=6 … Z=156 (same values as ' +
      "'English'); no connection to Sumerian numerals.",
    english6,
    true,
  ),
  ...ENGLISH_MODERN_CIPHERS,
  ...LATIN_EXTRA_CIPHERS,
])
