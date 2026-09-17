import { describe, expect, test } from 'bun:test'
import {
  aiqBeker,
  aiqBekerEquivalent,
  aiqBekerSubstitute,
  chamberMates,
  chamberReduce,
  NINE_CHAMBERS,
} from '../src/chambers.js'
import { GematriaError } from '../src/errors.js'
import { value } from '../src/value.js'

describe('NINE_CHAMBERS', () => {
  test('is nine deeply frozen triads over the 22 + 5 final letters', () => {
    expect(NINE_CHAMBERS.length).toBe(9)
    expect(Object.isFrozen(NINE_CHAMBERS)).toBe(true)
    const all = NINE_CHAMBERS.flat()
    expect(all.length).toBe(27)
    expect(new Set(all).size).toBe(27)
    for (const row of NINE_CHAMBERS) {
      expect(Object.isFrozen(row)).toBe(true)
      expect(row.length).toBe(3)
    }
  })

  test('the first chambers are the classic aleph/yod/qoph, bet/kaph/resh triads', () => {
    expect(NINE_CHAMBERS[0]).toEqual(['א', 'י', 'ק'])
    expect(NINE_CHAMBERS[1]).toEqual(['ב', 'כ', 'ר'])
    expect(NINE_CHAMBERS[3]).toEqual(['ד', 'מ', 'ת'])
  })

  test('chamber c holds the letters worth c, 10c and 100c under Gadol (finals for 500–900)', () => {
    NINE_CHAMBERS.forEach((row, i) => {
      const c = i + 1
      expect(row.map((ch) => value(ch, 'he-gadol'))).toEqual([c, 10 * c, 100 * c])
    })
  })
})

describe('chamberMates', () => {
  test('returns the other two members of the chamber, in chamber order', () => {
    expect(chamberMates('א')).toEqual(['י', 'ק'])
    expect(chamberMates('ד')).toEqual(['מ', 'ת'])
    expect(chamberMates('מ')).toEqual(['ד', 'ת'])
    expect(chamberMates('ץ')).toEqual(['ט', 'צ'])
  })

  test("finals are distinct hundreds by default and fold to their base with finals: 'fold'", () => {
    expect(chamberMates('ם')).toEqual(['ו', 'ס'])
    expect(chamberMates('ם', { finals: 'fold' })).toEqual(['ד', 'ת'])
    expect(chamberMates('מָ')).toEqual(['ד', 'ת'])
  })

  test('rejects non-Hebrew input and bad options', () => {
    expect(() => chamberMates('x')).toThrow(GematriaError)
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => chamberMates(1 as any)).toThrow(GematriaError)
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => chamberMates('א', { finals: 'keep' as any })).toThrow(GematriaError)
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => chamberMates('א', 'fold' as any)).toThrow(GematriaError)
  })
})

describe('Aiq Beker exchange', () => {
  test('Sepher Sephiroth: אמת (441) is the "Temurah of ADM (אדם, 45), by Aiq Bekar"', () => {
    expect(value('אדם', 'he-hechrachi')).toBe(45)
    expect(value('אמת', 'he-hechrachi')).toBe(441)
    expect(aiqBekerEquivalent('אדם', 'אמת', { finals: 'fold' })).toBe(true)
    // with the finals as hundreds, ם (600) sits in chamber 6, not with ת
    expect(aiqBekerEquivalent('אדם', 'אמת')).toBe(false)
    expect(chamberMates('ד')).toContain('מ')
    expect(chamberMates('ם', { finals: 'fold' })).toContain('ת')
  })

  test('The Equinox: "AMN by Aiq Bekar 1+4+5 = 10" — the chamber digits of אמן', () => {
    const digits = [...'אמן'].map((ch) => aiqBeker(ch.replace('ן', 'נ')).chamber)
    expect(digits).toEqual([1, 4, 5])
    expect(digits.reduce((a, b) => a + b, 0)).toBe(10)
    expect(value('אמן', 'he-katan')).toBe(10)
  })

  test('equivalence needs equal length and ignores non-Hebrew characters', () => {
    expect(aiqBekerEquivalent('אב', 'יכ')).toBe(true)
    expect(aiqBekerEquivalent('א-ב!', 'ק ר')).toBe(true)
    expect(aiqBekerEquivalent('אב', 'אבג')).toBe(false)
    expect(aiqBekerEquivalent('אב', 'בא')).toBe(false)
  })

  test('aiqBekerSubstitute moves every letter to one chamber position', () => {
    expect(aiqBekerSubstitute('אמת', 1)).toBe('אדד')
    expect(aiqBekerSubstitute('אמת', 2)).toBe('יממ')
    expect(aiqBekerSubstitute('אמת', 3)).toBe('קתת')
    expect(aiqBekerSubstitute('שלום', 3)).toBe('ששםם')
    expect(aiqBekerSubstitute('ם', 1, { finals: 'fold' })).toBe('ד')
    expect(aiqBekerSubstitute('a ב', 2)).toBe('a כ')
  })

  test('a substitution keeps every letter in its chamber (per-letter Gadol digital roots unchanged)', () => {
    const word = 'אבגדהוזחטיכלמנסעפצקרשתךםןףץ'
    for (const position of [1, 2, 3] as const) {
      const out = aiqBekerSubstitute(word, position)
      expect(aiqBekerEquivalent(word, out)).toBe(true)
      expect([...out].map((ch) => chamberReduce(value(ch, 'he-gadol')))).toEqual(
        [...word].map((ch) => chamberReduce(value(ch, 'he-gadol'))),
      )
    }
  })

  test('rejects a bad position or text', () => {
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => aiqBekerSubstitute('א', 4 as any)).toThrow(GematriaError)
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => aiqBekerSubstitute(null as any, 1)).toThrow(GematriaError)
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => aiqBekerEquivalent('א', 3 as any)).toThrow(GematriaError)
  })
})

describe('aiqBeker', () => {
  test('returns the 1..9 chamber and 1..3 position of a letter', () => {
    expect(aiqBeker('א')).toEqual({ chamber: 1, position: 1 })
    expect(aiqBeker('י')).toEqual({ chamber: 1, position: 2 })
    expect(aiqBeker('ק')).toEqual({ chamber: 1, position: 3 })
    expect(aiqBeker('ב')).toEqual({ chamber: 2, position: 1 })
  })

  test('final forms are distinct members (they occupy the hundreds slot)', () => {
    expect(aiqBeker('כ')).toEqual({ chamber: 2, position: 2 })
    expect(aiqBeker('ך')).toEqual({ chamber: 5, position: 3 })
    expect(aiqBeker('ץ')).toEqual({ chamber: 9, position: 3 })
  })

  test('strips niqqud and rejects non-Hebrew input', () => {
    expect(aiqBeker('אָ')).toEqual({ chamber: 1, position: 1 })
    expect(() => aiqBeker('a')).toThrow(GematriaError)
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => aiqBeker(5 as any)).toThrow(GematriaError)
  })
})

describe('chamberReduce', () => {
  test('is the theosophical reduction (digital root) to a single digit', () => {
    expect(chamberReduce(100)).toBe(1)
    expect(chamberReduce(666)).toBe(9)
    expect(chamberReduce(0)).toBe(0)
  })

  test('every letter of a chamber reduces to the same digit', () => {
    for (const row of NINE_CHAMBERS) {
      const reduced = row.map((ch) => chamberReduce(value(ch, 'he-gadol')))
      expect(new Set(reduced).size).toBe(1)
    }
  })

  test('rejects negatives and non-integers', () => {
    expect(() => chamberReduce(-1)).toThrow(GematriaError)
    expect(() => chamberReduce(1.5)).toThrow(GematriaError)
  })
})
