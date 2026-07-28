import { describe, expect, test } from 'bun:test'
import { GematriaError } from '../src/errors.js'
import type { CipherId } from '../src/types.js'
import { analyze, letterValues, profile, reduce, value } from '../src/value.js'
import vectors from './fixtures/reference-vectors.json' with { type: 'json' }

describe('reference vectors (checked-in fixture)', () => {
  for (const v of vectors.vectors) {
    test(`${v.cipher}("${v.text}") = ${v.value} — ${v.gloss}`, () => {
      expect(value(v.text, v.cipher as CipherId)).toBe(v.value)
    })
  }

  test('echad and ahavah are the classic 13 = 13 equality', () => {
    expect(value('אחד', 'he-hechrachi')).toBe(value('אהבה', 'he-hechrachi'))
  })

  test('Thelema and Agape are the classic 93 = 93 equality', () => {
    expect(value('θελημα', 'gr-isopsephy')).toBe(value('αγαπη', 'gr-isopsephy'))
  })
})

describe('value', () => {
  test('sums only in-script letters; punctuation and spaces score 0', () => {
    expect(value('a b c', 'en-ordinal')).toBe(1 + 2 + 3)
    expect(value('a-b-c!', 'en-ordinal')).toBe(6)
  })

  test('a cross-script query scores 0 under a foreign cipher', () => {
    expect(value('gematria', 'he-hechrachi')).toBe(0)
    expect(value('אחד', 'en-ordinal')).toBe(0)
  })

  test('the modern english and sumerian ×6 ciphers agree and are 6× ordinal', () => {
    const word = 'chaos'
    expect(value(word, 'en-english')).toBe(value(word, 'en-ordinal') * 6)
    expect(value(word, 'en-sumerian')).toBe(value(word, 'en-english'))
  })

  test('the ×6 ciphers reversed are 6× the reversed ordinal', () => {
    const word = 'chaos'
    expect(value(word, 'en-english', true)).toBe(value(word, 'en-ordinal', true) * 6)
    expect(value(word, 'en-sumerian', true)).toBe(value(word, 'en-english', true))
  })

  test('rejects a non-string and an unknown cipher', () => {
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => value(42 as any, 'en-ordinal')).toThrow(GematriaError)
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => value('x', 'nope' as any)).toThrow(GematriaError)
  })
})

describe('reduce (digital root)', () => {
  test.each([
    [0, 0],
    [9, 9],
    [10, 1],
    [18, 9],
    [74, 2],
    [666, 9],
    [12345, 6],
  ])('reduce(%i) = %i', (n, expected) => {
    expect(reduce(n)).toBe(expected)
  })

  test('rejects negatives and non-integers', () => {
    expect(() => reduce(-1)).toThrow(GematriaError)
    expect(() => reduce(1.5)).toThrow(GematriaError)
  })
})

describe('analyze', () => {
  test('breaks a Hebrew word into per-letter contributions', () => {
    const r = analyze('אחד', 'he-hechrachi')
    expect(r.value).toBe(13)
    expect(r.reduced).toBe(4)
    expect(r.script).toBe('hebrew')
    expect(r.byLetter).toEqual([
      { char: 'א', value: 1 },
      { char: 'ח', value: 8 },
      { char: 'ד', value: 4 },
    ])
  })

  test('byLetter omits non-letters and sums to value', () => {
    const r = analyze('a b!c', 'en-ordinal')
    expect(r.byLetter.map((b) => b.char)).toEqual(['a', 'b', 'c'])
    expect(r.byLetter.reduce((s, b) => s + b.value, 0)).toBe(r.value)
  })
})

describe('profile — frontend superset', () => {
  const FRONTEND_HEBREW = [
    'he-hechrachi',
    'he-gadol',
    'he-siduri',
    'he-katan',
    'he-atbash',
    'he-albam',
  ]
  const FRONTEND_GREEK = ['gr-isopsephy']
  const FRONTEND_LATIN = ['en-ordinal', 'en-reduction']

  test('hebrew profile emits exactly the six frontend ciphers in order', () => {
    const p = profile('שלום')
    expect(p.script).toBe('hebrew')
    expect(p.values.map((v) => v.cipher)).toEqual(FRONTEND_HEBREW as CipherId[])
  })

  test('greek profile emits the isopsephy row', () => {
    const p = profile('αγαπη')
    expect(p.script).toBe('greek')
    expect(p.values.map((v) => v.cipher)).toEqual(FRONTEND_GREEK as CipherId[])
  })

  test('latin profile leads with the two frontend ciphers, then adds SDK ones', () => {
    const p = profile('gematria')
    expect(p.script).toBe('latin')
    const ids = p.values.map((v) => v.cipher)
    expect(ids.slice(0, 2)).toEqual(FRONTEND_LATIN as CipherId[])
    for (const id of FRONTEND_LATIN) expect(ids).toContain(id as CipherId)
    expect(ids).toContain('la-agrippa')
    expect(ids).toContain('en-english')
  })

  test('each row carries label, value and reduced (the frontend row shape)', () => {
    const p = profile('gematria')
    const ordinal = p.values.find((v) => v.cipher === 'en-ordinal')
    expect(ordinal).toEqual({
      cipher: 'en-ordinal',
      label: 'Ordinal',
      value: 74,
      reduced: reduce(74),
    })
  })

  test('includeModern:false drops the ×6 wordplay ciphers', () => {
    const historical = profile('gematria', { includeModern: false })
    expect(historical.values.some((v) => v.cipher === 'en-english')).toBe(false)
    expect(historical.values.map((v) => v.cipher)).toEqual([
      'en-ordinal',
      'en-reduction',
      'la-agrippa',
      'la-jewish',
    ] as CipherId[])
  })

  test('a forced script overrides detection', () => {
    const p = profile('gematria', { script: 'latin' })
    expect(p.script).toBe('latin')
  })

  test('byLetter gives per-cipher values for each contributing letter', () => {
    const p = profile('חי')
    expect(p.byLetter.map((b) => b.char)).toEqual(['ח', 'י'])
    expect(p.byLetter[0]?.values['he-hechrachi']).toBe(8)
    expect(p.byLetter[1]?.values['he-hechrachi']).toBe(10)
  })
})

describe('letterValues', () => {
  test('returns the frozen cipher table', () => {
    const table = letterValues('en-ordinal')
    expect(table.length).toBe(26)
    expect(table[0]).toEqual({ char: 'a', value: 1 })
    expect(table[25]).toEqual({ char: 'z', value: 26 })
  })
})

describe('cipher refs / aliases', () => {
  test('an alias and its canonical id agree on value', () => {
    expect(value('god', 'jewish')).toBe(value('god', 'la-jewish'))
    expect(value('god', 'simple')).toBe(value('god', 'en-ordinal'))
    expect(value('אחד', 'hebrew')).toBe(value('אחד', 'he-hechrachi'))
  })

  test('analyze resolves an alias to its canonical cipher id in the result', () => {
    const r = analyze('god', 'jewish')
    expect(r.cipher).toBe('la-jewish')
  })

  test('letterValues accepts an alias too', () => {
    expect(letterValues('simple')).toEqual(letterValues('en-ordinal'))
  })

  test('an unknown alias still throws unknown_cipher', () => {
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => value('x', 'not-a-real-alias' as any)).toThrow(GematriaError)
  })
})
