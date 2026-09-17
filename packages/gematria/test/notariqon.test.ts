import { describe, expect, test } from 'bun:test'
import { GematriaError } from '../src/errors.js'
import { acronym, notariqon } from '../src/notariqon.js'
import { value } from '../src/value.js'

describe('notariqon', () => {
  test('takes the first letter of each word by default', () => {
    expect(notariqon('Atah Gibor Le-olam Adonai')).toBe('AGLA')
  })

  test('takes the last letter of each word when asked', () => {
    expect(notariqon('alpha beta gamma', { mode: 'last' })).toBe('aaa')
  })

  test('collapses arbitrary whitespace and ignores empty tokens', () => {
    expect(notariqon('  one   two\tthree ')).toBe('ott')
  })

  test('works on Hebrew and composes with value()', () => {
    // first letters aleph, gimel, lamed, aleph → AGLA acronym אגלא
    const acronym = notariqon('אתה גבור לעולם אדני')
    expect(acronym).toBe('אגלא')
    expect(value(acronym, 'he-hechrachi')).toBe(1 + 3 + 30 + 1)
  })

  test('rejects a non-string', () => {
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => notariqon(5 as any)).toThrow(GematriaError)
  })
})

describe('acronym (contraction)', () => {
  test('roshei teivot — initials (the default)', () => {
    expect(acronym('Atah Gibor Le-olam Adonai')).toBe('AGLA')
    expect(acronym('Atah Gibor Le-olam Adonai', { from: 'first' })).toBe('AGLA')
  })

  test('sofei teivot — finals', () => {
    expect(acronym('abc def ghi', { from: 'last' })).toBe('cfi')
  })

  test('emtsaei teivot — medials (the ⌊n/2⌋ letter)', () => {
    expect(acronym('abc def ghi', { from: 'medial' })).toBe('beh')
    expect(acronym('abcd', { from: 'medial' })).toBe('c') // index 2 of 0..3
  })

  test('composes with value() on Hebrew initials', () => {
    const a = acronym('אתה גבור לעולם אדני')
    expect(a).toBe('אגלא')
    expect(value(a, 'he-hechrachi')).toBe(1 + 3 + 30 + 1)
  })

  test('rejects a non-string', () => {
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => acronym(5 as any)).toThrow(GematriaError)
  })
})

describe('letters only, normalized per script', () => {
  test('pointed Hebrew: sofei teivot pick the final letter, not a vowel point', () => {
    expect(notariqon('לְךָ', { mode: 'last' })).toBe('ך')
    expect(value(notariqon('לְךָ', { mode: 'last' }), 'he-hechrachi')).toBe(20)
    expect(notariqon('אַתָּה גִּבּוֹר לְעוֹלָם אֲדֹנָי')).toBe('אגלא')
    expect(acronym('אַתָּה גִּבּוֹר לְעוֹלָם אֲדֹנָי', { from: 'last' })).toBe('הרםי')
  })

  test('attached punctuation, dashes and numbers are never letters', () => {
    expect(notariqon('Atah, Gibor', { mode: 'last' })).toBe('hr')
    expect(notariqon('(Atah) — Gibor 42')).toBe('AG')
    expect(acronym('ab-cd', { from: 'medial' })).toBe('c')
  })

  test('Latin keeps case and accents (NFC); format controls are ignored', () => {
    expect(notariqon('Émile Zola')).toBe('ÉZ')
    expect(notariqon('Émile')).toBe('É')
    expect(notariqon('‏Atah‍ Gibor')).toBe('AG')
  })

  test('Greek and Arabic words contribute their letters', () => {
    expect(notariqon('ἀγάπη θέλημα')).toBe('ἀθ')
    expect(acronym('مُحَمَّد عَلِيّ', { from: 'first' })).toBe('مع')
  })

  test('rejects unknown modes and non-object options', () => {
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => notariqon('x', { mode: 'medial' as any })).toThrow(GematriaError)
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => acronym('x', { from: 'bogus' as any })).toThrow(GematriaError)
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => acronym('x', 'last' as any)).toThrow(GematriaError)
  })
})
