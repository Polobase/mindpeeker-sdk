import { describe, expect, test } from 'bun:test'
import { NUMERAL_CIPHERS } from '../../src/ciphers/numerals.js'
import { detectScript } from '../../src/normalize.js'
import { profile, value } from '../../src/value.js'

// Anchors are the worked numeral examples printed in the cited sources
// (Wikipedia "Cyrillic/Armenian/Georgian numerals", "Gothic alphabet"), plus
// sums recomputed independently in Python from tables keyed by Unicode names.

describe('alphabetic numeral ciphers', () => {
  test('six historical ciphers, one per script, each the sole cipher of its script', () => {
    expect(NUMERAL_CIPHERS.map((c) => [c.id, c.script])).toEqual([
      ['cu-cyrillic', 'cyrillic'],
      ['hy-numerals', 'armenian'],
      ['ka-numerals', 'georgian'],
      ['cop-numerals', 'coptic'],
      ['syr-numerals', 'syriac'],
      ['got-numerals', 'gothic'],
    ])
    for (const c of NUMERAL_CIPHERS) {
      expect(c.modern).toBe(false)
      expect(c.extended).toBe(false)
    }
  })

  test('the full numeral alphabets sum to their ladders', () => {
    const sum = (id: string) =>
      NUMERAL_CIPHERS.find((c) => c.id === id)?.alphabet.reduce(
        (s, ch) => s + value(ch, id as 'cu-cyrillic'),
        0,
      )
    // 1+…+9 + 10+…+90 + 100+…+900 = 4995; Syriac stops at 400
    expect(sum('cu-cyrillic')).toBe(4995)
    expect(sum('cop-numerals')).toBe(4995)
    expect(sum('got-numerals')).toBe(4995)
    expect(sum('syr-numerals')).toBe(45 + 450 + 1000)
    expect(sum('hy-numerals')).toBe(49995 + 30000)
    expect(sum('ka-numerals')).toBe(49995 + 10000)
  })

  test('profile() of each script yields its numeral cipher', () => {
    for (const [text, id] of [
      ['Слово', 'cu-cyrillic'],
      ['Հայաստան', 'hy-numerals'],
      ['საქართველო', 'ka-numerals'],
      ['ⲛⲟⲩⲧⲉ', 'cop-numerals'],
      ['ܫܠܡܐ', 'syr-numerals'],
      ['𐌲𐌿𐌸', 'got-numerals'],
    ] as const) {
      const p = profile(text)
      expect(p.values.map((v) => v.cipher)).toEqual([id])
      expect(p.script).toBe(detectScript(text))
    }
  })
})

describe('Cyrillic / Church Slavonic numerals (cu-cyrillic)', () => {
  test('printed examples: ѰЗ = 707, ЦЧѲ = 999, ҂АѰЕ counts АѰЕ = 706', () => {
    expect(value('ѰЗ', 'cu-cyrillic')).toBe(707)
    expect(value('ЦЧѲ', 'cu-cyrillic')).toBe(999)
    // the thousands sign ҂ carries no letter value; the titlo marks are stripped
    expect(value('҂АѰЕ', 'cu-cyrillic')).toBe(706)
    expect(value('҂аѱ҃ѕ', 'cu-cyrillic')).toBe(707)
  })

  test('numeral variants share a value and a reversed value', () => {
    for (const [variant, canonical, v] of [
      ['Є', 'е', 5],
      ['Ҁ', 'ч', 90],
      ['Ѵ', 'у', 400],
      ['Ꙋ', 'у', 400],
      ['Ѿ', 'ѡ', 800],
      ['Ꙍ', 'ѡ', 800],
      ['Ѧ', 'ц', 900],
    ] as const) {
      expect(value(variant, 'cu-cyrillic')).toBe(v)
      expect(value(variant, 'cu-cyrillic', true)).toBe(value(canonical, 'cu-cyrillic', true))
    }
    expect(value('БЖ', 'cu-cyrillic')).toBe(0)
    expect(value('а', 'cu-cyrillic', true)).toBe(900)
  })
})

describe('Armenian numerals (hy-numerals)', () => {
  test('printed examples: ՌՋՀԵ = 1975, ՍՄԻԲ = 2222, ՃԻ = 120, ՍԴ = 2004', () => {
    expect(value('ՌՋՀԵ', 'hy-numerals')).toBe(1975)
    expect(value('ՍՄԻԲ', 'hy-numerals')).toBe(2222)
    expect(value('ՃԻ', 'hy-numerals')).toBe(120)
    expect(value('ՍԴ', 'hy-numerals')).toBe(2004)
  })

  test('the later letters Օ and Ֆ, and the ligature և = ե + ւ', () => {
    expect(value('Օ', 'hy-numerals')).toBe(10000)
    expect(value('Ֆ', 'hy-numerals')).toBe(20000)
    expect(value('և', 'hy-numerals')).toBe(5 + 7000)
  })
})

describe('Georgian numerals (ka-numerals)', () => {
  test('printed dates: ჩყმვ = 1846, ჩღჲთ = 1769, ჩყპზ = 1887, ციბ = 2012', () => {
    expect(value('ჩყმვ', 'ka-numerals')).toBe(1846)
    expect(value('ჩღჲთ', 'ka-numerals')).toBe(1769)
    expect(value('ჩყპზ', 'ka-numerals')).toBe(1887)
    expect(value('ციბ', 'ka-numerals')).toBe(2012)
  })

  test('უ and ჳ are both 400; ჵ is 10000; non-numeral letters score 0', () => {
    expect(value('უ', 'ka-numerals')).toBe(400)
    expect(value('ჳ', 'ka-numerals')).toBe(400)
    expect(value('ჵ', 'ka-numerals')).toBe(10000)
    expect(value('ჶ', 'ka-numerals')).toBe(0)
    expect(value('უ', 'ka-numerals', true)).toBe(value('ჳ', 'ka-numerals', true))
  })

  test('Mtavruli, Asomtavruli and Nuskhuri fold to Mkhedruli', () => {
    // Mtavruli capitals sit at a fixed offset (U+1C90 − U+10D0) above Mkhedruli
    const mtavruli = [...'ჩყმვ'].map((ch) => String.fromCodePoint((ch.codePointAt(0) ?? 0) + 0xbc0))
    expect(mtavruli.join('')).toBe('ჩყმვ'.toUpperCase())
    expect(value(mtavruli.join(''), 'ka-numerals')).toBe(1846)
    expect(value('\u10A0\u10A1', 'ka-numerals')).toBe(3) // Asomtavruli an, ban
    expect(value('\u2D00\u2D01', 'ka-numerals')).toBe(3) // Nuskhuri an, ban
    expect(value('\u10B3', 'ka-numerals')).toBe(400) // Asomtavruli un = 400
    expect(value('\u10C5', 'ka-numerals')).toBe(10000) // Asomtavruli hoe
  })
})

describe('Coptic numerals (cop-numerals)', () => {
  test('the Greek values: ⲒⲎⲤⲞⲨⲤ = 888 like Ιησους', () => {
    expect(value('ⲒⲎⲤⲞⲨⲤ', 'cop-numerals')).toBe(888)
    expect(value('Ιησους', 'gr-isopsephy')).toBe(888)
    expect(value('ⲋ', 'cop-numerals')).toBe(6)
    expect(value('Ϥ', 'cop-numerals')).toBe(90)
    expect(value('Ⳁ', 'cop-numerals')).toBe(900)
  })

  test('Demotic-derived letters other than fai score 0; overlines are stripped', () => {
    expect(value('ϣϧϩϫϭϯ', 'cop-numerals')).toBe(0)
    expect(value('ⲓ\u0305ⲃ\u0305', 'cop-numerals')).toBe(12) // combining overline
  })
})

describe('Syriac numerals (syr-numerals)', () => {
  test('the Hebrew values on the 22 letters: ܫܠܡܐ = 371 = שלמא', () => {
    expect(value('ܫܠܡܐ', 'syr-numerals')).toBe(371)
    expect(value('שלמא', 'he-hechrachi')).toBe(371)
    const syriac = NUMERAL_CIPHERS.find((c) => c.id === 'syr-numerals')
    const hebrew = [...'אבגדהוזחטיכלמנסעפצקרשת']
    syriac?.alphabet.forEach((ch, i) => {
      expect(value(ch, 'syr-numerals')).toBe(value(hebrew[i] as string, 'he-hechrachi'))
    })
  })

  test('final semkath counts as semkath; vowel points are stripped', () => {
    expect(value('ܤ', 'syr-numerals')).toBe(60)
    expect(value('ܫܠܵܡܵܐ', 'syr-numerals')).toBe(371)
    expect(value('ܖ', 'syr-numerals')).toBe(0) // ambiguous dotless dalath/rish
  })
})

describe('Gothic numerals (got-numerals)', () => {
  test('•𐌹𐌱• = 12 and the pure numeral signs 𐍁 = 90, 𐍊 = 900', () => {
    expect(value('•𐌹𐌱•', 'got-numerals')).toBe(12)
    expect(value('𐍁', 'got-numerals')).toBe(90)
    expect(value('𐍊', 'got-numerals')).toBe(900)
    expect(value('𐌰', 'got-numerals', true)).toBe(900)
  })
})
