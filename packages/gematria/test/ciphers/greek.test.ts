import { describe, expect, test } from 'bun:test'
import { GREEK_CIPHERS } from '../../src/ciphers/greek.js'
import { normalizeFor } from '../../src/normalize.js'
import { value } from '../../src/value.js'

describe('greek isopsephy', () => {
  test('the single cipher is deeply frozen with a complete Milesian table', () => {
    expect(GREEK_CIPHERS.length).toBe(1)
    const c = GREEK_CIPHERS[0]
    expect(c).toBeDefined()
    if (!c) return
    expect(Object.isFrozen(c)).toBe(true)
    expect(Object.isFrozen(c.table)).toBe(true)
    for (const row of c.table) expect(Object.isFrozen(row)).toBe(true)
    // 24 classical + final sigma + digamma/stigma + archaic/numeral koppa + sampi = 30
    expect(c.table.length).toBe(30)
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
