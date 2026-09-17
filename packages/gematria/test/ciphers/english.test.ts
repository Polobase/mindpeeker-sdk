import { describe, expect, test } from 'bun:test'
import { ENGLISH_CIPHERS } from '../../src/ciphers/english.js'
import { LATIN_EXTRA_CIPHERS } from '../../src/ciphers/latin-extra.js'
import type { GematriaError } from '../../src/errors.js'
import { analyze, letterValues, value } from '../../src/value.js'

const EXTRA_IDS = new Set(LATIN_EXTRA_CIPHERS.map((c) => c.id))

describe('english / latin ciphers', () => {
  test('the 26-letter ciphers are deeply frozen with a complete table', () => {
    for (const c of ENGLISH_CIPHERS.filter((x) => !EXTRA_IDS.has(x.id))) {
      expect(Object.isFrozen(c)).toBe(true)
      expect(Object.isFrozen(c.table)).toBe(true)
      for (const row of c.table) expect(Object.isFrozen(row)).toBe(true)
      expect(c.table.length).toBe(26)
      expect(c.alphabet.join('')).toBe('abcdefghijklmnopqrstuvwxyz')
    }
  })

  test('the historical and published set is not modern; the calculator ciphers are', () => {
    // the non-modern set is the stable invariant: the four historical ciphers,
    // the Thelemic NAEQ/TQ and the Elizabethan/Roman tables. Everything else
    // (the ×6 wordplay, the gematriaq-parity set, Plichta's crosses, AQ) is a
    // modern calculator cipher.
    const nonModern = ENGLISH_CIPHERS.filter((c) => !c.modern)
      .map((c) => c.id)
      .sort()
    expect(nonModern).toEqual([
      'en-naeq',
      'en-ordinal',
      'en-reduction',
      'en-tq',
      'la-agrippa',
      'la-elizabethan-kaye',
      'la-elizabethan-simple',
      'la-jewish',
      'la-roman',
    ])
    expect(ENGLISH_CIPHERS.find((c) => c.id === 'en-english')?.modern).toBe(true)
    expect(ENGLISH_CIPHERS.find((c) => c.id === 'en-primes')?.modern).toBe(true)
    expect(ENGLISH_CIPHERS.find((c) => c.id === 'en-prime-cross')?.modern).toBe(true)
  })

  test('ordinal A=1 … Z=26', () => {
    expect(value('a', 'en-ordinal')).toBe(1)
    expect(value('z', 'en-ordinal')).toBe(26)
    expect(value('abc', 'en-ordinal')).toBe(6)
  })

  test('reduction is the per-letter digital root of the ordinal', () => {
    // j=10→1, k=11→2, ... a=1
    expect(value('j', 'en-reduction')).toBe(1)
    expect(value('r', 'en-reduction')).toBe(9) // 18→9
    expect(value('abc', 'en-reduction')).toBe(6)
  })

  test("Agrippa's printed key (II.xx): vowel V → U=200, consonant I → J=600, consonant V=700, HV → W=900", () => {
    expect(value('a', 'la-agrippa')).toBe(1)
    expect(value('i', 'la-agrippa')).toBe(9)
    expect(value('k', 'la-agrippa')).toBe(10)
    expect(value('t', 'la-agrippa')).toBe(100)
    expect(value('u', 'la-agrippa')).toBe(200)
    expect(value('x', 'la-agrippa')).toBe(300)
    expect(value('z', 'la-agrippa')).toBe(500)
    expect(value('j', 'la-agrippa')).toBe(600)
    expect(value('v', 'la-agrippa')).toBe(700)
    expect(value('w', 'la-agrippa')).toBe(900)
    // the HI digraph (800) is not scored: H and I count separately
    expect(value('hi', 'la-agrippa')).toBe(17)
  })

  test('modern ×6: A=6 … Z=156, and reversed A=156 … Z=6', () => {
    expect(value('a', 'en-english')).toBe(6)
    expect(value('z', 'en-english')).toBe(156)
    expect(value('a', 'en-english', true)).toBe(156)
    expect(value('z', 'en-english', true)).toBe(6)
  })

  test("Jewish Gematria is the same table as Agrippa's key", () => {
    expect(letterValues('la-jewish')).toEqual(letterValues('la-agrippa'))
    expect(letterValues('la-jewish', true)).toEqual(letterValues('la-agrippa', true))
    // Hubbard, Number Games: 'Tisha B'Av' = 911 under Jewish Gematria (U200 V700)
    expect(value("Tisha B'Av", 'la-jewish')).toBe(911)
    expect(value("Tisha B'Av", 'la-agrippa')).toBe(911)
  })

  test('hand-summed words under Jewish Gematria', () => {
    expect(value('life', 'la-jewish')).toBe(20 + 9 + 6 + 5) // l20 i9 f6 e5
    expect(value('love', 'la-jewish')).toBe(20 + 50 + 700 + 5) // l20 o50 v700 e5
  })

  test('NAEQ / ALW (James Lees, 1976) is extended, not modern', () => {
    const naeq = ENGLISH_CIPHERS.find((c) => c.id === 'en-naeq')
    expect(naeq?.extended).toBe(true)
    expect(naeq?.modern).toBe(false)
    // the cipher's own name enumerates its first three values: A1 L2 W3
    expect(value('alw', 'en-naeq')).toBe(6)
    // full documented order A1 L2 W3 H4 S5 D6 O7 Z8 K9 V10 … P26
    expect(value('h', 'en-naeq')).toBe(4)
    expect(value('p', 'en-naeq')).toBe(26)
    expect(value('i', 'en-naeq')).toBe(23)
    // LASHTAL — L2 A1 S5 H4 T24 A1 L2
    expect(value('lashtal', 'en-naeq')).toBe(2 + 1 + 5 + 4 + 24 + 1 + 2)
  })
})

describe("en-reduction keepTen (Hubbard's S/H = 10 rule)", () => {
  test('S scores 10 forward; H scores 10 under reverse', () => {
    expect(value('s', 'en-reduction')).toBe(1)
    expect(value('s', 'en-reduction', { keepTen: true })).toBe(10)
    expect(value('h', 'en-reduction', { reverse: true })).toBe(1)
    expect(value('h', 'en-reduction', { reverse: true, keepTen: true })).toBe(10)
    // every other letter is unchanged
    for (const ch of 'abcdefghijklmnopqrtuvwxyz') {
      expect(value(ch, 'en-reduction', { keepTen: true })).toBe(value(ch, 'en-reduction'))
    }
  })

  test("Hubbard's anchors: 'Trump Heights' = 74 and 'Los Angeles' = 55 with keepTen", () => {
    expect(value('Trump Heights', 'en-reduction')).toBe(65)
    expect(value('Trump Heights', 'en-reduction', { keepTen: true })).toBe(74)
    expect(value('Los Angeles', 'en-reduction')).toBe(37)
    expect(value('Los Angeles', 'en-reduction', { keepTen: true })).toBe(55)
    const r = analyze('Los Angeles', 'en-reduction', { keepTen: true })
    expect(r.byLetter.filter((b) => b.char === 's').map((b) => b.value)).toEqual([10, 10])
    expect(letterValues('en-reduction', { keepTen: true }).find((x) => x.char === 's')?.value).toBe(
      10,
    )
  })

  test('keepTen on any other cipher, or a non-boolean keepTen, is invalid_input', () => {
    const codeOf = (fn: () => unknown) => {
      try {
        fn()
      } catch (e) {
        return (e as GematriaError).code
      }
      return undefined
    }
    expect(codeOf(() => value('s', 'en-ordinal', { keepTen: true }))).toBe('invalid_input')
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(codeOf(() => value('s', 'en-reduction', { keepTen: 'yes' as any }))).toBe(
      'invalid_input',
    )
    // keepTen: false is a no-op everywhere
    expect(value('s', 'en-ordinal', { keepTen: false })).toBe(19)
  })
})
