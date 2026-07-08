import { describe, expect, test } from 'bun:test'
import { NegentropyError } from '../../src/errors.js'
import { toBits } from '../../src/estimators/entropy.js'
import { chiSquareBytes, monobit, runsTest } from '../../src/estimators/frequency.js'
import { toeplitzExtractor, toeplitzOutputBits } from '../../src/extract/toeplitz.js'
import { prngBytes, prngUniforms } from '../helpers/byte-sources.js'

/** Naive reference: build T explicitly, multiply over GF(2), pack MSB-first. */
function naiveToeplitz(seed: Uint8Array, n: number, m: number, input: Uint8Array): Uint8Array {
  const seedBits = toBits(seed)
  const inputBits = toBits(input)
  const out = new Uint8Array(Math.ceil(m / 8))
  for (let i = 0; i < m; i++) {
    let bit = 0
    for (let j = 0; j < n; j++) {
      bit ^= (seedBits[i - j + n - 1] as number) & (inputBits[j] as number)
    }
    if (bit) out[i >> 3] = (out[i >> 3] as number) | (1 << (7 - (i & 7)))
  }
  return out
}

function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = (a[i] as number) ^ (b[i] as number)
  return out
}

describe('toeplitzExtractor', () => {
  test('hand KAT: n=4, m=2, seed bits 10110, x=1011 → y=01', () => {
    // T[0] = [s3,s2,s1,s0] = [1,1,0,1]; T[1] = [s4,s3,s2,s1] = [0,1,1,0]
    // y0 = 1·1⊕1·0⊕0·1⊕1·1 = 0; y1 = 0·1⊕1·0⊕1·1⊕0·1 = 1
    const extractor = toeplitzExtractor(new Uint8Array([0b10110000]), 4, 2)
    expect(extractor.extract(new Uint8Array([0b10110000]))[0]).toBe(0b01000000)
  })

  test('word-optimized path ≡ naive boolean-matrix path on 200 random cases', () => {
    const dims = prngUniforms(400, 0x66)
    for (let round = 0; round < 200; round++) {
      const n = 4 + Math.floor((dims[2 * round] as number) * 500)
      const m = 1 + Math.floor((dims[2 * round + 1] as number) * (n - 1))
      const seed = prngBytes(Math.ceil((n + m - 1) / 8), 0x1000 + round)
      const input = prngBytes(Math.ceil(n / 8), 0x2000 + round)
      const fast = toeplitzExtractor(seed, n, m).extract(input)
      expect([...fast]).toEqual([...naiveToeplitz(seed, n, m, input)])
    }
  })

  test('is exactly linear: T(x⊕y) = T(x)⊕T(y), T(0) = 0', () => {
    const n = 256
    const m = 100
    const extractor = toeplitzExtractor(prngBytes(Math.ceil((n + m - 1) / 8), 0x77), n, m)
    const x = prngBytes(n / 8, 0x88)
    const y = prngBytes(n / 8, 0x99)
    expect([...extractor.extract(xorBytes(x, y))]).toEqual([
      ...xorBytes(extractor.extract(x), extractor.extract(y)),
    ])
    const zero = extractor.extract(new Uint8Array(n / 8))
    expect(zero.every((byte) => byte === 0)).toBe(true)
  })

  test('output bits are balanced over random seeds (XOR-universality)', () => {
    const n = 64
    const m = 8
    const x = prngBytes(8, 0xaa) // fixed nonzero input
    const rounds = 2000
    const ones = new Array<number>(m).fill(0)
    for (let round = 0; round < rounds; round++) {
      const out = toeplitzExtractor(
        prngBytes(Math.ceil((n + m - 1) / 8), 0x3000 + round),
        n,
        m,
      ).extract(x)
      for (let i = 0; i < m; i++)
        ones[i] = (ones[i] as number) + (((out[0] as number) >> (7 - i)) & 1)
    }
    for (const count of ones) {
      expect(Math.abs(count / rounds - 0.5)).toBeLessThan(4 * Math.sqrt(0.25 / rounds))
    }
  })

  test('end-to-end: biased 0.75 bits at m = k − 64 pass the classic tests', () => {
    const n = 40_000 // bits
    const uniforms = prngUniforms(n, 0xbb)
    const input = new Uint8Array(n / 8)
    for (let t = 0; t < n; t++) {
      if ((uniforms[t] as number) < 0.75)
        input[t >> 3] = (input[t >> 3] as number) | (1 << (7 - (t & 7)))
    }
    const k = Math.floor(n * -Math.log2(0.75)) // per-bit min-entropy 0.415
    const m = toeplitzOutputBits(k) // k − 64
    expect(m).toBe(k - 64)
    const seed = prngBytes(Math.ceil((n + m - 1) / 8), 0xcc)
    const outBits = toBits(toeplitzExtractor(seed, n, m).extract(input)).slice(0, m)
    expect(Math.abs(monobit(outBits).z)).toBeLessThan(4)
    expect(Math.abs(runsTest(outBits))).toBeLessThan(4)
    // byte-level histogram over whole bytes of output
    const wholeBytes = Math.floor(m / 8)
    expect(
      chiSquareBytes(toeplitzExtractor(seed, n, m).extract(input).slice(0, wholeBytes)).pValue,
    ).toBeGreaterThan(0.001)
  })

  test('validates parameters', () => {
    expect(() => toeplitzExtractor(new Uint8Array(1), 4, 4)).toThrow(NegentropyError) // m ≥ n
    expect(() => toeplitzExtractor(new Uint8Array(2), 4, 2)).toThrow(NegentropyError) // seed length
    expect(() =>
      toeplitzExtractor(new Uint8Array([0b10110000]), 4, 2).extract(new Uint8Array(2)),
    ).toThrow(NegentropyError) // input length
    expect(() => toeplitzOutputBits(100, 0)).toThrow(NegentropyError)
  })
})
