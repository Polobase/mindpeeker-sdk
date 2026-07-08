import { describe, expect, test } from 'bun:test'
import { NegentropyError } from '../../src/errors.js'
import { monobit, runsTest } from '../../src/estimators/frequency.js'
import { peres, peresRate, vonNeumann } from '../../src/extract/debias.js'
import { prngUniforms } from '../helpers/byte-sources.js'

/** Bernoulli(p) bit stream from seeded uniforms. */
function biasedBits(n: number, p: number, seed: number): number[] {
  const uniforms = prngUniforms(n, seed)
  const out = new Array<number>(n)
  for (let i = 0; i < n; i++) out[i] = (uniforms[i] as number) < p ? 1 : 0
  return out
}

describe('vonNeumann', () => {
  test('known answer: pairs 01→0, 10→1, equal discarded', () => {
    expect(vonNeumann([0, 1, 1, 0, 0, 0, 1, 1])).toEqual([0, 1])
    expect(vonNeumann([1, 1, 1, 1])).toEqual([])
    expect(vonNeumann([1, 0, 1])).toEqual([1]) // trailing bit dropped
  })
})

describe('peres', () => {
  test('hand-traced 16-bit known answer (frozen concatenation order L ++ P(U) ++ P(V))', () => {
    // input 1100101101110010 → pairs (1,1)(0,0)(1,0)(1,1)(0,1)(1,1)(0,0)(1,0)
    // L=[1,0,1]; U=[0,0,1,0,1,0,0,1] → P(U)=[1,1,0,0,1]; V=[1,0,1,1,0] → P(V)=[1,1]
    const input = [1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 0, 1, 0]
    expect(peres(input)).toEqual([1, 0, 1, 1, 1, 0, 0, 1, 1, 1])
  })

  test('depth 1 equals von Neumann', () => {
    const bits = biasedBits(2000, 0.7, 0x11)
    expect(peres(bits, 1)).toEqual(vonNeumann(bits))
  })

  test('EXHAUSTIVE exactness: conditional on output length, all outputs equiprobable', () => {
    // The finite-sample unbiasedness/independence guarantee, verified exactly
    // over every input, for both debiasers, at fair and biased p.
    for (const debias of [peres, vonNeumann]) {
      for (const n of [8, 12]) {
        for (const p of [0.5, 0.3]) {
          const groups = new Map<number, Map<string, number>>()
          for (let mask = 0; mask < 1 << n; mask++) {
            const bits: number[] = []
            let ones = 0
            for (let b = 0; b < n; b++) {
              const bit = (mask >> b) & 1
              bits.push(bit)
              ones += bit
            }
            const probability = p ** ones * (1 - p) ** (n - ones)
            const out = debias(bits)
            const byLength = groups.get(out.length) ?? new Map<string, number>()
            const key = out.join('')
            byLength.set(key, (byLength.get(key) ?? 0) + probability)
            groups.set(out.length, byLength)
          }
          for (const [length, byValue] of groups) {
            if (length === 0) continue
            expect(byValue.size).toBe(2 ** length) // every output string attainable
            const probabilities = [...byValue.values()]
            const first = probabilities[0] as number
            for (const value of probabilities) {
              expect(Math.abs(value - first)).toBeLessThan(1e-12)
            }
          }
        }
      }
    }
  })

  test('output of a heavily biased source passes monobit and runs', () => {
    const out = peres(biasedBits(1_000_000, 0.75, 0x22))
    const bits = Uint8Array.from(out)
    expect(Math.abs(monobit(bits).z)).toBeLessThan(4)
    expect(Math.abs(runsTest(bits))).toBeLessThan(4)
  })

  test('yield beats von Neumann and lands between the depth-8 rate and H(p)', () => {
    const entropy = (p: number) => -p * Math.log2(p) - (1 - p) * Math.log2(1 - p)
    for (const p of [0.5, 0.7, 0.9]) {
      const n = 1_000_000
      const bits = biasedBits(n, p, 0x33 + Math.round(p * 100))
      const peresLength = peres(bits).length
      const vnLength = vonNeumann(bits).length
      expect(peresLength).toBeGreaterThan(vnLength)
      // effective depth on finite input is ~log₂n with fragmentation losses:
      // above the depth-8 rate, at or below the entropy ceiling
      expect(peresLength / n).toBeGreaterThan(peresRate(p, 8) - 0.01)
      expect(peresLength / n).toBeLessThanOrEqual(entropy(p) + 1e-9)
    }
  })
})

describe('peresRate', () => {
  test('exact values at p = ½: ¼, 7/16, 37/64', () => {
    expect(peresRate(0.5, 1)).toBeCloseTo(1 / 4, 14)
    expect(peresRate(0.5, 2)).toBeCloseTo(7 / 16, 14)
    expect(peresRate(0.5, 3)).toBeCloseTo(37 / 64, 14)
  })

  test('is monotone in depth and approaches H(p)', () => {
    const entropy = (p: number) => -p * Math.log2(p) - (1 - p) * Math.log2(1 - p)
    for (const p of [0.5, 0.7, 0.9]) {
      let previous = 0
      for (let depth = 1; depth <= 10; depth++) {
        const rate = peresRate(p, depth)
        expect(rate).toBeGreaterThan(previous)
        expect(rate).toBeLessThanOrEqual(entropy(p) + 1e-12)
        previous = rate
      }
      expect(entropy(p) - peresRate(p, 18)).toBeLessThan(0.02)
    }
  })

  test('rejects bad parameters', () => {
    expect(() => peresRate(0, 3)).toThrow(NegentropyError)
    expect(() => peresRate(0.5, -1)).toThrow(NegentropyError)
    expect(() => peres([1, 0], 0)).toThrow(NegentropyError)
  })
})
