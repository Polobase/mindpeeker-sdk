import { describe, expect, test } from 'bun:test'
import { ENGLISH_MODERN_CIPHERS } from '../../src/ciphers/english-modern.js'
import { value } from '../../src/value.js'

describe('gematriaq-parity modern English ciphers', () => {
  test('all eighteen are deeply frozen, modern, with a complete 26-letter table', () => {
    expect(ENGLISH_MODERN_CIPHERS.length).toBe(18)
    for (const c of ENGLISH_MODERN_CIPHERS) {
      expect(Object.isFrozen(c)).toBe(true)
      expect(Object.isFrozen(c.table)).toBe(true)
      for (const row of c.table) expect(Object.isFrozen(row)).toBe(true)
      expect(c.table.length).toBe(26)
      expect(c.script).toBe('latin')
      expect(c.modern).toBe(true)
      expect((c.description ?? '').length).toBeGreaterThan(0)
    }
  })

  test('every id from the gematriaq spec is present', () => {
    const ids = new Set(ENGLISH_MODERN_CIPHERS.map((c) => c.id))
    for (const id of [
      'en-standard',
      'en-reverse-reduction',
      'en-satanic',
      'en-reverse-satanic',
      'en-primes',
      'en-reverse-primes',
      'en-squares',
      'en-reverse-squares',
      'en-trigonal',
      'en-reverse-trigonal',
      'en-fibonacci',
      'en-chaldean',
      'en-septenary',
      'en-keypad',
      'en-prime-cross',
      'en-reverse-prime-cross',
      'en-prime-cross-primes',
      'en-reverse-prime-cross-primes',
    ]) {
      expect(ids.has(id as (typeof ENGLISH_MODERN_CIPHERS)[number]['id'])).toBe(true)
    }
  })

  test('the traditional Chaldean table never assigns 9', () => {
    const chaldean = ENGLISH_MODERN_CIPHERS.find((c) => c.id === 'en-chaldean')
    expect(chaldean).toBeDefined()
    for (const row of chaldean?.table ?? []) expect(row.value).not.toBe(9)
    expect(value('a', 'en-chaldean')).toBe(1)
    expect(value('f', 'en-chaldean')).toBe(8)
  })

  test('the E.161 keypad groups PQRS and WXYZ into four letters', () => {
    for (const ch of 'pqrs') expect(value(ch, 'en-keypad')).toBe(7)
    for (const ch of 'wxyz') expect(value(ch, 'en-keypad')).toBe(9)
  })

  test('primes/squares/trigonal reverse variants mirror the forward sequence', () => {
    expect(value('a', 'en-primes')).toBe(2)
    expect(value('z', 'en-primes')).toBe(101)
    expect(value('a', 'en-reverse-primes')).toBe(101)
    expect(value('z', 'en-reverse-primes')).toBe(2)
    expect(value('a', 'en-squares')).toBe(1)
    expect(value('z', 'en-squares')).toBe(676)
    expect(value('a', 'en-reverse-squares')).toBe(676)
    expect(value('z', 'en-reverse-squares')).toBe(1)
    expect(value('a', 'en-trigonal')).toBe(1)
    expect(value('z', 'en-trigonal')).toBe(351)
    expect(value('a', 'en-reverse-trigonal')).toBe(351)
    expect(value('z', 'en-reverse-trigonal')).toBe(1)
  })

  test('fibonacci starts A=1, B=1, C=2 and ends Z=121393', () => {
    expect(value('a', 'en-fibonacci')).toBe(1)
    expect(value('b', 'en-fibonacci')).toBe(1)
    expect(value('c', 'en-fibonacci')).toBe(2)
    expect(value('z', 'en-fibonacci')).toBe(121393)
  })

  test("Plichta's prime cross runs the 6n±1 sequence A=1…Z=77 (composites kept)", () => {
    expect(value('a', 'en-prime-cross')).toBe(1)
    expect(value('h', 'en-prime-cross')).toBe(23)
    expect(value('i', 'en-prime-cross')).toBe(25) // 25 = 5², a composite on the cross
    expect(value('z', 'en-prime-cross')).toBe(77) // 77 = 7×11, also composite
    // the reverse reads the same table from the other end
    expect(value('z', 'en-reverse-prime-cross')).toBe(1)
    expect(value('a', 'en-reverse-prime-cross')).toBe(77)
  })

  test('the primes-only cross keeps the central 1, then skips composites', () => {
    expect(value('a', 'en-prime-cross-primes')).toBe(1)
    expect(value('h', 'en-prime-cross-primes')).toBe(23)
    expect(value('i', 'en-prime-cross-primes')).toBe(29) // 25 dropped → next prime
    expect(value('z', 'en-prime-cross-primes')).toBe(103)
    expect(value('z', 'en-reverse-prime-cross-primes')).toBe(1)
    expect(value('a', 'en-reverse-prime-cross-primes')).toBe(103)
  })

  test('the two cross ciphers agree through H, then diverge at the first composite', () => {
    for (const ch of 'abcdefgh') {
      expect(value(ch, 'en-prime-cross')).toBe(value(ch, 'en-prime-cross-primes'))
    }
    expect(value('i', 'en-prime-cross')).not.toBe(value('i', 'en-prime-cross-primes'))
  })
})

// Authoritative word readouts for the four Plichta prime-cross ciphers (over the
// shared "gematria" fixture word) live in the checked-in
// `test/fixtures/reference-vectors.json`, run generically by `value.test.ts`.
