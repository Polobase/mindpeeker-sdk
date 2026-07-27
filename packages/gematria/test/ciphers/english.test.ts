import { describe, expect, test } from 'bun:test'
import { ENGLISH_CIPHERS } from '../../src/ciphers/english.js'
import { value } from '../../src/value.js'

describe('english / latin ciphers', () => {
  test('all are deeply frozen with a complete 26-letter table', () => {
    for (const c of ENGLISH_CIPHERS) {
      expect(Object.isFrozen(c)).toBe(true)
      expect(Object.isFrozen(c.table)).toBe(true)
      for (const row of c.table) expect(Object.isFrozen(row)).toBe(true)
      expect(c.table.length).toBe(26)
    }
  })

  test('the historical set + NAEQ are not modern; the calculator ciphers are', () => {
    // the non-modern set is the stable invariant: the five historical ciphers
    // plus the extended NAEQ. Everything else (the ×6 wordplay, the
    // gematriaq-parity set, Plichta's prime cross) is a modern calculator cipher.
    const nonModern = ENGLISH_CIPHERS.filter((c) => !c.modern)
      .map((c) => c.id)
      .sort()
    expect(nonModern).toEqual([
      'en-naeq',
      'en-ordinal',
      'en-reduction',
      'en-reverse',
      'la-agrippa',
      'la-jewish',
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

  test('reverse ordinal is 27 − n', () => {
    expect(value('a', 'en-reverse')).toBe(26)
    expect(value('z', 'en-reverse')).toBe(1)
  })

  test('Agrippa Latin table with reconstructed J/U/W extensions', () => {
    // A1..Z500 core plus J600 U700 W900
    expect(value('a', 'la-agrippa')).toBe(1)
    expect(value('i', 'la-agrippa')).toBe(9)
    expect(value('k', 'la-agrippa')).toBe(10)
    expect(value('v', 'la-agrippa')).toBe(200)
    expect(value('z', 'la-agrippa')).toBe(500)
    expect(value('j', 'la-agrippa')).toBe(600)
    expect(value('u', 'la-agrippa')).toBe(700)
    expect(value('w', 'la-agrippa')).toBe(900)
  })

  test('modern ×6: A=6 … Z=156, reverse A=156 … Z=6', () => {
    expect(value('a', 'en-english')).toBe(6)
    expect(value('z', 'en-english')).toBe(156)
    expect(value('a', 'en-english-reverse')).toBe(156)
    expect(value('z', 'en-english-reverse')).toBe(6)
  })

  test('Jewish Gematria table, distinct from Agrippa only at U and V', () => {
    expect(value('a', 'la-jewish')).toBe(1)
    expect(value('i', 'la-jewish')).toBe(9)
    expect(value('k', 'la-jewish')).toBe(10)
    expect(value('t', 'la-jewish')).toBe(100)
    expect(value('u', 'la-jewish')).toBe(200)
    expect(value('v', 'la-jewish')).toBe(700)
    expect(value('j', 'la-jewish')).toBe(600)
    expect(value('w', 'la-jewish')).toBe(900)
    expect(value('z', 'la-jewish')).toBe(500)

    // only U and V disagree with la-agrippa
    expect(value('u', 'la-jewish')).not.toBe(value('u', 'la-agrippa'))
    expect(value('v', 'la-jewish')).not.toBe(value('v', 'la-agrippa'))
    for (const ch of 'abcdefghijklmnopqrstuvwxyz'.split('')) {
      if (ch === 'u' || ch === 'v') continue
      expect(value(ch, 'la-jewish')).toBe(value(ch, 'la-agrippa'))
    }
  })

  test('hand-summed words under Jewish Gematria', () => {
    expect(value('life', 'la-jewish')).toBe(20 + 9 + 6 + 5) // l20 i9 f6 e5
    expect(value('love', 'la-jewish')).toBe(20 + 50 + 700 + 5) // l20 o50 v700 e5
  })

  test('NAEQ / ALW (Crowley Liber Trigrammaton) is extended, not modern', () => {
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
