import { describe, expect, test } from 'bun:test'
import type { OracleError } from '../../../src/errors.js'
import {
  figureElement,
  figureFromBinary,
  GEOMANTIC_FIGURES,
} from '../../../src/systems/geomancy/data.js'

describe('geomancy data', () => {
  test('16 figures covering every 4-bit pattern exactly once', () => {
    expect(GEOMANTIC_FIGURES.length).toBe(16)
    const seen = new Set(GEOMANTIC_FIGURES.map((f) => f.binary))
    expect(seen.size).toBe(16)
    for (const f of GEOMANTIC_FIGURES) {
      expect(f.binary).toMatch(/^[01]{4}$/)
      expect(figureFromBinary(f.binary)).toBe(f)
      expect(f.binary).toBe(f.pattern.join(''))
    }
    expect(figureFromBinary('11111')).toBeUndefined()
  })

  test('points = sum of (2 - row): 4 for Via, 8 for Populus', () => {
    for (const f of GEOMANTIC_FIGURES) {
      expect(f.points).toBe(f.pattern.reduce<number>((s, r) => s + (2 - r), 0))
    }
    expect(figureFromBinary('1111')?.points).toBe(4)
    expect(figureFromBinary('0000')?.points).toBe(8)
    expect(figureFromBinary('0011')?.points).toBe(6)
  })

  test('spot-checks the standard table (frontend-compatible ids/binaries)', () => {
    expect(figureFromBinary('1111')).toMatchObject({ id: 'via', name: 'Via', meaning: 'The Way' })
    expect(figureFromBinary('0000')).toMatchObject({ id: 'populus', planet: 'Moon' })
    expect(figureFromBinary('0011')).toMatchObject({ id: 'fortuna-major', name: 'Fortuna Major' })
    expect(figureFromBinary('1100')).toMatchObject({ id: 'fortuna-minor' })
    expect(figureFromBinary('1000')).toMatchObject({ id: 'laetitia', meaning: 'Joy' })
    expect(figureFromBinary('0001')).toMatchObject({ id: 'tristitia', planet: 'Saturn' })
    expect(figureFromBinary('0110')).toMatchObject({ id: 'conjunctio' })
    expect(figureFromBinary('0100')).toMatchObject({ id: 'rubeus' })
  })

  test('every figure has one of the four classical elements', () => {
    for (const f of GEOMANTIC_FIGURES) {
      expect(['Fire', 'Air', 'Water', 'Earth']).toContain(f.element)
    }
  })

  test('Liber XCVI ch. I attributions: sign, nodes, planet (Golden Dawn table)', () => {
    // [id, sign or node, planet] transcribed from the 1909 table (glyph columns decoded).
    const table: readonly (readonly [string, string, string])[] = [
      ['puer', 'Aries', 'Mars'],
      ['amissio', 'Taurus', 'Venus'],
      ['albus', 'Gemini', 'Mercury'],
      ['populus', 'Cancer', 'Moon'],
      ['fortuna-major', 'Leo', 'Sun'],
      ['conjunctio', 'Virgo', 'Mercury'],
      ['puella', 'Libra', 'Venus'],
      ['rubeus', 'Scorpio', 'Mars'],
      ['acquisitio', 'Sagittarius', 'Jupiter'],
      ['carcer', 'Capricorn', 'Saturn'],
      ['tristitia', 'Aquarius', 'Saturn'],
      ['laetitia', 'Pisces', 'Jupiter'],
      ['cauda-draconis', 'south', 'Saturn/Mars'],
      ['caput-draconis', 'north', 'Jupiter/Venus'],
      ['fortuna-minor', 'Leo', 'Sun'],
      ['via', 'Cancer', 'Moon'],
    ]
    expect(table.length).toBe(16)
    for (const [id, signOrNode, planet] of table) {
      const figure = GEOMANTIC_FIGURES.find((f) => f.id === id)
      expect(figure?.planet).toBe(planet)
      if (signOrNode === 'north' || signOrNode === 'south') {
        expect(figure?.node).toBe(signOrNode)
        expect(figure?.sign).toBeNull()
      } else {
        expect(figure?.sign as string).toBe(signOrNode)
        expect(figure?.node).toBeNull()
      }
    }
  })

  test('elements: Golden Dawn (Fortuna Minor Fire) vs Liber XCVI (Fortuna Minor Air, 4 per element)', () => {
    const count = (system: 'goldenDawn' | 'liber96') => {
      const counts: Record<string, number> = {}
      for (const f of GEOMANTIC_FIGURES) {
        const element = figureElement(f, system)
        counts[element] = (counts[element] ?? 0) + 1
      }
      return counts
    }
    expect(count('goldenDawn')).toEqual({ Fire: 5, Air: 3, Water: 4, Earth: 4 })
    expect(count('liber96')).toEqual({ Fire: 4, Air: 4, Water: 4, Earth: 4 })
    const minor = figureFromBinary('1100')
    expect(minor && figureElement(minor)).toBe('Fire')
    expect(minor && figureElement(minor, 'liber96')).toBe('Air')
    for (const f of GEOMANTIC_FIGURES) {
      if (f.id !== 'fortuna-minor') expect(figureElement(f, 'liber96')).toBe(f.element)
    }
    for (const bad of [
      () => figureElement({ binary: 'xx' } as never),
      () => figureElement(minor as never, 'agrippa' as never),
    ]) {
      try {
        bad()
        expect.unreachable()
      } catch (err) {
        expect((err as OracleError).code).toBe('invalid_input')
      }
    }
  })

  test('table is deeply frozen', () => {
    expect(Object.isFrozen(GEOMANTIC_FIGURES)).toBe(true)
    expect(Object.isFrozen(GEOMANTIC_FIGURES[0])).toBe(true)
    expect(Object.isFrozen(GEOMANTIC_FIGURES[0]?.pattern)).toBe(true)
  })
})
