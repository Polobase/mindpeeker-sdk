import { describe, expect, test } from 'bun:test'
import { FlowError } from '../src/errors.js'
import { effectiveTransferEntropy, permutationTest } from '../src/significance.js'
import { prngBits, prngUniforms } from './helpers/streams.js'

/** y copies x's previous bit with probability `coupling`, else iid. */
function coupledPair(n: number, coupling: number, seed: number): { x: Int32Array; y: Int32Array } {
  const x = prngBits(n, seed)
  const u = prngUniforms(2 * n, seed ^ 0x5f5f5f5f)
  const y = new Int32Array(n)
  for (let t = 1; t < n; t++) {
    y[t] =
      (u[2 * t] as number) < coupling
        ? (x[t - 1] as number)
        : (u[2 * t + 1] as number) < 0.5
          ? 0
          : 1
  }
  return { x, y }
}

describe('permutationTest', () => {
  test('coupled pair → minimum attainable p; result is reproducible', () => {
    const { x, y } = coupledPair(2048, 0.8, 0xace)
    const result = permutationTest(x, y, { surrogates: 99, seed: 1 })
    expect(result.p).toBe(1 / 100) // te exceeds every surrogate
    expect(result.surrogates.length).toBe(99)
    for (const s of result.surrogates) expect(s).toBeLessThan(result.te)
    const again = permutationTest(x, y, { surrogates: 99, seed: 1 })
    expect(again.te).toBe(result.te)
    expect(again.surrogates).toEqual(result.surrogates)
    expect(again.p).toBe(result.p)
  })

  test('independent streams → p not significant (seeded run)', () => {
    const x = prngBits(2048, 0x111)
    const y = prngBits(2048, 0x999)
    const result = permutationTest(x, y, { surrogates: 99, seed: 2 })
    expect(result.p).toBeGreaterThan(0.05)
  })

  test('add-one correction: p is never 0 and never above 1', () => {
    const { x, y } = coupledPair(1024, 0.9, 0xb0b)
    const strong = permutationTest(x, y, { surrogates: 19, seed: 3 })
    expect(strong.p).toBeGreaterThanOrEqual(1 / 20)
    const weak = permutationTest(prngBits(256, 5), prngBits(256, 6), { surrogates: 19, seed: 3 })
    expect(weak.p).toBeLessThanOrEqual(1)
  })

  test('circularShift surrogates also expose strong coupling', () => {
    const { x, y } = coupledPair(2048, 0.8, 0xdad)
    const result = permutationTest(x, y, { surrogates: 99, seed: 4, surrogate: 'circularShift' })
    expect(result.p).toBe(1 / 100)
  })

  test('rejects a non-positive surrogate count', () => {
    expect(() => permutationTest([0, 1, 0, 1], [1, 0, 1, 0], { surrogates: 0 })).toThrow(FlowError)
  })
})

describe('effectiveTransferEntropy', () => {
  test('independent streams → ETE ≈ 0 (bias removed)', () => {
    const x = prngBits(4096, 0xc1c1)
    const y = prngBits(4096, 0xd2d2)
    const { te, shuffleMean, ete } = effectiveTransferEntropy(x, y, { nShuffles: 20, seed: 9 })
    expect(te).toBeGreaterThanOrEqual(0)
    expect(shuffleMean).toBeGreaterThan(0) // the bias floor is real
    expect(Math.abs(ete)).toBeLessThan(0.005)
  })

  test('coupled pair → ETE retains nearly all of the TE', () => {
    const { x, y } = coupledPair(4096, 0.8, 0xe3e3)
    const result = effectiveTransferEntropy(x, y, { nShuffles: 10, seed: 10 })
    expect(result.ete).toBeGreaterThan(0.2)
    expect(result.ete).toBeLessThan(result.te)
  })

  test('deterministic for a seed', () => {
    const { x, y } = coupledPair(512, 0.5, 0xf4f4)
    const a = effectiveTransferEntropy(x, y, { seed: 11 })
    const b = effectiveTransferEntropy(x, y, { seed: 11 })
    expect(a.ete).toBe(b.ete)
  })

  test('rejects a non-positive shuffle count', () => {
    expect(() => effectiveTransferEntropy([0, 1, 0], [1, 0, 1], { nShuffles: 0 })).toThrow(
      FlowError,
    )
  })
})
