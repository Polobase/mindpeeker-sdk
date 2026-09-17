import { describe, expect, test } from 'bun:test'
import { LATIN_EXTRA_CIPHERS } from '../../src/ciphers/latin-extra.js'
import { letterValues, profile, value } from '../../src/value.js'

// Reference values below were computed independently in Python from the tables
// as published (TQ order, base-36 digits, the 24-letter Elizabethan alphabet,
// Roman numerals), not from this package.

describe('SDK-added Latin tables', () => {
  test('all five are extended Latin ciphers', () => {
    expect(LATIN_EXTRA_CIPHERS.map((c) => c.id)).toEqual([
      'en-tq',
      'en-aq',
      'la-elizabethan-simple',
      'la-elizabethan-kaye',
      'la-roman',
    ])
    for (const c of LATIN_EXTRA_CIPHERS) {
      expect(c.script).toBe('latin')
      expect(c.extended).toBe(true)
    }
    // none of them enters the default (frontend-parity) profile
    const ids = profile('gematria').values.map((v) => v.cipher)
    for (const c of LATIN_EXTRA_CIPHERS) expect(ids).not.toContain(c.id)
    const extended = profile('gematria', { includeExtended: true }).values.map((v) => v.cipher)
    for (const c of LATIN_EXTRA_CIPHERS) expect(extended).toContain(c.id)
  })
})

describe('Trigrammaton Qabalah (en-tq)', () => {
  test('the 27 symbols take the values 0–26 in the order ILCHPAXJWTOGFERSQKYZBMVDNU&', () => {
    const order = 'ilchpaxjwtogfersqkyzbmvdnu&'
    for (const [v, ch] of [...order].entries()) expect(value(ch, 'en-tq')).toBe(v)
    // I is 0, so the table lists 26 glyphs whose values sum to 1 + … + 26
    const table = letterValues('en-tq')
    expect(table.length).toBe(26)
    expect(table.reduce((s, r) => s + r.value, 0)).toBe(351)
  })

  test('word anchors and the a↔& reverse', () => {
    expect(value('Trigrammaton', 'en-tq')).toBe(143)
    expect(value('Thelema', 'en-tq')).toBe(65)
    expect(value('a', 'en-tq', true)).toBe(26) // a mirrors &
    expect(value('&', 'en-tq', true)).toBe(5) // & mirrors a
    expect(value('r', 'en-tq', true)).toBe(value('j', 'en-tq'))
  })
})

describe('Alphanumeric Qabbala (en-aq)', () => {
  test('digits keep their value and A=10 … Z=35', () => {
    expect(value('0123456789', 'en-aq')).toBe(45)
    expect(value('a', 'en-aq')).toBe(10)
    expect(value('Z', 'en-aq')).toBe(35)
    expect(value('AQ', 'en-aq')).toBe(36)
    expect(value('Lemuria', 'en-aq')).toBe(142)
    expect(value('2024 abc', 'en-aq')).toBe(41)
    // fullwidth digits normalize to digits
    expect(value('１２', 'en-aq')).toBe(3)
  })

  test('is modern and the only Latin cipher that scores digits', () => {
    expect(LATIN_EXTRA_CIPHERS[1]?.modern).toBe(true)
    expect(value('2024', 'en-ordinal')).toBe(0)
    expect(value('0', 'en-aq', true)).toBe(35) // 0 mirrors z
  })
})

describe('Elizabethan Simple and Kaye', () => {
  test('Simple: 24 letters with I/J = 9 and U/V = 20 (BACON 33, SHAKESPEARE 103)', () => {
    expect(value('i', 'la-elizabethan-simple')).toBe(9)
    expect(value('j', 'la-elizabethan-simple')).toBe(9)
    expect(value('k', 'la-elizabethan-simple')).toBe(10)
    expect(value('u', 'la-elizabethan-simple')).toBe(20)
    expect(value('v', 'la-elizabethan-simple')).toBe(20)
    expect(value('w', 'la-elizabethan-simple')).toBe(21)
    expect(value('z', 'la-elizabethan-simple')).toBe(24)
    expect(value('Bacon', 'la-elizabethan-simple')).toBe(33)
    expect(value('Shakespeare', 'la-elizabethan-simple')).toBe(103)
    expect(value('Francis Bacon', 'la-elizabethan-simple')).toBe(100)
    expect(letterValues('la-elizabethan-simple').length).toBe(26)
  })

  test("Simple reversed is Hall's Reverse cipher (Z=1 … A=24), J/V mirroring like I/U", () => {
    expect(value('z', 'la-elizabethan-simple', true)).toBe(1)
    expect(value('a', 'la-elizabethan-simple', true)).toBe(24)
    expect(value('Bacon', 'la-elizabethan-simple', true)).toBe(92)
    expect(value('j', 'la-elizabethan-simple', true)).toBe(
      value('i', 'la-elizabethan-simple', true),
    )
    expect(value('v', 'la-elizabethan-simple', true)).toBe(
      value('u', 'la-elizabethan-simple', true),
    )
  })

  test('Kaye: K10 … Z24, & 25, A27 … I/J35', () => {
    expect(value('k', 'la-elizabethan-kaye')).toBe(10)
    expect(value('z', 'la-elizabethan-kaye')).toBe(24)
    expect(value('&', 'la-elizabethan-kaye')).toBe(25)
    expect(value('a', 'la-elizabethan-kaye')).toBe(27)
    expect(value('h', 'la-elizabethan-kaye')).toBe(34)
    expect(value('i', 'la-elizabethan-kaye')).toBe(35)
    expect(value('j', 'la-elizabethan-kaye')).toBe(35)
    expect(value('Bacon', 'la-elizabethan-kaye')).toBe(111)
    expect(value('Francis Bacon', 'la-elizabethan-kaye')).toBe(282)
  })
})

describe('Roman numerals (la-roman)', () => {
  test('I1 V5 X10 L50 C100 D500 M1000, everything else 0', () => {
    expect(value('ivxlcdm', 'la-roman')).toBe(1666)
    expect(value('abefghjknopqrstuwyz', 'la-roman')).toBe(0)
    expect(value('VICARIVS FILII DEI', 'la-roman')).toBe(666)
    // U is not V in this table: the classical spelling is required
    expect(value('VICARIUS FILII DEI', 'la-roman')).toBe(661)
  })

  test('Unicode Roman numeral signs spell out; reverse pairs I↔M, V↔D, X↔C, L↔L', () => {
    expect(value('Ⅷ', 'la-roman')).toBe(8)
    expect(value('ⅿ', 'la-roman')).toBe(1000)
    expect(value('i', 'la-roman', true)).toBe(1000)
    expect(value('v', 'la-roman', true)).toBe(500)
    expect(value('x', 'la-roman', true)).toBe(100)
    expect(value('l', 'la-roman', true)).toBe(50)
    expect(value('m', 'la-roman', true)).toBe(1)
  })
})
