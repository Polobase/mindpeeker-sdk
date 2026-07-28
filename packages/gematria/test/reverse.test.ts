import { describe, expect, test } from 'bun:test'
import { analyze, letterValues, value } from '../src/value.js'

describe('reverse option (value / analyze / letterValues)', () => {
  test('reverse ordinal is the classic 27 − n (A26 … Z1)', () => {
    expect(value('a', 'en-ordinal', true)).toBe(26)
    expect(value('z', 'en-ordinal', true)).toBe(1)
    expect(value('gematria', 'en-ordinal', true)).toBe(27 * 8 - value('gematria', 'en-ordinal'))
  })

  test('the ×6 ciphers reversed are the reverse ordinal × 6 (A156 … Z6)', () => {
    expect(value('a', 'en-english', true)).toBe(156)
    expect(value('z', 'en-english', true)).toBe(6)
    for (const w of ['love', 'gematria', 'chaos', 'wizard']) {
      expect(value(w, 'en-english', true)).toBe(value(w, 'en-ordinal', true) * 6)
      expect(value(w, 'en-sumerian', true)).toBe(value(w, 'en-english', true))
    }
  })

  test('reverse assigns each letter its mirror value, on every cipher', () => {
    for (const c of [
      'en-primes',
      'en-squares',
      'en-trigonal',
      'en-cross',
      'en-prime-cross',
    ] as const) {
      expect(value('a', c, true)).toBe(value('z', c))
      expect(value('z', c, true)).toBe(value('a', c))
    }
    expect(value('a', 'la-agrippa', true)).toBe(value('z', 'la-agrippa'))
    expect(value('a', 'en-fibonacci', true)).toBe(value('z', 'en-fibonacci'))
    expect(value('a', 'en-chaldean', true)).toBe(value('z', 'en-chaldean'))
    expect(value('b', 'la-jewish', true)).toBe(value('y', 'la-jewish'))
  })

  test('Hebrew reverse equals atbash', () => {
    // he-atbash IS the mirror of he-hechrachi (aleph↔tav)
    expect(value('אבג', 'he-hechrachi', true)).toBe(value('אבג', 'he-atbash'))
  })

  test('letterValues(reverse) mirrors the table', () => {
    const fwd = letterValues('en-ordinal')
    const rev = letterValues('en-ordinal', true)
    expect(rev[0]).toEqual({ char: 'a', value: 26 })
    expect(rev[25]).toEqual({ char: 'z', value: 1 })
    expect(rev.map((r) => r.value)).toEqual([...fwd].reverse().map((r) => r.value))
  })

  test('analyze honors opts.reverse', () => {
    const r = analyze('abc', 'en-ordinal', { reverse: true })
    expect(r.value).toBe(26 + 25 + 24)
    expect(r.value).toBe(value('abc', 'en-ordinal', true))
  })

  test('a "love-like" word mirrors on every cipher (forward === reverse)', () => {
    const ciphers = [
      'en-ordinal',
      'en-reduction',
      'en-satanic',
      'en-primes',
      'en-squares',
      'en-trigonal',
      'en-cross',
      'en-prime-cross',
    ] as const
    for (const c of ciphers) expect(value('love', c, true)).toBe(value('love', c))
  })
})
