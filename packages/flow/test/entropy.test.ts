import { describe, expect, test } from 'bun:test'
import {
  conditionalMutualInformation,
  jointEntropy,
  mutualInformation,
  shannonEntropy,
} from '../src/entropy.js'
import { FlowError } from '../src/errors.js'
import { prngSymbols } from './helpers/streams.js'

describe('shannonEntropy', () => {
  test('closed forms: uniform → log2(A), constant → 0', () => {
    expect(shannonEntropy([0, 1, 2, 3])).toBe(2)
    expect(shannonEntropy([0, 0, 1, 1])).toBe(1)
    expect(shannonEntropy([7, 7, 7, 7])).toBe(0)
    const allBytes = Array.from({ length: 256 }, (_, i) => i)
    expect(shannonEntropy(allBytes)).toBe(8)
  })

  test('biased coin: H(1/4) = 2 − (3/4)·log2(3)', () => {
    expect(shannonEntropy([1, 0, 0, 0])).toBeCloseTo(2 - 0.75 * Math.log2(3), 14)
  })

  test('Miller–Madow adds (K−1)/(2N ln 2)', () => {
    const x = [0, 0, 1, 2]
    const plain = shannonEntropy(x)
    const corrected = shannonEntropy(x, { millerMadow: true })
    expect(corrected - plain).toBeCloseTo(2 / (2 * 4 * Math.LN2), 14)
  })

  test('rejects bad input', () => {
    expect(() => shannonEntropy([])).toThrow(FlowError)
    expect(() => shannonEntropy([0.5])).toThrow(FlowError)
    expect(() => shannonEntropy([-1])).toThrow(FlowError)
    expect(() => shannonEntropy([2], { alphabet: 2 })).toThrow(FlowError)
    expect(() => shannonEntropy([0], { alphabet: 0 })).toThrow(FlowError)
    try {
      shannonEntropy([0], { alphabet: 2 ** 31 })
      expect.unreachable()
    } catch (error) {
      expect((error as FlowError).code).toBe('alphabet_overflow')
    }
  })
})

describe('jointEntropy', () => {
  test('H(X, X) = H(X) and H(X, Y) = H(X) + H(Y) for independent uniform pairs', () => {
    const x = [0, 0, 1, 1]
    const y = [0, 1, 0, 1]
    expect(jointEntropy([x, x])).toBe(shannonEntropy(x))
    expect(jointEntropy([x, y])).toBe(2)
  })

  test('three variables enumerating all combinations', () => {
    // (x, y, z) uniform over 8 combinations → 3 bits
    const x = [0, 0, 0, 0, 1, 1, 1, 1]
    const y = [0, 0, 1, 1, 0, 0, 1, 1]
    const z = [0, 1, 0, 1, 0, 1, 0, 1]
    expect(jointEntropy([x, y, z])).toBe(3)
  })

  test('string-key fallback agrees with integer keys', () => {
    // 8 columns of alphabet 256 → 256^8 ≫ 2^31 forces string keys; compare
    // against the same data recoded to a smaller alphabet with identical counts
    const cols = Array.from({ length: 8 }, (_, i) => prngSymbols(200, 256, 0xc0ffee + i))
    const recoded = cols.map((col) => {
      const seen = new Map<number, number>()
      return Array.from(col, (v) => {
        if (!seen.has(v)) seen.set(v, seen.size)
        return seen.get(v) as number
      })
    })
    expect(jointEntropy(cols)).toBeCloseTo(jointEntropy(recoded), 12)
  })

  test('rejects mismatched lengths and empty variable lists', () => {
    expect(() => jointEntropy([])).toThrow(FlowError)
    expect(() => jointEntropy([[0, 1], [0]])).toThrow(FlowError)
    expect(() => jointEntropy([[], []])).toThrow(FlowError)
  })
})

describe('mutualInformation', () => {
  test('I(X;X) = H(X), I(X;Y) = 0 for exactly independent constructions', () => {
    const x = [0, 0, 1, 1]
    const y = [0, 1, 0, 1]
    expect(mutualInformation(x, x)).toBe(shannonEntropy(x))
    expect(mutualInformation(x, y)).toBe(0)
  })

  test('bijective relabeling preserves MI', () => {
    const x = prngSymbols(500, 3, 0x11)
    const y = prngSymbols(500, 3, 0x22)
    const relabeled = Array.from(x, (v) => [2, 0, 1][v] as number)
    expect(mutualInformation(relabeled, y)).toBe(mutualInformation(x, y))
  })

  test('small independent samples stay near 0 and are never negative', () => {
    const mi = mutualInformation(prngSymbols(4096, 4, 0xa1), prngSymbols(4096, 4, 0xb2))
    expect(mi).toBeGreaterThanOrEqual(0)
    expect(mi).toBeLessThan(0.01)
  })

  test('Miller–Madow correction is (Kx + Ky − Kxy − 1)/(2N ln 2)', () => {
    const x = [0, 0, 1, 1, 0, 1]
    const y = [0, 1, 1, 0, 0, 0]
    const plain = mutualInformation(x, y)
    const corrected = mutualInformation(x, y, { millerMadow: true })
    expect(corrected - plain).toBeCloseTo((2 + 2 - 4 - 1) / (2 * 6 * Math.LN2), 14)
  })

  test('rejects mismatched lengths', () => {
    expect(() => mutualInformation([0, 1], [0])).toThrow(FlowError)
  })
})

describe('conditionalMutualInformation', () => {
  test('I(X;Y|Z) = 0 when X and Y are both copies of Z', () => {
    const z = [0, 1, 0, 1, 1, 0]
    expect(conditionalMutualInformation(z, z, z)).toBe(0)
  })

  test('I(X;Y|Z) = H(X) when X = Y independent of Z', () => {
    const x = [0, 0, 1, 1]
    const z = [0, 1, 0, 1]
    expect(conditionalMutualInformation(x, x, z)).toBe(1)
  })

  test('conditioning reveals an XOR relation invisible to MI', () => {
    // x, z uniform independent; y = x XOR z: I(X;Y) = 0 but I(X;Y|Z) = 1
    const x = [0, 0, 1, 1]
    const z = [0, 1, 0, 1]
    const y = x.map((v, i) => v ^ (z[i] as number))
    expect(mutualInformation(x, y)).toBe(0)
    expect(conditionalMutualInformation(x, y, z)).toBe(1)
  })

  test('rejects mismatched z length', () => {
    expect(() => conditionalMutualInformation([0, 1], [0, 1], [0])).toThrow(FlowError)
  })
})
