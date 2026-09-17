import { describe, expect, test } from 'bun:test'
import { CIPHERS } from '../../src/registry.js'
import { analyze, letterValues, value } from '../../src/value.js'

/**
 * Structural invariants every cipher must satisfy, checked generically over the
 * whole registry so a new or edited table cannot silently break reverse,
 * folding or the breakdown.
 */
describe.each(CIPHERS.map((c) => [c.id, c] as const))('cipher invariants: %s', (_id, cipher) => {
  const n = cipher.alphabet.length
  const index = new Map(cipher.alphabet.map((letter, i) => [letter, i]))
  /** Independent statement of the reverse rule, straight from the definition. */
  const mirrored = (ch: string): number => {
    const i = index.get(cipher.fold(ch))
    return i === undefined ? 0 : cipher.letterValue(cipher.alphabet[n - 1 - i] as string)
  }

  test('metadata is complete and the cipher is deeply frozen', () => {
    expect(cipher.label.length).toBeGreaterThan(0)
    expect(cipher.description.length).toBeGreaterThan(0)
    expect(typeof cipher.modern).toBe('boolean')
    expect(typeof cipher.extended).toBe('boolean')
    expect(Object.isFrozen(cipher)).toBe(true)
    expect(Object.isFrozen(cipher.alphabet)).toBe(true)
    expect(Object.isFrozen(cipher.table)).toBe(true)
    for (const row of cipher.table) expect(Object.isFrozen(row)).toBe(true)
  })

  test('every table value is a positive safe integer and table glyphs are unique', () => {
    expect(cipher.table.length).toBeGreaterThan(0)
    for (const row of cipher.table) {
      expect(Number.isSafeInteger(row.value)).toBe(true)
      expect(row.value).toBeGreaterThan(0)
    }
    const chars = cipher.table.map((row) => row.char)
    expect(new Set(chars).size).toBe(chars.length)
  })

  test('letterValue and value() agree with every table row', () => {
    for (const row of cipher.table) {
      expect(cipher.letterValue(row.char)).toBe(row.value)
      const expected = cipher.postSum ? cipher.postSum(row.value) : row.value
      expect(value(row.char, cipher.id)).toBe(expected)
    }
  })

  test('the alphabet is unique, canonical under fold, and covers every table glyph', () => {
    expect(new Set(cipher.alphabet).size).toBe(n)
    for (const letter of cipher.alphabet) expect(cipher.fold(letter)).toBe(letter)
    for (const row of cipher.table) {
      const letter = cipher.fold(row.char)
      expect(index.has(letter)).toBe(true)
      expect(cipher.fold(letter)).toBe(letter) // idempotent
    }
  })

  test('reverse is the alphabet mirror, and mirroring is an involution', () => {
    const reversed = letterValues(cipher.id, true)
    expect(reversed.map((row) => row.char)).toEqual(cipher.table.map((row) => row.char))
    for (const row of reversed) {
      expect(row.value).toBe(mirrored(row.char))
      const expected = cipher.postSum ? cipher.postSum(row.value) : row.value
      expect(value(row.char, cipher.id, true)).toBe(expected)
    }
    for (let i = 0; i < n; i++) {
      const letter = cipher.alphabet[i] as string
      const mirror = cipher.alphabet[n - 1 - i] as string
      // reverse(letter) = forward(mirror) and reverse(mirror) = forward(letter)
      expect(mirrored(letter)).toBe(cipher.letterValue(mirror))
      expect(mirrored(mirror)).toBe(cipher.letterValue(letter))
    }
  })

  test('glyph variants of one letter share their reversed value', () => {
    for (const a of cipher.table) {
      for (const b of cipher.table) {
        if (cipher.fold(a.char) === cipher.fold(b.char)) {
          expect(value(a.char, cipher.id, true)).toBe(value(b.char, cipher.id, true))
        }
      }
    }
    const letterValuesOfAlphabet = cipher.alphabet.map((letter) => cipher.letterValue(letter))
    if (new Set(letterValuesOfAlphabet).size === n) {
      // injective alphabet: equal forward value ⇒ the same letter ⇒ equal reverse
      for (const a of cipher.table) {
        for (const b of cipher.table) {
          if (a.value === b.value) {
            expect(value(a.char, cipher.id, true)).toBe(value(b.char, cipher.id, true))
          }
        }
      }
    }
  })

  test('analyze().byLetter sums to the value, forward and reversed', () => {
    const text = [...cipher.table.map((row) => row.char), ' ', '!', ...cipher.alphabet].join('')
    for (const reverse of [false, true]) {
      const result = analyze(text, cipher.id, { reverse })
      const sum = result.byLetter.reduce((s, b) => s + b.value, 0)
      expect(cipher.postSum ? cipher.postSum(sum) : sum).toBe(result.value)
      expect(result.value).toBe(value(text, cipher.id, reverse))
    }
  })
})
