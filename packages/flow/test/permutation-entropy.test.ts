import { describe, expect, test } from 'bun:test'
import { FlowError } from '../src/errors.js'
import { permutationEntropy, weightedPermutationEntropy } from '../src/permutation-entropy.js'
import { prngUniforms } from './helpers/streams.js'

function factorial(m: number): number {
  let f = 1
  for (let i = 2; i <= m; i++) f *= i
  return f
}

/**
 * Independent permutation-entropy reference using an argsort-based pattern key
 * (a DIFFERENT encoding than flow's rank-vector Lehmer code). Entropy is
 * invariant to the pattern→label bijection, so this must agree exactly.
 */
function referencePE(
  values: readonly number[],
  order: number,
  delay = 1,
  normalize = false,
): number {
  const count = values.length - (order - 1) * delay
  const counts = new Map<string, number>()
  for (let s = 0; s < count; s++) {
    const window: [number, number][] = []
    for (let j = 0; j < order; j++) window.push([values[s + j * delay] as number, j])
    window.sort((a, b) => a[0] - b[0] || a[1] - b[1]) // stable argsort, ties by index
    const key = window.map((w) => w[1]).join(',')
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let h = 0
  for (const c of counts.values()) {
    const p = c / count
    h -= p * Math.log2(p)
  }
  return normalize ? h / Math.log2(factorial(order)) : h
}

describe('permutationEntropy', () => {
  test('analytic KAT: order-2 alternating series → binary entropy of up/down', () => {
    // [1,2,1,2,1,2] → windows up,down,up,down,up → 3 up / 2 down
    const pe = permutationEntropy([1, 2, 1, 2, 1, 2], 2)
    const expected = -0.6 * Math.log2(0.6) - 0.4 * Math.log2(0.4)
    expect(pe).toBeCloseTo(expected, 12)
    expect(pe).toBeCloseTo(0.9709505944546686, 12)
  })

  test('monotone and constant series score 0', () => {
    expect(permutationEntropy([1, 2, 3, 4, 5, 6, 7, 8], 3)).toBe(0) // one pattern
    expect(permutationEntropy(new Array(20).fill(5), 3)).toBe(0) // ties → one pattern
  })

  test('matches the independent argsort reference across orders/delays', () => {
    const values = Array.from(prngUniforms(2000, 0x1234))
    for (const order of [2, 3, 4, 5]) {
      for (const delay of [1, 2, 3]) {
        expect(permutationEntropy(values, order, { delay })).toBeCloseTo(
          referencePE(values, order, delay),
          10,
        )
        expect(permutationEntropy(values, order, { delay, normalize: true })).toBeCloseTo(
          referencePE(values, order, delay, true),
          10,
        )
      }
    }
  })

  test('white noise approaches maximum normalized entropy', () => {
    const noise = Array.from(prngUniforms(50_000, 0x5eed))
    expect(permutationEntropy(noise, 4, { normalize: true })).toBeGreaterThan(0.99)
  })

  test('structured (sinusoid) < noise', () => {
    const sine = Array.from({ length: 5000 }, (_, t) => Math.sin(t / 5))
    const noise = Array.from(prngUniforms(5000, 0xbeef))
    expect(permutationEntropy(sine, 4, { normalize: true })).toBeLessThan(
      permutationEntropy(noise, 4, { normalize: true }),
    )
  })

  test('is deterministic and delegates validation to ordinalPatterns', () => {
    const v = Array.from(prngUniforms(100, 0x99))
    expect(permutationEntropy(v, 3)).toBe(permutationEntropy(v, 3))
    expect(() => permutationEntropy(v, 1)).toThrow(FlowError) // order < 2
    expect(() => permutationEntropy(v, 13)).toThrow(FlowError) // alphabet_overflow
    expect(() => permutationEntropy([1, 2], 5)).toThrow(FlowError) // insufficient_data
  })
})

describe('weightedPermutationEntropy', () => {
  test('equals plain PE when all windows carry equal amplitude', () => {
    // a pure ±1 square wave: every order-2 window has identical variance → uniform weights
    const square = Array.from({ length: 200 }, (_, t) => (t % 2 === 0 ? 1 : -1))
    expect(weightedPermutationEntropy(square, 2)).toBeCloseTo(permutationEntropy(square, 2), 12)
  })

  test('constant series → 0 (zero amplitude everywhere)', () => {
    expect(weightedPermutationEntropy(new Array(50).fill(3), 3)).toBe(0)
  })

  test('downweights low-amplitude noise: a big swing dominates the entropy', () => {
    // tiny noise for a while, then one large clean ramp — WPE weights the ramp
    const noise = Array.from(prngUniforms(2000, 0x77)).map((u) => (u - 0.5) * 1e-6)
    const ramp = Array.from({ length: 2000 }, (_, t) => t)
    const mixed = [...noise, ...ramp]
    // the ramp is a single ascending pattern (near-0 entropy); weighting by
    // amplitude pulls WPE below the amplitude-blind PE
    expect(weightedPermutationEntropy(mixed, 3, { normalize: true })).toBeLessThan(
      permutationEntropy(mixed, 3, { normalize: true }),
    )
  })

  test('normalized WPE stays in [0, 1]', () => {
    const v = Array.from(prngUniforms(5000, 0xabc))
    const wpe = weightedPermutationEntropy(v, 4, { normalize: true })
    expect(wpe).toBeGreaterThan(0)
    expect(wpe).toBeLessThanOrEqual(1)
  })
})
