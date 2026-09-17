import { describe, expect, test } from 'bun:test'
import { GREEK_CIPHERS } from '../../src/ciphers/greek.js'
import { normalizeFor } from '../../src/normalize.js'
import { value } from '../../src/value.js'

describe('greek isopsephy', () => {
  test('isopsephy is deeply frozen with a complete Milesian table', () => {
    expect(GREEK_CIPHERS.map((x) => x.id)).toEqual(['gr-isopsephy', 'gr-ordinal'])
    const c = GREEK_CIPHERS[0]
    expect(c).toBeDefined()
    if (!c) return
    expect(Object.isFrozen(c)).toBe(true)
    expect(Object.isFrozen(c.table)).toBe(true)
    for (const row of c.table) expect(Object.isFrozen(row)).toBe(true)
    // 24 classical + final sigma + digamma/stigma + archaic/numeral koppa + sampi = 30
    expect(c.table.length).toBe(30)
    // the canonical alphabet is the 27 numeral letters
    expect(c.alphabet.join('')).toBe('αβγδεϝζηθικλμνξοπϙρστυφχψωϡ')
    expect(c.fold('ς')).toBe('σ')
    expect(c.fold('ϛ')).toBe('ϝ')
    expect(c.fold('Ϟ')).toBe('ϙ')
  })

  test('the archaic decade numerals score correctly', () => {
    expect(value('ϝ', 'gr-isopsephy')).toBe(6) // digamma U+03DD
    expect(value('ϛ', 'gr-isopsephy')).toBe(6) // stigma U+03DB
    expect(value('ϙ', 'gr-isopsephy')).toBe(90) // archaic koppa U+03D9
    expect(value('ϡ', 'gr-isopsephy')).toBe(900) // sampi U+03E1
  })

  test('both koppa glyphs (archaic and numeral) score 90 in either case', () => {
    // Archaic koppa U+03D8/U+03D9 (the epigraphic closed-Q shape).
    expect(value('ϙ', 'gr-isopsephy')).toBe(90) // ϙ lowercase archaic
    expect(value('Ϙ', 'gr-isopsephy')).toBe(90) // Ϙ uppercase archaic
    // Numeral koppa U+03DE/U+03DF (the lightning-bolt ϟ used for 90 in Milesian).
    expect(value('ϟ', 'gr-isopsephy')).toBe(90) // ϟ lowercase numeral
    expect(value('Ϟ', 'gr-isopsephy')).toBe(90) // Ϟ uppercase numeral folds via lowercase
  })

  test('final sigma equals medial sigma (200)', () => {
    expect(value('ς', 'gr-isopsephy')).toBe(200)
    expect(value('σ', 'gr-isopsephy')).toBe(200)
    // λόγος: uppercase + accent + trailing final sigma all normalize away
    expect(value('ΛΟΓΟΣ', 'gr-isopsephy')).toBe(value('λογος', 'gr-isopsephy'))
  })

  test('diacritics are stripped before summing', () => {
    expect(normalizeFor('Θέλημα', 'greek')).toBe('θελημα')
    expect(value('Θέλημα', 'gr-isopsephy')).toBe(93)
  })

  test('χξϛ = 666, the isopsephy riddle of Revelation 13:18', () => {
    expect(value('χξϛ', 'gr-isopsephy')).toBe(666)
  })
})

describe('greek compatibility normalization', () => {
  test('symbol letters score as their letters (NFKD policy)', () => {
    expect(value('ϑ', 'gr-isopsephy')).toBe(9)
    expect(value('ϕ', 'gr-isopsephy')).toBe(500)
    expect(value('ϖ', 'gr-isopsephy')).toBe(80)
    expect(value('ϰ', 'gr-isopsephy')).toBe(20)
    expect(value('ϱ', 'gr-isopsephy')).toBe(100)
    expect(value('ϲ', 'gr-isopsephy')).toBe(200) // lunate sigma
    expect(value('ϐ', 'gr-isopsephy')).toBe(2)
    expect(value('ϵ', 'gr-isopsephy')).toBe(5)
    expect(value('µ', 'gr-isopsephy')).toBe(40) // micro sign
    // φιλος typeset with the phi symbol: 500 + 10 + 30 + 70 + 200
    expect(value('ϕιλος', 'gr-isopsephy')).toBe(810)
    expect(value('ϕιλος', 'gr-isopsephy')).toBe(value('φιλος', 'gr-isopsephy'))
  })

  test('format controls inside a word are ignored', () => {
    expect(value('θε\u200Bλη\u200Dμα', 'gr-isopsephy')).toBe(93)
  })
})

describe('greek ordinal (Agrippa, first manner)', () => {
  const ordinal = GREEK_CIPHERS[1]

  test('is extended, historical, and runs α1 … ω24', () => {
    expect(ordinal?.id).toBe('gr-ordinal')
    expect(ordinal?.extended).toBe(true)
    expect(ordinal?.modern).toBe(false)
    expect(ordinal?.alphabet.length).toBe(24)
    expect(value('α', 'gr-ordinal')).toBe(1)
    expect(value('ι', 'gr-ordinal')).toBe(9)
    expect(value('σ', 'gr-ordinal')).toBe(18)
    expect(value('ς', 'gr-ordinal')).toBe(18)
    expect(value('ω', 'gr-ordinal')).toBe(24)
  })

  test("Hubbard's Σ18 + Π16 + Φ21 = 55, and the archaic numerals score 0", () => {
    expect(value('ΣΠΦ', 'gr-ordinal')).toBe(55)
    expect(value('ϝϛϙϟϡ', 'gr-ordinal')).toBe(0)
    // λ11 ο15 γ3 ο15 ς18
    expect(value('λόγος', 'gr-ordinal')).toBe(62)
  })

  test('reverse mirrors the 24 letters (α↔ω)', () => {
    expect(value('α', 'gr-ordinal', true)).toBe(24)
    expect(value('ω', 'gr-ordinal', true)).toBe(1)
    expect(value('ς', 'gr-ordinal', true)).toBe(value('σ', 'gr-ordinal', true))
  })
})
