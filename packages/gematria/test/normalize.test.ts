import { describe, expect, test } from 'bun:test'
import { detectScript, digitRoot, HEBREW_FINALS, normalizeFor } from '../src/normalize.js'

describe('detectScript', () => {
  test('recognizes Hebrew, Greek (incl. extended), and defaults to Latin', () => {
    expect(detectScript('אחד')).toBe('hebrew')
    expect(detectScript('θελημα')).toBe('greek')
    expect(detectScript('ᾳδω')).toBe('greek') // Greek Extended block
    expect(detectScript('gematria')).toBe('latin')
    expect(detectScript('')).toBe('latin')
    expect(detectScript('123 !?')).toBe('latin')
  })

  test('Hebrew wins over Greek wins over Latin in mixed text', () => {
    expect(detectScript('abc αβγ אבג')).toBe('hebrew')
    expect(detectScript('abc αβγ')).toBe('greek')
  })
})

describe('normalizeFor', () => {
  test('Greek: decompose, drop accents/breathings, lowercase', () => {
    expect(normalizeFor('Θέλημα', 'greek')).toBe('θελημα')
    expect(normalizeFor('ἈΓΆΠΗ', 'greek')).toBe('αγαπη')
  })

  test('Hebrew: strip niqqud and cantillation, keep letters and finals', () => {
    expect(normalizeFor('אֱלֹהִים', 'hebrew')).toBe('אלהים')
    expect(normalizeFor('םן', 'hebrew')).toBe('םן') // finals preserved
  })

  test('Latin: strip diacritics and lowercase', () => {
    expect(normalizeFor('Café', 'latin')).toBe('cafe')
    expect(normalizeFor('NAÏVE', 'latin')).toBe('naive')
  })
})

describe('HEBREW_FINALS', () => {
  test('maps each sofit form to its base letter', () => {
    expect(HEBREW_FINALS).toEqual({ ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' })
    expect(Object.isFrozen(HEBREW_FINALS)).toBe(true)
  })
})

describe('digitRoot', () => {
  test('repeated digit sum, with dr(0)=0', () => {
    expect(digitRoot(0)).toBe(0)
    expect(digitRoot(9)).toBe(9)
    expect(digitRoot(100)).toBe(1)
    expect(digitRoot(12345)).toBe(6)
  })
})
