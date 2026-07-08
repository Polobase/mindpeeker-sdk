import { describe, expect, test } from 'bun:test'
import { figureFromBinary, GEOMANTIC_FIGURES } from '../../../src/systems/geomancy/data.js'

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

  test('table is deeply frozen', () => {
    expect(Object.isFrozen(GEOMANTIC_FIGURES)).toBe(true)
    expect(Object.isFrozen(GEOMANTIC_FIGURES[0])).toBe(true)
    expect(Object.isFrozen(GEOMANTIC_FIGURES[0]?.pattern)).toBe(true)
  })
})
