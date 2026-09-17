import { describe, expect, test } from 'bun:test'
import { collisionProfile, expectedMatches } from '../src/commonness.js'
import {
  defaultLexicon,
  FAMOUS_NUMBERS,
  type LexiconEntry,
  SCRIPT_CIPHER,
  SEPHER_SEPHIROTH,
} from '../src/lexicon.js'
import { clearDefaultLexicon, getDefaultLexicon } from '../src/lexicon-registry.js'
import { lookup, matches } from '../src/match.js'
import { detectScript } from '../src/normalize.js'
import { value } from '../src/value.js'

const SOURCES = new Set(['sepher-sephiroth', 'mathers', 'stirling', 'agrippa', 'curated'])

describe('SEPHER_SEPHIROTH', () => {
  test('every stored value recomputes exactly under its script cipher', () => {
    const wrong = SEPHER_SEPHIROTH.filter((e) => value(e.word, SCRIPT_CIPHER[e.script]) !== e.value)
    expect(wrong).toEqual([])
  })

  test('every word is detected as its declared script', () => {
    const wrong = SEPHER_SEPHIROTH.filter((e) => detectScript(e.word) !== e.script)
    expect(wrong).toEqual([])
  })

  test('191 deeply frozen entries, no duplicate words, known sources, non-empty glosses', () => {
    expect(SEPHER_SEPHIROTH.length).toBe(191)
    expect(Object.isFrozen(SEPHER_SEPHIROTH)).toBe(true)
    const words = SEPHER_SEPHIROTH.map((e) => e.word)
    expect(new Set(words).size).toBe(words.length)
    for (const e of SEPHER_SEPHIROTH) {
      expect(Object.isFrozen(e)).toBe(true)
      expect(SOURCES.has(e.source)).toBe(true)
      expect(e.gloss.length).toBeGreaterThan(0)
      if (e.note !== undefined) expect(e.note.length).toBeGreaterThan(0)
    }
    const bySource = (s: string): number => SEPHER_SEPHIROTH.filter((e) => e.source === s).length
    expect(bySource('sepher-sephiroth')).toBeGreaterThanOrEqual(140)
  })

  test('scripts are grouped Hebrew → Greek → Latin, each ascending by value', () => {
    const order = SEPHER_SEPHIROTH.map((e) => e.script)
    expect(order.indexOf('greek')).toBeGreaterThan(order.lastIndexOf('hebrew'))
    expect(order.indexOf('latin')).toBeGreaterThan(order.lastIndexOf('greek'))
    for (const script of ['hebrew', 'greek', 'latin'] as const) {
      const values = SEPHER_SEPHIROTH.filter((e) => e.script === script).map((e) => e.value)
      expect(values).toEqual([...values].sort((a, b) => a - b))
    }
  })

  test("Babalon is Crowley's באבאלען = 156 (the ad-hoc בבלון = 90 is gone)", () => {
    const find = (w: string): LexiconEntry | undefined => SEPHER_SEPHIROTH.find((e) => e.word === w)
    expect(find('באבאלען')?.value).toBe(156)
    expect(find('בבלון')).toBeUndefined()
    expect(value('באבאלען', 'he-hechrachi')).toBe(value('Βαβαλον', 'gr-isopsephy'))
  })

  test("Stirling's ΟΚΤΩ ships as 1190, which his own printed totals require", () => {
    const find = (w: string): number => SEPHER_SEPHIROTH.find((e) => e.word === w)?.value ?? -1
    expect(find('Οκτω')).toBe(1190)
    // The Canon (1897), p. 67: "EIS 215, DUO, 474, ΤΡΕΙΣ, 615, yield 1,304" and TETRAS …
    // ENNEA "the sum of the numbers being 3,098" — with his printed OKTW = 1,100 it is 3,008.
    expect(find('Εις') + find('Δυο') + find('Τρεις')).toBe(1304)
    const six = ['Τετρας', 'Πεντε', 'Εξ', 'Επτα', 'Οκτω', 'Εννεα'].map(find)
    expect(six.reduce((a, b) => a + b, 0)).toBe(3098)
    expect(find('Δεκα')).toBe(30)
  })

  test('the famous numbers the notes cite are realized by the corpus (777 excepted)', () => {
    const values = new Set(SEPHER_SEPHIROTH.map((e) => e.value))
    for (const key of Object.keys(FAMOUS_NUMBERS).map(Number)) {
      if (key === 777) continue
      expect(values.has(key)).toBe(true)
    }
  })

  test('collision statistics of the Hebrew corpus match the python reference', () => {
    // python (fractions): n = 160, 115 distinct values, q = 27/2560, 55 equal pairs
    const p = collisionProfile(SEPHER_SEPHIROTH, 'he-hechrachi')
    expect(p.n).toBe(160)
    expect(p.distinct).toBe(115)
    expect(p.collisionProbability).toBeCloseTo(27 / 2560, 15)
    expect(p.observedEqualPairs).toBe(55)
    expect(p.collisionEntropyBits).toBeCloseTo(6.5670405927238935, 12)
    expect(p.birthdayBound50).toBeCloseTo(11.464782733589173, 10)
    expect(expectedMatches(SEPHER_SEPHIROTH, 'he-hechrachi')).toBeCloseTo(27 / 16, 14)
  })
})

describe('defaultLexicon', () => {
  test('registers the corpus and returns all words, or the admissible ones for a cipher', () => {
    clearDefaultLexicon()
    const words = defaultLexicon()
    expect(words.length).toBe(SEPHER_SEPHIROTH.length)
    expect(getDefaultLexicon()).toEqual(words)
    const hebrew = defaultLexicon('he-hechrachi')
    expect(hebrew.length).toBe(160)
    expect(hebrew.every((w) => detectScript(w) === 'hebrew')).toBe(true)
    expect(defaultLexicon('isopsephy').length).toBe(28)
  })

  test('the verified cross-script defect is gone: nothing matches at value 0', () => {
    defaultLexicon()
    for (const cipher of ['he-hechrachi', 'gr-isopsephy', 'en-ordinal'] as const) {
      expect(lookup(0, cipher).matches).toEqual([])
    }
    const r = matches('abc', 'he-hechrachi')
    expect(r.matches).toEqual([])
    expect(r.lexiconSize).toBe(160)
    expect(lookup(156, 'he-hechrachi').matches).toContain('באבאלען')
  })
})
