import { describe, expect, test } from 'bun:test'
import { uniformBelow, xoshiro128, xoshiro128FromState } from '../../src/internal/prng.js'

describe('xoshiro128**', () => {
  test('reproduces the reference outputs for state (1, 2, 3, 4)', () => {
    const next = xoshiro128FromState(1, 2, 3, 4)
    expect([next(), next(), next(), next()]).toEqual([11520, 0, 5927040, 70819200])
  })

  test('seeded streams are deterministic and differ between seeds (incl. high bits)', () => {
    const take = (seed: number): number[] => {
      const next = xoshiro128(seed)
      return Array.from({ length: 4 }, () => next())
    }
    expect(take(7)).toEqual(take(7))
    expect(take(7)).not.toEqual(take(8))
    expect(take(2 ** 40)).not.toEqual(take(0))
  })

  test('uniformBelow stays in range and covers every residue', () => {
    const next = xoshiro128(1)
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) {
      const v = uniformBelow(next, 7)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(7)
      seen.add(v)
    }
    expect(seen.size).toBe(7)
  })
})
