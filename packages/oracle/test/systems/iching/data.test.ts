import { describe, expect, test } from 'bun:test'
import {
  HEXAGRAMS,
  hexagramFromBinary,
  LEGGE_NAMES,
  TRIGRAMS,
} from '../../../src/systems/iching/data.js'

describe('iching data', () => {
  test('64 hexagrams with unique King Wen numbers 1..64 in order', () => {
    expect(HEXAGRAMS.length).toBe(64)
    HEXAGRAMS.forEach((h, i) => {
      expect(h.kingWen).toBe(i + 1)
    })
  })

  test('every 6-bit pattern appears exactly once (the lookup is a bijection)', () => {
    const seen = new Set(HEXAGRAMS.map((h) => h.binary))
    expect(seen.size).toBe(64)
    for (const h of HEXAGRAMS) {
      expect(h.binary).toMatch(/^[01]{6}$/)
      expect(hexagramFromBinary(h.binary)).toBe(h)
    }
    expect(hexagramFromBinary('2')).toBeUndefined()
  })

  test('binary is lower trigram bits + upper trigram bits (bottom → top)', () => {
    for (const h of HEXAGRAMS) expect(h.binary).toBe(h.lower.bits + h.upper.bits)
  })

  test('unicode glyphs are U+4DC0 + kingWen - 1', () => {
    for (const h of HEXAGRAMS) {
      expect(h.character.codePointAt(0)).toBe(0x4dc0 + h.kingWen - 1)
    }
    expect(HEXAGRAMS[0]?.character).toBe('䷀')
  })

  test('spot-checks against the classical table', () => {
    expect(hexagramFromBinary('111111')?.name.pinyin).toBe('Qián')
    expect(hexagramFromBinary('000000')?.name.en).toBe('The Receptive')
    // 11 Peace: Heaven (lower) under Earth (upper); 12 Standstill is its inverse.
    expect(hexagramFromBinary('111000')?.kingWen).toBe(11)
    expect(hexagramFromBinary('000111')?.kingWen).toBe(12)
    // 63 After Completion: Fire below, Water above.
    expect(hexagramFromBinary('101010')?.kingWen).toBe(63)
  })

  test('trigram bits cover all 8 patterns and glyphs match', () => {
    const bits = new Set(Object.values(TRIGRAMS).map((t) => t.bits))
    expect(bits.size).toBe(8)
    expect(TRIGRAMS.Qian.character).toBe('☰')
    expect(TRIGRAMS.Kun.character).toBe('☷')
  })

  test('King Wen pairing: #k+1 is the 180° inversion of #k, or its complement when self-inverse', () => {
    // Independent structural check of all 64 rows (Wilhelm & Baynes 1950 on the pairing rule).
    const selfInverse: number[] = []
    for (let k = 1; k <= 63; k += 2) {
      const a = HEXAGRAMS[k - 1]?.binary as string
      const b = HEXAGRAMS[k]?.binary as string
      const inverted = [...a].reverse().join('')
      if (inverted === a) {
        selfInverse.push(k)
        expect(b).toBe([...a].map((bit) => (bit === '1' ? '0' : '1')).join(''))
      } else {
        expect(b).toBe(inverted)
      }
    }
    expect(selfInverse).toEqual([1, 27, 29, 61])
  })

  test('Legge romanizations: only the verified entries, exposed on name.legge', () => {
    expect(LEGGE_NAMES).toEqual({
      1: 'Khien',
      2: 'Khwan',
      3: 'Kun',
      4: 'Mang',
      5: 'Hsu',
      6: 'Sung',
      11: 'Thai',
      12: 'Phi',
      29: 'Khan',
      30: 'Li',
      31: 'Hsien',
    })
    for (const h of HEXAGRAMS) expect(h.name.legge).toBe(LEGGE_NAMES[h.kingWen] as string)
    expect(Object.keys(HEXAGRAMS[6]?.name ?? {})).toEqual(['zh', 'pinyin', 'en'])
    expect(Object.isFrozen(LEGGE_NAMES)).toBe(true)
  })

  test('tables are frozen', () => {
    expect(Object.isFrozen(HEXAGRAMS)).toBe(true)
    expect(Object.isFrozen(HEXAGRAMS[0])).toBe(true)
    expect(Object.isFrozen(HEXAGRAMS[0]?.name)).toBe(true)
    expect(Object.isFrozen(TRIGRAMS)).toBe(true)
    expect(Object.isFrozen(TRIGRAMS.Qian)).toBe(true)
  })
})
