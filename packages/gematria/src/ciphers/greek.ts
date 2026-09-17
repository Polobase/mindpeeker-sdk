/**
 * The Greek ciphers — Agrippa's "first" and "second manner" of Greek
 * numeration (*De Occulta Philosophia* II, ch. xviii).
 *
 * **Isopsephy** (`gr-isopsephy`, the Milesian numerals). The 24 classical
 * letters plus three archaic numeral letters fill the ones/tens/hundreds:
 *
 * $$\alpha1\,\beta2\,\gamma3\,\delta4\,\varepsilon5\,\digamma6\,\zeta7\,\eta8\,
 * \theta9\;\iota10\,\kappa20\,\lambda30\,\mu40\,\nu50\,\xi60\,o70\,\pi80\,
 * \koppa90\;\rho100\,\sigma200\,\tau300\,\upsilon400\,\phi500\,\chi600\,
 * \psi700\,\omega800\,\sampi900.$$
 *
 * The canonical alphabet is these 27 numeral letters. Glyph variants fold to
 * them: stigma ϛ → digamma ϝ (6), numeral koppa ϟ → archaic koppa ϙ (90), final
 * sigma ς → σ (200). Reverse mirrors the 27 positions (α↔ϡ, ζ↔τ, η↔σ, θ↔ρ,
 * ι↔ϙ, κ↔π, λ↔ο, μ↔ξ, ν fixed), so ς and σ, ϛ and ϝ, ϟ and ϙ always share a
 * reversed value. This is the system behind ἀγάπη = θέλημα = 93 and the riddle
 * χξϛ = 666 (Revelation 13:18).
 *
 * **Ordinal** (`gr-ordinal`, `extended: true`) — Agrippa's first manner, "every
 * Element according to the series of the Alphabet signifying the number of its
 * place": α1 β2 … σ/ς18 τ19 υ20 φ21 χ22 ψ23 ω24. The archaic numerals are not
 * letters of the 24-letter alphabet and score 0.
 *
 * Text is lowercased and its accents, breathings and iota subscripts are
 * stripped before summing, and the Greek symbol letters (ϐ ϑ ϕ ϖ ϰ ϱ ϲ ϵ) fold
 * to their letters under compatibility normalization (see {@link normalizeFor}).
 *
 * Sources: Agrippa, *De Occulta Philosophia* II.xviii (both manners, the three
 * added numeral signs for 6, 90 and 900); F. Bennett, *A History of the Greek
 * Numeral Notation*; Hubbard, *Number Games* (Greek ordinal Σ18 Π16 Φ21).
 */

import type { Cipher } from '../types.js'
import { defineCipher, glyphs, numeralLadder } from './define.js'

/** The 27 Milesian numeral letters in value order. */
const MILESIAN = glyphs('α β γ δ ε ϝ ζ η θ ι κ λ μ ν ξ ο π ϙ ρ σ τ υ φ χ ψ ω ϡ')

/** The 24 letters of the classical alphabet. */
const CLASSICAL = glyphs('α β γ δ ε ζ η θ ι κ λ μ ν ξ ο π ρ σ τ υ φ χ ψ ω')

const SIGMA_VARIANTS = Object.freeze({ ς: 'σ' })

/** The two Greek ciphers: isopsephy (frontend parity) and the extended ordinal. */
export const GREEK_CIPHERS: readonly Cipher[] = Object.freeze([
  defineCipher({
    id: 'gr-isopsephy',
    label: 'Isopsephy',
    description:
      'Milesian isopsephy: α1…θ9 with digamma/stigma ϝ/ϛ 6, ι10…π80 with koppa ϙ/ϟ 90, ρ100…ω800 ' +
      'with sampi ϡ 900; final sigma counts as σ.',
    script: 'greek',
    modern: false,
    alphabet: MILESIAN,
    variants: Object.freeze({ ...SIGMA_VARIANTS, ϛ: 'ϝ', ϟ: 'ϙ' }),
    // Display rows keep the variant glyphs next to their numeral (30 rows).
    tableGlyphs: glyphs('α β γ δ ε ϝ ϛ ζ η θ ι κ λ μ ν ξ ο π ϙ ϟ ρ σ ς τ υ φ χ ψ ω ϡ'),
    value: (letter) => numeralLadder(MILESIAN.indexOf(letter)),
  }),
  defineCipher({
    id: 'gr-ordinal',
    label: 'Ordinal (Agrippa)',
    description:
      "Greek ordinal, Agrippa's first manner (De Occulta Philosophia II.xviii): each of the 24 " +
      'letters scores its place, α1 … ω24; the archaic numerals score 0.',
    script: 'greek',
    modern: false,
    extended: true,
    alphabet: CLASSICAL,
    variants: SIGMA_VARIANTS,
    tableGlyphs: glyphs('α β γ δ ε ζ η θ ι κ λ μ ν ξ ο π ρ σ ς τ υ φ χ ψ ω'),
    value: (letter) => CLASSICAL.indexOf(letter) + 1,
  }),
])
