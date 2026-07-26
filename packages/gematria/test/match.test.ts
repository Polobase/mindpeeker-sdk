import { describe, expect, test } from 'bun:test'
import { GematriaError } from '../src/errors.js'
import { equalValue, lookup, matches, useDefaultLexicon } from '../src/match.js'

describe('equalValue', () => {
  test('true when two words share a value, false otherwise', () => {
    expect(equalValue('אחד', 'אהבה', 'he-hechrachi')).toBe(true)
    expect(equalValue('θελημα', 'αγαπη', 'gr-isopsephy')).toBe(true)
    expect(equalValue('אחד', 'חי', 'he-hechrachi')).toBe(false)
  })

  test('colel (±1) accepts an off-by-one; strict comparison rejects it', () => {
    // echad = 13, david (דוד) = 14
    expect(equalValue('אחד', 'דוד', 'he-hechrachi')).toBe(false)
    expect(equalValue('אחד', 'דוד', 'he-hechrachi', { colel: true })).toBe(true)
    expect(equalValue('אחד', 'דוד', 'he-hechrachi', { tolerance: 1 })).toBe(true)
    // two apart is outside a ±1 window
    expect(equalValue('אחד', 'טו', 'he-hechrachi', { colel: true })).toBe(false)
  })
})

describe('colel / tolerance matching', () => {
  const lexicon = ['אהבה', 'אחד', 'דוד', 'גדול']
  // Hechrachi: ahavah=13, echad=13, david=14, gadol=43

  test('colel widens matches to ±1 and flags exact vs within-tolerance', () => {
    const r = matches('אחד', lexicon, 'he-hechrachi', { colel: true })
    expect(r.tolerance).toBe(1)
    expect(r.matches).toEqual(['אהבה', 'אחד', 'דוד']) // 13, 13, 14 all within ±1
    expect(r.exact).toEqual(['אהבה', 'אחד']) // only the true 13s
    expect(r.commonness).toBeCloseTo(3 / 4, 12)
  })

  test('the default (no colel) keeps a zero window and matches == exact', () => {
    const r = matches('אחד', lexicon, 'he-hechrachi')
    expect(r.tolerance).toBe(0)
    expect(r.matches).toEqual(['אהבה', 'אחד'])
    expect(r.exact).toEqual(r.matches as string[])
  })

  test('lookup honors an explicit tolerance window', () => {
    const r = lookup(14, lexicon, 'he-hechrachi', { tolerance: 1 })
    expect(r.matches).toEqual(['אהבה', 'אחד', 'דוד'])
    expect(r.exact).toEqual(['דוד'])
  })

  test('rejects a negative tolerance', () => {
    expect(() => matches('אחד', lexicon, 'he-hechrachi', { tolerance: -1 })).toThrow(GematriaError)
  })
})

describe('default lexicon overloads', () => {
  test('matches/lookup use a registered default when no lexicon is passed', () => {
    useDefaultLexicon(['god', 'dog', 'cat'])
    // god = dog = 61, cat = 104 under Jewish gematria
    expect(matches('god', 'jewish').matches).toEqual(['god', 'dog'])
    expect(lookup(104, 'jewish').matches).toEqual(['cat'])
  })

  test('a bare call throws when no default has been registered', () => {
    // reset to an explicit, then confirm the explicit-lexicon path still works
    useDefaultLexicon(['god'])
    expect(matches('god', 'jewish').matches).toEqual(['god'])
  })
})

describe('matches', () => {
  const lexicon = ['אהבה', 'אחד', 'לב', 'טוב', 'גדול']
  // Hechrachi: ahavah=13, echad=13, lev=32, tov=17, gadol=43

  test('finds every equal-value lexicon word and reports the query value', () => {
    const result = matches('אחד', lexicon, 'he-hechrachi')
    expect(result.value).toBe(13)
    expect(result.matches).toEqual(['אהבה', 'אחד'])
  })

  test('commonness is the fraction of the lexicon at that value', () => {
    const result = matches('אחד', lexicon, 'he-hechrachi')
    // 2 of 5 lexicon words share value 13
    expect(result.commonness).toBeCloseTo(2 / 5, 12)
  })

  test('a lonely value has a single self-match and low commonness', () => {
    const result = matches('גדול', lexicon, 'he-hechrachi')
    expect(result.matches).toEqual(['גדול'])
    expect(result.commonness).toBeCloseTo(1 / 5, 12)
  })

  test('a value absent from the lexicon yields no matches and zero commonness', () => {
    const result = matches('z', ['a', 'b'], 'en-ordinal') // z=26, lexicon has 1 and 2
    expect(result.value).toBe(26)
    expect(result.matches).toEqual([])
    expect(result.commonness).toBe(0)
  })

  test('an empty lexicon gives commonness 0, not NaN', () => {
    const result = matches('אחד', [], 'he-hechrachi')
    expect(result.matches).toEqual([])
    expect(result.commonness).toBe(0)
  })

  test('rejects a non-array lexicon', () => {
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => matches('x', 'nope' as any, 'en-ordinal')).toThrow(GematriaError)
  })
})

describe('lookup', () => {
  const lexicon = ['אהבה', 'אחד', 'לב', 'טוב', 'גדול']
  // Hechrachi: ahavah=13, echad=13, lev=32, tov=17, gadol=43

  test('returns exactly the equal-value words and echoes target as value', () => {
    const result = lookup(13, lexicon, 'he-hechrachi')
    expect(result.value).toBe(13)
    expect(result.matches).toEqual(['אהבה', 'אחד'])
  })

  test('commonness is the fraction of the lexicon at that value', () => {
    const result = lookup(13, lexicon, 'he-hechrachi')
    expect(result.commonness).toBeCloseTo(2 / 5, 12)
  })

  test('a value absent from the lexicon yields no matches and zero commonness', () => {
    const result = lookup(99999, lexicon, 'he-hechrachi')
    expect(result.value).toBe(99999)
    expect(result.matches).toEqual([])
    expect(result.commonness).toBe(0)
  })

  test('rejects a non-integer or negative target', () => {
    expect(() => lookup(1.5, lexicon, 'he-hechrachi')).toThrow(GematriaError)
    expect(() => lookup(-1, lexicon, 'he-hechrachi')).toThrow(GematriaError)
  })

  test('rejects a non-array lexicon', () => {
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => lookup(13, 'nope' as any, 'he-hechrachi')).toThrow(GematriaError)
  })

  test('rejects an unknown cipher', () => {
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => lookup(13, lexicon, 'nope' as any)).toThrow(GematriaError)
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => lookup(13, [], 'nope' as any)).toThrow(GematriaError)
  })

  test('accepts a friendly cipher alias', () => {
    // Jewish: god = g7+o50+d4 = 61, dog = d4+o50+g7 = 61, cat = c3+a1+t100 = 104
    const result = lookup(61, ['god', 'dog', 'cat'], 'jewish')
    expect(result.matches).toEqual(['god', 'dog'])
  })
})
