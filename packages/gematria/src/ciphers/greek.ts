/**
 * Greek isopsephy — the Milesian numeral system. The 24 classical letters plus
 * three archaic numeral letters fill the ones/tens/hundreds decades:
 *
 * $$\alpha1\,\beta2\,\gamma3\,\delta4\,\varepsilon5\,\digamma6\,\zeta7\,\eta8\,
 * \theta9\;\iota10\,\kappa20\,\lambda30\,\mu40\,\nu50\,\xi60\,o70\,\pi80\,
 * \koppa90\;\rho100\,\sigma200\,\tau300\,\upsilon400\,\phi500\,\chi600\,
 * \psi700\,\omega800\,\sampi900.$$
 *
 * The archaic numerals: digamma/stigma ϝ/ϛ = 6, koppa ϙ/ϟ = 90, sampi ϡ = 900.
 * Final sigma ς scores 200 like medial σ. Text is lowercased and its accents,
 * breathings and iota subscripts are stripped before summing (see
 * {@link normalizeFor}). This is the system behind ἀγάπη = θέλημα = 93 and the
 * riddle χξϛ = 666 (Revelation 13:18).
 *
 * Sources: standard Milesian isopsephy tables; F. Bennett, *A History of the
 * Greek Numeral Notation* (the archaic decade letters).
 */

import type { Cipher, LetterValue } from '../types.js'

// [glyph, value] ascending; digamma/stigma (6), archaic/numeral koppa (90) and
// medial/final sigma (200) each list decade-sharing variant glyphs.
const GREEK_ROWS: readonly (readonly [string, number])[] = [
  ['α', 1],
  ['β', 2],
  ['γ', 3],
  ['δ', 4],
  ['ε', 5],
  ['ϝ', 6],
  ['ϛ', 6],
  ['ζ', 7],
  ['η', 8],
  ['θ', 9],
  ['ι', 10],
  ['κ', 20],
  ['λ', 30],
  ['μ', 40],
  ['ν', 50],
  ['ξ', 60],
  ['ο', 70],
  ['π', 80],
  ['ϙ', 90],
  ['ϟ', 90],
  ['ρ', 100],
  ['σ', 200],
  ['ς', 200],
  ['τ', 300],
  ['υ', 400],
  ['φ', 500],
  ['χ', 600],
  ['ψ', 700],
  ['ω', 800],
  ['ϡ', 900],
]

const GREEK_VALUES: ReadonlyMap<string, number> = new Map(GREEK_ROWS)

function isopsephy(ch: string): number {
  return GREEK_VALUES.get(ch) ?? 0
}

const GREEK_TABLE: readonly LetterValue[] = Object.freeze(
  GREEK_ROWS.map(([char, value]) => Object.freeze({ char, value })),
)

/** The single Greek cipher (isopsephy). */
export const GREEK_CIPHERS: readonly Cipher[] = Object.freeze([
  Object.freeze({
    id: 'gr-isopsephy',
    label: 'Isopsephy',
    script: 'greek',
    modern: false,
    letterValue: isopsephy,
    table: GREEK_TABLE,
  }),
])
