import { describe, expect, test } from 'bun:test'
import { ARABIC_CIPHERS } from '../../src/ciphers/arabic.js'
import { detectScript, normalizeFor } from '../../src/normalize.js'
import { value } from '../../src/value.js'

describe('arabic abjad cipher', () => {
  test('is a single, deeply frozen 28-letter table', () => {
    expect(ARABIC_CIPHERS.length).toBe(1)
    const c = ARABIC_CIPHERS[0]
    expect(c?.id).toBe('ar-abjad')
    expect(c?.script).toBe('arabic')
    expect(c?.modern).toBe(false)
    expect(Object.isFrozen(c)).toBe(true)
    expect(c?.table.length).toBe(28)
    for (const row of c?.table ?? []) expect(Object.isFrozen(row)).toBe(true)
  })

  test('Mashriqi values: alif=1 … ya=10 … qaf=100 … ghayn=1000', () => {
    expect(value('ا', 'ar-abjad')).toBe(1)
    expect(value('ي', 'ar-abjad')).toBe(10)
    expect(value('ك', 'ar-abjad')).toBe(20)
    expect(value('ق', 'ar-abjad')).toBe(100)
    expect(value('ر', 'ar-abjad')).toBe(200)
    expect(value('ت', 'ar-abjad')).toBe(400)
    expect(value('غ', 'ar-abjad')).toBe(1000)
  })

  test('abjad = 1+2+3+4 and Allah = 66', () => {
    expect(value('ابجد', 'ar-abjad')).toBe(1 + 2 + 3 + 4)
    expect(value('الله', 'ar-abjad')).toBe(1 + 30 + 30 + 5)
  })

  test('folds alef variants, tāʾ marbūṭa, drops hamza and harakāt', () => {
    // alef variants → bare alef (value 1 each)
    expect(value('آ', 'ar-abjad')).toBe(1)
    expect(value('أ', 'ar-abjad')).toBe(1)
    expect(value('إ', 'ar-abjad')).toBe(1)
    // tāʾ marbūṭa ة folds to hāʾ ه = 5
    expect(value('ة', 'ar-abjad')).toBe(5)
    // free-standing hamza carries no value
    expect(value('ء', 'ar-abjad')).toBe(0)
    // harakāt are stripped: bare vs vocalized word agree
    expect(value('كَتَبَ', 'ar-abjad')).toBe(value('كتب', 'ar-abjad'))
  })

  test('normalizeFor(arabic) strips marks and folds', () => {
    expect(normalizeFor('أآإ', 'arabic')).toBe('ااا')
    expect(normalizeFor('ة', 'arabic')).toBe('ه')
    expect(normalizeFor('ءَ', 'arabic')).toBe('')
    expect(normalizeFor('ؤئى', 'arabic')).toBe('ويي')
  })

  test('hamza on a seat counts as the seat letter; alef maqsura counts as ya', () => {
    // Reference totals derived independently (seat-letter folding over the
    // Mashriqi table): م40 و6 س60 ى→ي10 = 116, etc.
    const expected: Record<string, number> = {
      موسى: 116,
      عيسى: 150,
      مؤمن: 136,
      على: 110,
      إلى: 41,
      سؤال: 97,
      رئيس: 280,
    }
    for (const [word, total] of Object.entries(expected))
      expect(value(word, 'ar-abjad')).toBe(total)
    expect(value('ؤ', 'ar-abjad')).toBe(6)
    expect(value('ئ', 'ar-abjad')).toBe(10)
    expect(value('ى', 'ar-abjad')).toBe(10)
    expect(value('ٱ', 'ar-abjad')).toBe(1)
  })

  test('Persian keheh ک and farsi yeh ی count as kaf and ya; Persian-only letters score 0', () => {
    expect(value('ک', 'ar-abjad')).toBe(20)
    expect(value('ی', 'ar-abjad')).toBe(10)
    expect(value('کتاب', 'ar-abjad')).toBe(value('كتاب', 'ar-abjad'))
    expect(value('پچژگ', 'ar-abjad')).toBe(0)
  })

  test('presentation forms and ligatures decompose to base letters', () => {
    expect(value('\uFDF2', 'ar-abjad')).toBe(66) // ﷲ ALLAH ligature
    expect(value('\uFEFB', 'ar-abjad')).toBe(31) // ﻻ lam-alef ligature
    expect(value('\uFE8D\uFEDF\uFEE0\uFEEA', 'ar-abjad')).toBe(66) // positional forms of الله
    expect(detectScript('\uFEFB')).toBe('arabic')
  })

  test('the cipher fold agrees with normalization for direct letterValue calls', () => {
    const c = ARABIC_CIPHERS[0]
    for (const ch of ['ى', 'ة', 'ک', 'ی', 'ٱ', 'ؤ', 'ئ']) {
      expect(c?.letterValue(ch)).toBe(value(ch, 'ar-abjad'))
    }
  })

  test('format controls (ALM, ZWNJ) do not change the value or the detected script', () => {
    expect(value('مو\u200Cسى', 'ar-abjad')).toBe(116)
    expect(detectScript('\u061Cabc')).toBe('latin')
  })

  test('detectScript recognizes Arabic, and Hebrew still wins over it', () => {
    expect(detectScript('محمد')).toBe('arabic')
    expect(detectScript('abc محمد אבג')).toBe('hebrew')
    expect(detectScript('abc محمد')).toBe('arabic')
  })

  test('a cross-script query scores 0 under the abjad cipher', () => {
    expect(value('gematria', 'ar-abjad')).toBe(0)
    expect(value('אבג', 'ar-abjad')).toBe(0)
  })
})
