import { describe, expect, test } from 'bun:test'
import { GematriaError } from '../src/errors.js'
import {
  admissibleWords,
  clearDefaultLexicon,
  createLexiconRegistry,
  getDefaultLexicon,
  useDefaultLexicon,
} from '../src/lexicon-registry.js'
import { matches } from '../src/match.js'
import type { Lexicon } from '../src/types.js'

describe('createLexiconRegistry', () => {
  test('starts empty, registers, lists and clears', () => {
    const registry = createLexiconRegistry()
    expect(registry.has()).toBe(false)
    expect(() => registry.words()).toThrow(expect.objectContaining({ code: 'invalid_input' }))
    registry.use(['god', { word: 'θεος', script: 'greek' }])
    expect(registry.has()).toBe(true)
    expect(registry.words()).toEqual(['god', 'θεος'])
    expect(registry.words('jewish')).toEqual(['god'])
    expect(registry.words('gr-isopsephy')).toEqual(['θεος'])
    registry.clear()
    expect(registry.has()).toBe(false)
    expect(() => registry.lexicon()).toThrow(GematriaError)
  })

  test('registries are isolated from each other and from the default', () => {
    const a = createLexiconRegistry()
    const b = createLexiconRegistry()
    a.use(['alpha'])
    b.use(['beta'])
    useDefaultLexicon(['gamma'])
    expect(a.words()).toEqual(['alpha'])
    expect(b.words()).toEqual(['beta'])
    expect(getDefaultLexicon()).toEqual(['gamma'])
  })

  test('stores its own copy: later mutation of the caller array has no effect', () => {
    const registry = createLexiconRegistry()
    const words = ['a', 'b']
    const entry = { word: 'c', script: 'latin' as const }
    registry.use([...words, entry])
    words.push('z')
    entry.word = 'zz'
    expect(registry.words()).toEqual(['a', 'b', 'c'])
  })

  test('rejects invalid lexicons', () => {
    const registry = createLexiconRegistry()
    for (const bad of [
      'words',
      undefined,
      [3],
      [{ word: 1 }],
      [{ word: 'a', script: 'x' }],
    ] as unknown[]) {
      expect(() => registry.use(bad as Lexicon)).toThrow(
        expect.objectContaining({ code: 'invalid_input' }),
      )
    }
  })
})

describe('default lexicon', () => {
  test('clearDefaultLexicon makes the bare overloads throw again', () => {
    useDefaultLexicon(['god'])
    expect(getDefaultLexicon()).toEqual(['god'])
    clearDefaultLexicon()
    expect(() => getDefaultLexicon()).toThrow(
      expect.objectContaining({
        code: 'invalid_input',
        message: expect.stringContaining('no lexicon supplied'),
      }),
    )
    expect(() => matches('god', 'jewish')).toThrow(GematriaError)
  })

  test('getDefaultLexicon(cipher) filters to admissible words', () => {
    useDefaultLexicon(['אחד', 'Αμην', 'amen', '...'])
    expect(getDefaultLexicon('he-hechrachi')).toEqual(['אחד'])
    expect(getDefaultLexicon('en-ordinal')).toEqual(['amen'])
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => getDefaultLexicon('nope' as any)).toThrow(
      expect.objectContaining({ code: 'unknown_cipher' }),
    )
  })
})

describe('admissibleWords', () => {
  test('requires the cipher script and a scoring letter', () => {
    const lexicon = ['abc', '123', '', 'אב', { word: 'abc', script: 'greek' as const }]
    expect(admissibleWords(lexicon, 'en-ordinal')).toEqual(['abc'])
    expect(admissibleWords(lexicon, 'gr-isopsephy')).toEqual([])
    // digits score under the Alphanumeric Qabbala, which counts them as letters
    expect(admissibleWords(lexicon, 'en-aq')).toEqual(['abc', '123'])
  })

  test('memoized results for a frozen lexicon stay equal across calls', () => {
    const frozen = Object.freeze(['abc', 'cab', Object.freeze({ word: 'd' })])
    const first = admissibleWords(frozen, 'en-ordinal')
    expect(admissibleWords(frozen, 'en-ordinal')).toEqual(first)
    expect(admissibleWords(frozen, 'la-jewish')).toEqual(['abc', 'cab', 'd'])
  })
})
