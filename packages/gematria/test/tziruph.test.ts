import { describe, expect, test } from 'bun:test'
import { HE_BASE } from '../src/ciphers/hebrew.js'
import { GematriaError } from '../src/errors.js'
import { achbi, aibat, atbash, temurahShift } from '../src/temurah.js'
import {
  ACHBI,
  AGDATH,
  AIBAT,
  ALBATH,
  ASHBAR,
  ATHBASH,
  TZIRUPH_TABLES,
  tziruph,
  tziruphSquare,
} from '../src/tziruph.js'

const ALPHABET = HE_BASE.join('')

/** Mathers' transliteration (I = yod, O = ayin, T = teth, Th = tav). */
const MATHERS: Readonly<Record<string, string>> = {
  A: 'א',
  B: 'ב',
  G: 'ג',
  D: 'ד',
  H: 'ה',
  V: 'ו',
  Z: 'ז',
  Ch: 'ח',
  T: 'ט',
  I: 'י',
  K: 'כ',
  L: 'ל',
  M: 'מ',
  N: 'נ',
  S: 'ס',
  O: 'ע',
  P: 'פ',
  Tz: 'צ',
  Q: 'ק',
  R: 'ר',
  Sh: 'ש',
  Th: 'ת',
}

function transliterate(abbreviation: string): string[] {
  return (abbreviation.match(/Ch|Sh|Th|Tz|[A-Z]/g) ?? []).map((t) => MATHERS[t] as string)
}

/** The partner map of a table, read off tziruph itself letter by letter. */
function partners(k: number, selfPairs: 'swap' | 'fixed'): Map<string, string> {
  return new Map(HE_BASE.map((ch) => [ch, tziruph(ch, k, { selfPairs })]))
}

describe('tziruph', () => {
  test("Mathers' worked example: by Albath RVCh (רוח) becomes DTzO (דצע)", () => {
    expect(tziruph('רוח', ALBATH)).toBe('דצע')
  })

  test("Mathers' Albath layout: row K … A over M … L, pair by pair", () => {
    const top = 'כיטחזוהדגבא'
    const bottom = 'מנסעפצקרשתל'
    for (let i = 0; i < 11; i++) {
      expect(tziruph(top[i] as string, ALBATH)).toBe(bottom[i] as string)
      expect(tziruph(bottom[i] as string, ALBATH)).toBe(top[i] as string)
    }
  })

  test('Athbash is atbash (YHVH → MTzPTz, ShShK → BBL)', () => {
    expect(tziruph(ALPHABET, ATHBASH)).toBe(atbash(ALPHABET))
    expect(tziruph('יהוה', ATHBASH)).toBe('מצפצ')
    expect(tziruph('ששך', ATHBASH)).toBe('בבל')
  })

  test('every table in both conventions is an involution and a reflection i + j ≡ k (mod 22)', () => {
    for (let k = 1; k <= 22; k++) {
      for (const mode of ['swap', 'fixed'] as const) {
        expect(tziruph(tziruph(ALPHABET, k, { selfPairs: mode }), k, { selfPairs: mode })).toBe(
          ALPHABET,
        )
        for (const [from, to] of partners(k, mode)) {
          const i = HE_BASE.indexOf(from) + 1
          const j = HE_BASE.indexOf(to) + 1
          const selfMirrored = (2 * i) % 22 === k % 22
          if (selfMirrored) {
            expect(j).toBe(mode === 'swap' ? ((i + 10) % 22) + 1 : i)
          } else {
            expect((i + j) % 22).toBe(k % 22)
          }
        }
      }
    }
  })

  test('the first pair of every name is א ↔ letter k − 1', () => {
    for (const table of TZIRUPH_TABLES) {
      const [a, partner] = transliterate(table.abbreviation)
      expect(a).toBe('א')
      expect(tziruph('א', table.k)).toBe(partner as string)
      expect(tziruph('א', table.k, { selfPairs: 'fixed' }).length).toBe(1)
    }
  })

  test('names are the first two pairs: all but Agdath under swap, all but Albath under fixed', () => {
    const mismatches = (mode: 'swap' | 'fixed'): number[] => {
      const out: number[] = []
      for (const table of TZIRUPH_TABLES) {
        const map = partners(table.k, mode)
        const [, p1, x, p2] = transliterate(table.abbreviation)
        const named = new Set(['א', map.get('א')])
        const next = HE_BASE.slice(1).find((ch) => !named.has(ch) && map.get(ch) !== ch)
        if (map.get('א') !== p1 || next !== x || map.get(next as string) !== p2) out.push(table.k)
      }
      return out
    }
    expect(mismatches('swap')).toEqual([AGDATH])
    expect(mismatches('fixed')).toEqual([ALBATH])
  })

  test("selfPairs 'fixed' on Achbi is the folded-halves achbi; the default differs only at ו↔פ", () => {
    expect(tziruph(ALPHABET, ACHBI, { selfPairs: 'fixed' })).toBe(achbi(ALPHABET))
    expect(tziruph('ופ', ACHBI)).toBe('פו')
    expect(achbi('ופ')).toBe('ופ')
    const other = HE_BASE.filter((ch) => ch !== 'ו' && ch !== 'פ').join('')
    expect(tziruph(other, ACHBI)).toBe(achbi(other))
  })

  test('Aibat (odd) swaps כ↔ת, where the folded-halves aibat keeps them fixed', () => {
    expect(tziruph('כת', AIBAT)).toBe('תכ')
    expect(aibat('כת')).toBe('כת')
    const other = HE_BASE.filter((ch) => ch !== 'כ' && ch !== 'ת').join('')
    expect(tziruph(other, AIBAT)).toBe(aibat(other))
  })

  test('Ashbar pairs א↔ש, ב↔ר and swaps its self-mirrored letters כ↔ת', () => {
    expect(tziruph('אב', ASHBAR)).toBe('שר')
    expect(tziruph('כת', ASHBAR)).toBe('תכ')
    expect(tziruph('כת', ASHBAR, { selfPairs: 'fixed' })).toBe('כת')
  })

  test('finals fold, niqqud are stripped, other characters pass through', () => {
    expect(tziruph('ם a', ALBATH)).toBe(tziruph('מ a', ALBATH))
    expect(tziruph('רוּחַ', ALBATH)).toBe('דצע')
  })

  test('rejects bad tables, options and text', () => {
    for (const k of [0, 23, 1.5, Number.NaN, '2']) {
      // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
      expect(() => tziruph('א', k as any)).toThrow(GematriaError)
    }
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => tziruph('א', 2, { selfPairs: 'bogus' as any })).toThrow(GematriaError)
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => tziruph('א', 2, 'swap' as any)).toThrow(GematriaError)
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => tziruph(7 as any, 2)).toThrow(expect.objectContaining({ code: 'invalid_input' }))
  })
})

describe('TZIRUPH_TABLES', () => {
  test('22 frozen tables with Ginsburg numbering (Albath 1, Aibat 10, Achbi 11, Athbash 22)', () => {
    expect(TZIRUPH_TABLES.length).toBe(22)
    expect(Object.isFrozen(TZIRUPH_TABLES)).toBe(true)
    expect(TZIRUPH_TABLES.map((t) => t.k)).toEqual(Array.from({ length: 22 }, (_, i) => i + 1))
    const byName = new Map(TZIRUPH_TABLES.map((t) => [t.name, t]))
    expect(byName.get('Albath')?.ginsburg).toBe(1)
    expect(byName.get('Aibat')?.ginsburg).toBe(10)
    expect(byName.get('Achbi')?.ginsburg).toBe(11)
    expect(byName.get('Athbash')?.ginsburg).toBe(22)
    expect(new Set(TZIRUPH_TABLES.map((t) => t.ginsburg)).size).toBe(22)
    expect(byName.get('Achbi')?.k).toBe(ACHBI)
  })
})

describe('tziruphSquare', () => {
  test('Right table: row r is the alphabet shifted by r (B … A, G … B, …)', () => {
    const right = tziruphSquare('right')
    expect(right.length).toBe(22)
    expect(right[0]?.join('')).toBe(ALPHABET)
    expect(right[1]?.[0]).toBe('ב')
    expect(right[1]?.[21]).toBe('א')
    for (let r = 0; r < 22; r++) expect(right[r]?.join('')).toBe(temurahShift(ALPHABET, r))
    expect(Object.isFrozen(right)).toBe(true)
    expect(Object.isFrozen(right[3])).toBe(true)
  })

  test('Averse table: the alphabet backwards from Th, then from Sh ending with Th', () => {
    const averse = tziruphSquare('averse')
    expect(averse[0]?.join('')).toBe([...HE_BASE].reverse().join(''))
    expect(averse[1]?.[0]).toBe('ש')
    expect(averse[1]?.[21]).toBe('ת')
    for (const row of averse) expect(new Set(row).size).toBe(22)
  })

  test('rejects an unknown kind', () => {
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => tziruphSquare('irregular' as any)).toThrow(GematriaError)
  })
})
