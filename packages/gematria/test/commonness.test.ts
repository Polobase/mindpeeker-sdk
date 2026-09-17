import { describe, expect, test } from 'bun:test'
import { birthdayBound, collisionProfile, expectedMatches } from '../src/commonness.js'
import { GematriaError } from '../src/errors.js'
import { matches } from '../src/match.js'
import { value } from '../src/value.js'

// en-ordinal values: a1 b2 c3 ab3 ba3 d4 ca4 → counts {1:1, 2:1, 3:3, 4:2}, n = 7
const LEXICON = ['a', 'b', 'c', 'ab', 'ba', 'd', 'ca', 'Αμην', '']

/** Brute force over ordered word pairs, straight from value(): Σ_i Σ_j w_i w_j [|v_i − v_j| ≤ t] / W². */
function bruteForce(words: readonly string[], t: number, weight: (w: string) => number = () => 1) {
  const vals = words.map((w) => value(w, 'en-ordinal'))
  let cross = 0
  let total = 0
  let pairs = 0
  let expected = 0
  for (let i = 0; i < words.length; i++) {
    total += weight(words[i] as string)
    let within = 0
    for (let j = 0; j < words.length; j++) {
      const hit = Math.abs((vals[i] as number) - (vals[j] as number)) <= t
      if (hit) {
        cross += weight(words[i] as string) * weight(words[j] as string)
        within++
        if (j > i) pairs++
      }
    }
    expected += weight(words[i] as string) * within
  }
  return { q: cross / (total * total), pairs, expectedMatches: expected / total }
}

const SCORING = ['a', 'b', 'c', 'ab', 'ba', 'd', 'ca']

describe('collisionProfile', () => {
  test('exact statistics of a small lexicon (q = 15/49)', () => {
    const p = collisionProfile(LEXICON, 'en-ordinal')
    expect(p.cipher).toBe('en-ordinal')
    expect(p.n).toBe(7)
    expect(p.distinct).toBe(4)
    expect(p.histogram).toEqual([
      { value: 1, count: 1, probability: 1 / 7 },
      { value: 2, count: 1, probability: 1 / 7 },
      { value: 3, count: 3, probability: 3 / 7 },
      { value: 4, count: 2, probability: 2 / 7 },
    ])
    expect(p.collisionProbability).toBe(15 / 49)
    expect(p.collisionEntropyBits).toBeCloseTo(-Math.log2(15 / 49), 12)
    expect(p.expectedEqualPairs).toBeCloseTo(21 * (15 / 49), 12)
    expect(p.observedEqualPairs).toBe(4) // C(3,2) + C(2,2)
    expect(p.birthdayBound50).toBeCloseTo(Math.sqrt((2 * Math.LN2 * 49) / 15), 12)
    expect(Object.isFrozen(p.histogram)).toBe(true)
  })

  test('with a ±1 window it agrees with brute-force pair enumeration', () => {
    for (const t of [0, 1, 2, 5]) {
      const p = collisionProfile(LEXICON, 'en-ordinal', { tolerance: t })
      const ref = bruteForce(SCORING, t)
      expect(p.tolerance).toBe(t)
      expect(p.collisionProbability).toBeCloseTo(ref.q, 14)
      expect(p.observedEqualPairs).toBe(ref.pairs)
    }
    expect(collisionProfile(LEXICON, 'en-ordinal', { colel: true }).collisionProbability).toBe(
      35 / 49,
    )
  })

  test('token weights reweight the value distribution (words missing from the map weigh 0)', () => {
    const weights = new Map([
      ['a', 5],
      ['ab', 2],
      ['ba', 1],
      ['d', 2],
    ])
    const weight = (w: string): number => weights.get(w) ?? 0
    for (const t of [0, 1]) {
      const p = collisionProfile(LEXICON, 'en-ordinal', { weights, tolerance: t })
      expect(p.collisionProbability).toBeCloseTo(bruteForce(SCORING, t, weight).q, 14)
      expect(p.n).toBe(7)
    }
    const p = collisionProfile(LEXICON, 'en-ordinal', { weights })
    expect(p.histogram.map((b) => b.probability)).toEqual([5 / 10, 0, 3 / 10, 2 / 10])
  })

  test('a uniform lexicon has q = 1/distinct and no observed pairs', () => {
    const words = 'abcdefghij'.split('')
    const p = collisionProfile(words, 'en-ordinal')
    expect(p.collisionProbability).toBeCloseTo(1 / 10, 15)
    expect(p.collisionEntropyBits).toBeCloseTo(Math.log2(10), 12)
    expect(p.observedEqualPairs).toBe(0)
  })

  test('rejects lexicons with no admissible word, bad weights and bad options', () => {
    expect(() => collisionProfile(['Αμην'], 'en-ordinal')).toThrow(
      expect.objectContaining({ code: 'no_match' }),
    )
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => collisionProfile(['a'], 'en-ordinal', { weights: { a: 1 } as any })).toThrow(
      GematriaError,
    )
    expect(() => collisionProfile(['a'], 'en-ordinal', { weights: new Map([['a', -1]]) })).toThrow(
      GematriaError,
    )
    expect(() => collisionProfile(['a'], 'en-ordinal', { weights: new Map([['b', 1]]) })).toThrow(
      expect.objectContaining({ code: 'invalid_input' }),
    )
    expect(() => collisionProfile(['a'], 'en-ordinal', { tolerance: -1 })).toThrow(GematriaError)
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => collisionProfile(['a'], 'nope' as any)).toThrow(
      expect.objectContaining({ code: 'unknown_cipher' }),
    )
  })
})

describe('expectedMatches', () => {
  test('is n·q without weights, and the average matches.length over the lexicon', () => {
    const e = expectedMatches(LEXICON, 'en-ordinal')
    expect(e).toBeCloseTo(15 / 7, 14)
    const average =
      SCORING.reduce((sum, w) => sum + matches(w, LEXICON, 'en-ordinal').matches.length, 0) /
      SCORING.length
    expect(e).toBeCloseTo(average, 14)
    for (const t of [1, 3]) {
      expect(expectedMatches(LEXICON, 'en-ordinal', { tolerance: t })).toBeCloseTo(
        bruteForce(SCORING, t).expectedMatches,
        14,
      )
    }
  })

  test('with weights the query is drawn by weight', () => {
    const weights = new Map([
      ['c', 3],
      ['d', 1],
    ])
    // query c (3 words at value 3) with weight 3/4, d (2 words at value 4) with weight 1/4
    expect(expectedMatches(LEXICON, 'en-ordinal', { weights })).toBeCloseTo(3 * 0.75 + 2 * 0.25, 14)
  })

  test('a lexicon of distinct values expects exactly one match (the word itself)', () => {
    expect(expectedMatches(['a', 'b', 'c'], 'en-ordinal')).toBe(1)
  })
})

describe('birthdayBound', () => {
  test('365 equally likely birthdays: √(2 ln 2 · 365) = 22.494… (python reference)', () => {
    expect(birthdayBound(1 / 365)).toBeCloseTo(22.49438689559598, 12)
    expect(birthdayBound(1 / 365, 0.99)).toBeCloseTo(Math.sqrt(2 * Math.log(100) * 365), 12)
  })

  test('rejects q outside (0, 1] and P outside (0, 1)', () => {
    for (const [q, p] of [
      [0, 0.5],
      [1.5, 0.5],
      [Number.NaN, 0.5],
      [0.1, 0],
      [0.1, 1],
    ] as const) {
      expect(() => birthdayBound(q, p)).toThrow(expect.objectContaining({ code: 'invalid_input' }))
    }
  })
})
