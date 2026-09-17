import { describe, expect, test } from 'bun:test'
import { GematriaError } from '../src/errors.js'
import { detectScript, digitRoot, HEBREW_FINALS, normalizeFor } from '../src/normalize.js'
import type { Script } from '../src/types.js'

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (e) {
    return e instanceof GematriaError ? e.code : `foreign:${String(e)}`
  }
  return undefined
}

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

  test('recognizes the numeral-alphabet scripts', () => {
    expect(detectScript('Слово')).toBe('cyrillic')
    expect(detectScript('\uA64A')).toBe('cyrillic') // Ꙋ Cyrillic Extended-B
    expect(detectScript('Հայ')).toBe('armenian')
    expect(detectScript('\uFB13')).toBe('armenian') // ﬓ ligature
    expect(detectScript('ქართ')).toBe('georgian')
    expect(detectScript('\u1C90')).toBe('georgian') // Mtavruli
    expect(detectScript('\u2D00')).toBe('georgian') // Nuskhuri
    expect(detectScript('ⲛⲟⲩⲧⲉ')).toBe('coptic')
    expect(detectScript('ϥ')).toBe('coptic') // Coptic letter in the Greek block
    expect(detectScript('ܫܠܡܐ')).toBe('syriac')
    expect(detectScript('𐌲𐌿𐌸')).toBe('gothic')
    // Coptic precedes Greek; Syriac precedes Coptic
    expect(detectScript('αβγ ϣ')).toBe('coptic')
    expect(detectScript('ܐ ⲁ')).toBe('syriac')
  })

  test('ignores format controls and rejects non-strings', () => {
    expect(detectScript('\u200F\u061Cabc')).toBe('latin')
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(codeOf(() => detectScript(42 as any))).toBe('invalid_input')
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

  test('compatibility policy: ligatures, fullwidth, math alphanumerics, symbols (NFKD)', () => {
    expect(normalizeFor('\uFB01', 'latin')).toBe('fi') // ﬁ
    expect(normalizeFor('\uFF21\uFF22', 'latin')).toBe('ab') // fullwidth
    expect(normalizeFor('\u{1D400}', 'latin')).toBe('a') // mathematical bold A
    expect(normalizeFor('\u017F', 'latin')).toBe('s') // long s
    expect(normalizeFor('\u2167', 'latin')).toBe('viii') // Roman numeral eight
    expect(normalizeFor('\u2122', 'latin')).toBe('tm')
    expect(normalizeFor('\u03D1\u03D5\u03D6\u03F0\u03F1\u03F2', 'greek')).toBe('θφπκρς')
  })

  test('format controls are stripped and no-break spaces become spaces', () => {
    const controls = '\u200B\u200C\u200D\u200E\u200F\uFEFF\u00AD\u061C\u2066\u202E\u2060'
    expect(normalizeFor(`ga${controls}ma`, 'latin')).toBe('gama')
    expect(normalizeFor(`אב${controls}ג`, 'hebrew')).toBe('אבג')
    expect(normalizeFor(`اب${controls}ج`, 'arabic')).toBe('ابج')
    expect(normalizeFor('a\u00A0b\u202Fc', 'latin')).toBe('a b c')
    expect(normalizeFor('א\u00A0ב', 'hebrew')).toBe('א ב')
  })

  test('the numeral scripts: marks stripped, lowercased', () => {
    expect(normalizeFor('Ѱ\u0483З', 'cyrillic')).toBe('ѱз') // titlo
    expect(normalizeFor('Й', 'cyrillic')).toBe('и')
    expect(normalizeFor('ⲒⲂ\u0305', 'coptic')).toBe('ⲓⲃ')
    expect(normalizeFor('ܫܠܵܡܵܐ', 'syriac')).toBe('ܫܠܡܐ')
    expect(normalizeFor('\u0587', 'armenian')).toBe('\u0565\u0582') // և → եւ
  })

  test('normalization is idempotent for every script', () => {
    const scripts: Script[] = [
      'hebrew',
      'greek',
      'latin',
      'arabic',
      'cyrillic',
      'armenian',
      'georgian',
      'coptic',
      'syriac',
      'gothic',
    ]
    const sample = 'Ἀγάπη שָׁלוֹם مُؤْمِن Слово ﬁ ᲩⴀႠ ⲒⲂ ܫܠܵܡܵܐ 𐌲𐌿𐌸 \u200D\u00A0Ⅷ'
    for (const script of scripts) {
      const once = normalizeFor(sample, script)
      expect(normalizeFor(once, script)).toBe(once)
    }
  })

  test('an unknown script is unsupported_script; a non-string is invalid_input', () => {
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(codeOf(() => normalizeFor('ÀB', 'bogus' as any))).toBe('unsupported_script')
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(codeOf(() => normalizeFor('ÀB', 'Hebrew' as any))).toBe('unsupported_script')
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(codeOf(() => normalizeFor('ÀB', 'constructor' as any))).toBe('unsupported_script')
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(codeOf(() => normalizeFor(42 as any, 'latin'))).toBe('invalid_input')
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

  test('rejects non-finite input instead of looping', () => {
    expect(codeOf(() => digitRoot(Number.POSITIVE_INFINITY))).toBe('invalid_input')
    expect(codeOf(() => digitRoot(Number.NEGATIVE_INFINITY))).toBe('invalid_input')
    expect(codeOf(() => digitRoot(Number.NaN))).toBe('invalid_input')
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(codeOf(() => digitRoot('9' as any))).toBe('invalid_input')
    // finite magnitudes keep the truncate-and-abs behaviour
    expect(digitRoot(-5)).toBe(5)
    expect(digitRoot(19.9)).toBe(1)
  })
})
