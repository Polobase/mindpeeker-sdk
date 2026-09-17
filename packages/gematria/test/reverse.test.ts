import { describe, expect, test } from 'bun:test'
import { HE_BASE } from '../src/ciphers/hebrew.js'
import { GematriaError } from '../src/errors.js'
import { atbash } from '../src/temurah.js'
import { analyze, letterValues, value } from '../src/value.js'

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (e) {
    return e instanceof GematriaError ? e.code : `foreign:${String(e)}`
  }
  return undefined
}

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

describe('reverse over the canonical alphabet (0.2.0 fixes)', () => {
  test('Hebrew finals mirror like their base letter (atbash identity)', () => {
    // Reference totals: the aleph↔tav mirror derived by hand / in Python —
    // ש→ב 2, ל→כ 20, ו→פ 80, ם→מ→י 10 = 112.
    const expected: Record<string, number> = {
      שלום: 112,
      אדם: 510,
      אמן: 419,
      כסף: 44,
      ארץ: 408,
      מלך: 60,
    }
    for (const [word, total] of Object.entries(expected)) {
      expect(value(word, 'he-hechrachi', true)).toBe(total)
      expect(value(word, 'he-atbash')).toBe(total)
      expect(value(atbash(word), 'he-hechrachi')).toBe(total)
    }
    expect(value('ם', 'he-hechrachi', true)).toBe(value('מ', 'he-hechrachi', true))
    const shalom = analyze('שלום', 'he-hechrachi', { reverse: true })
    expect(shalom.byLetter.map((b) => b.char)).toEqual(['ש', 'ל', 'ו', 'ם'])
  })

  test('reverse(he-hechrachi) === he-atbash for all 27 glyphs', () => {
    for (const ch of [...HE_BASE, 'ך', 'ם', 'ן', 'ף', 'ץ']) {
      expect(value(ch, 'he-hechrachi', true)).toBe(value(ch, 'he-atbash'))
    }
  })

  test('every 22-letter Hebrew cipher mirrors a final like its base letter', () => {
    for (const id of ['he-siduri', 'he-katan', 'he-atbash', 'he-albam', 'he-milui', 'he-kidmi']) {
      for (const [fin, base] of [
        ['ך', 'כ'],
        ['ם', 'מ'],
        ['ן', 'נ'],
        ['ף', 'פ'],
        ['ץ', 'צ'],
      ] as const) {
        expect(value(fin, id as 'he-siduri', true)).toBe(value(base, id as 'he-siduri', true))
        expect(value(fin, id as 'he-siduri', true)).toBeGreaterThan(0)
      }
    }
  })

  test('he-gadol reverse is the aleph↔tav mirror, not a 27-row mirror', () => {
    expect(value('א', 'he-gadol', true)).toBe(400)
    expect(value('ת', 'he-gadol', true)).toBe(1)
    expect(value('את', 'he-gadol', true)).toBe(401)
    // a reversed final takes its base letter's mirror value
    expect(value('ך', 'he-gadol', true)).toBe(value('כ', 'he-gadol', true))
    expect(value('ץ', 'he-gadol', true)).toBe(value('צ', 'he-gadol', true))
    // forward Gadol still gives the finals 500–900
    expect(value('ךםןףץ', 'he-gadol')).toBe(3500)
  })

  test('Greek reverse mirrors the 27 Milesian numerals; variants agree', () => {
    // Reference: python mirror over α…ϡ (i ↔ 26 − i): λ→ο 70, ο→λ 30, γ→ψ 700, ς→σ→η 8.
    expect(value('λογος', 'gr-isopsephy', true)).toBe(838)
    expect(value('λογοσ', 'gr-isopsephy', true)).toBe(838)
    for (const [a, b] of [
      ['σ', 'ς'],
      ['ϝ', 'ϛ'],
      ['ϙ', 'ϟ'],
    ] as const) {
      expect(value(a, 'gr-isopsephy', true)).toBe(value(b, 'gr-isopsephy', true))
    }
    const mirror: Record<string, number> = {
      α: 900,
      ϝ: 400,
      ζ: 300,
      η: 200,
      θ: 100,
      ι: 90,
      κ: 80,
      λ: 70,
      μ: 60,
      ν: 50,
      ρ: 9,
      τ: 7,
      ϡ: 1,
    }
    for (const [ch, v] of Object.entries(mirror)) expect(value(ch, 'gr-isopsephy', true)).toBe(v)
  })

  test('letterValues(reverse) keeps the table rows and mirrors their values', () => {
    const rev = letterValues('gr-isopsephy', true)
    expect(rev.length).toBe(30)
    expect(rev.find((r) => r.char === 'ς')?.value).toBe(8)
    expect(rev.find((r) => r.char === 'ϛ')?.value).toBe(400)
  })

  test('the reverse flag must be a boolean (or an options object)', () => {
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    const loose = value as (...args: any[]) => number
    expect(codeOf(() => loose('abc', 'en-ordinal', 'yes'))).toBe('invalid_input')
    expect(codeOf(() => loose('abc', 'en-ordinal', 1))).toBe('invalid_input')
    expect(codeOf(() => loose('abc', 'en-ordinal', null))).toBe('invalid_input')
    expect(codeOf(() => loose('abc', 'en-ordinal', { reverse: 'true' }))).toBe('invalid_input')
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(codeOf(() => letterValues('en-ordinal', 'yes' as any))).toBe('invalid_input')
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(codeOf(() => analyze('abc', 'en-ordinal', { reverse: 1 as any }))).toBe('invalid_input')
    expect(value('abc', 'en-ordinal', { reverse: true })).toBe(value('abc', 'en-ordinal', true))
  })
})
