import { describe, expect, test } from 'bun:test'
import { ELDER_FUTHARK } from '../../../src/systems/runes/data.js'

describe('runes data', () => {
  test('24 runes, unique ids and glyphs, futhark order', () => {
    expect(ELDER_FUTHARK.length).toBe(24)
    expect(new Set(ELDER_FUTHARK.map((r) => r.id)).size).toBe(24)
    expect(new Set(ELDER_FUTHARK.map((r) => r.glyph)).size).toBe(24)
    ELDER_FUTHARK.forEach((r, i) => {
      expect(r.index).toBe(i)
    })
    expect(ELDER_FUTHARK[0]).toMatchObject({ id: 'fehu', glyph: 'ᚠ' })
    expect(ELDER_FUTHARK[23]).toMatchObject({ id: 'othala', glyph: 'ᛟ' })
  })

  test('three ættir of eight, in order', () => {
    for (const rune of ELDER_FUTHARK) {
      expect(rune.aett).toBe((Math.floor(rune.index / 8) + 1) as 1 | 2 | 3)
    }
    expect(ELDER_FUTHARK[0]?.aettName).toBe('Freyr')
    expect(ELDER_FUTHARK[8]?.aettName).toBe('Heimdall')
    expect(ELDER_FUTHARK[16]?.aettName).toBe('Tyr')
  })

  test('exactly the standard nine point-symmetric runes are non-invertible', () => {
    // Thorsson (1984); glyphs invariant under 180° rotation.
    const nonInvertible = ELDER_FUTHARK.filter((r) => !r.invertible).map((r) => r.id)
    expect(nonInvertible).toEqual([
      'gebo',
      'hagalaz',
      'nauthiz',
      'isa',
      'jera',
      'eihwaz',
      'sowilo',
      'ingwaz',
      'dagaz',
    ])
  })

  test('table is frozen', () => {
    expect(Object.isFrozen(ELDER_FUTHARK)).toBe(true)
    expect(Object.isFrozen(ELDER_FUTHARK[0])).toBe(true)
  })
})
