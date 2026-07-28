import { describe, expect, test } from 'bun:test'
import { analyze, letterValues, value } from '../src/value.js'

describe('reverse option (value / analyze / letterValues)', () => {
  test('reverse reproduces the historic reverse-cipher ids exactly', () => {
    for (const w of ['love', 'gematria', 'chaos', 'wizard']) {
      expect(value(w, 'en-ordinal', true)).toBe(value(w, 'en-reverse'))
      expect(value(w, 'en-reduction', true)).toBe(value(w, 'en-reverse-reduction'))
      expect(value(w, 'en-satanic', true)).toBe(value(w, 'en-reverse-satanic'))
      expect(value(w, 'en-primes', true)).toBe(value(w, 'en-reverse-primes'))
      expect(value(w, 'en-squares', true)).toBe(value(w, 'en-reverse-squares'))
      expect(value(w, 'en-trigonal', true)).toBe(value(w, 'en-reverse-trigonal'))
      expect(value(w, 'en-cross', true)).toBe(value(w, 'en-reverse-cross'))
      expect(value(w, 'en-prime-cross', true)).toBe(value(w, 'en-reverse-prime-cross'))
      expect(value(w, 'en-english', true)).toBe(value(w, 'en-english-reverse'))
    }
  })

  test('reverse assigns each letter its mirror value — even for ciphers with no reverse id', () => {
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
