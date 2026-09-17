import { describe, expect, test } from 'bun:test'
import { GematriaError } from '../src/errors.js'
import { MAX_HEBREW_NUMERAL, toHebrewNumeral } from '../src/numeral.js'
import { value } from '../src/value.js'

describe('toHebrewNumeral', () => {
  test('writes 15 and 16 as טו and טז, never as divine-name spellings', () => {
    expect(toHebrewNumeral(15)).toBe('ט״ו')
    expect(toHebrewNumeral(16)).toBe('ט״ז')
    expect(toHebrewNumeral(115)).toBe('קט״ו')
    expect(toHebrewNumeral(15, { punctuation: false })).toBe('טו')
    for (let n = 1; n <= 999; n++) {
      const letters = toHebrewNumeral(n, { punctuation: false })
      expect(letters.endsWith('יה') || letters.endsWith('יו')).toBe(false)
    }
  })

  test('punctuation: geresh after one letter, gershayim before the last of several', () => {
    expect(toHebrewNumeral(1)).toBe('א׳')
    expect(toHebrewNumeral(26)).toBe('כ״ו')
    expect(toHebrewNumeral(400)).toBe('ת׳')
    expect(toHebrewNumeral(441)).toBe('תמ״א')
  })

  test('hundreds above 400 are ת-compounds; with finals they are ך ם ן ף ץ', () => {
    expect(toHebrewNumeral(500)).toBe('ת״ק')
    expect(toHebrewNumeral(600)).toBe('ת״ר')
    expect(toHebrewNumeral(700)).toBe('ת״ש')
    expect(toHebrewNumeral(800)).toBe('ת״ת')
    expect(toHebrewNumeral(900)).toBe('תת״ק')
    expect(toHebrewNumeral(999)).toBe('תתקצ״ט')
    expect(toHebrewNumeral(500, { finals: true })).toBe('ך׳')
    expect(toHebrewNumeral(900, { finals: true })).toBe('ץ׳')
    expect(toHebrewNumeral(523, { finals: true })).toBe('ךכ״ג')
  })

  test('thousands are marked with a geresh: 5784 = ה׳תשפ״ד', () => {
    expect(toHebrewNumeral(5784)).toBe('ה׳תשפ״ד')
    expect(toHebrewNumeral(1000)).toBe('א׳')
    expect(toHebrewNumeral(5000)).toBe('ה׳')
    expect(toHebrewNumeral(15015)).toBe('טו׳ט״ו')
    expect(toHebrewNumeral(MAX_HEBREW_NUMERAL)).toBe('תתקצט׳תתקצ״ט')
  })

  test('round trip: Hechrachi (and Gadol with finals) of the numeral is the number, 1…999', () => {
    for (let n = 1; n <= 999; n++) {
      expect(value(toHebrewNumeral(n), 'he-hechrachi')).toBe(n)
      expect(value(toHebrewNumeral(n, { finals: true }), 'he-gadol')).toBe(n)
      expect(value(toHebrewNumeral(n, { punctuation: false }), 'he-hechrachi')).toBe(n)
    }
  })

  test('rejects numbers outside [1, 999999] and non-boolean options', () => {
    for (const n of [0, -1, 1.5, 1_000_000, Number.NaN]) {
      expect(() => toHebrewNumeral(n)).toThrow(expect.objectContaining({ code: 'invalid_input' }))
    }
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => toHebrewNumeral('5' as any)).toThrow(GematriaError)
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => toHebrewNumeral(5, { finals: 'yes' as any })).toThrow(GematriaError)
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => toHebrewNumeral(5, true as any)).toThrow(GematriaError)
  })
})
