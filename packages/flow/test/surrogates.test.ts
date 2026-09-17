import { describe, expect, test } from 'bun:test'
import { FlowError } from '../src/errors.js'
import { randomInt, xorshift32, xoshiro128ss } from '../src/internal/prng.js'
import {
  blockShuffle,
  circularShift,
  markovSurrogate,
  sourceShuffle,
  stationaryBootstrap,
} from '../src/surrogates.js'
import { prngSymbols } from './helpers/streams.js'

function codeOf(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(FlowError)
    return (error as FlowError).code
  }
  throw new Error('expected a FlowError')
}

function sorted(values: ArrayLike<number>): number[] {
  return Array.from(values).sort((a, b) => a - b)
}

describe('xorshift32 (legacy)', () => {
  test('deterministic, in (0, 1), seed 0 remapped', () => {
    const a = xorshift32(42)
    const b = xorshift32(42)
    for (let i = 0; i < 100; i++) {
      const v = a()
      expect(v).toBe(b())
      expect(v).toBeGreaterThan(0)
      expect(v).toBeLessThan(1)
    }
    expect(xorshift32(0)()).toBe(xorshift32(1)())
  })

  test('rejects seeds that would silently alias another stream (regression)', () => {
    for (const seed of [2 ** 32, -1, 1.9, Number.NaN, 0.5]) {
      expect(codeOf(() => xorshift32(seed))).toBe('invalid_input')
    }
    expect(() => xorshift32(0xffff_ffff)).not.toThrow()
  })
})

describe('xoshiro128** seeded by SplitMix64', () => {
  test('matches an independent Python transcription of the reference algorithms', () => {
    // generated with a from-scratch Python splitmix64 + xoshiro128** (big-int
    // arithmetic); splitmix64(0) = 0xe220a8397b1dcdaf matches the published vector
    const vectors: Array<[number, number[]]> = [
      [0, [0.11944409199778216, 0.22652471303889565, 0.47561266169677097, 0.5733478212981162]],
      [1, [0.7076259556254523, 0.3845173458295277, 0.9241832368146093, 0.9710483508000549]],
      [42, [0.19226245292029043, 0.07223138646015692, 0.6959624109612975, 0.5729761558273553]],
      [
        0x9e3779b9,
        [0.23419198573861422, 0.9219967893808841, 0.0318750813997587, 0.7914716274151473],
      ],
      [
        2 ** 53 - 1,
        [0.5254896023095363, 0.4990934430564108, 0.19207147691664173, 0.09723352581297795],
      ],
    ]
    for (const [seed, expected] of vectors) {
      const rng = xoshiro128ss(seed)
      expect(expected.map(() => rng())).toEqual(expected)
    }
  })

  test('default seed is 0x9e3779b9; uniforms lie in [0, 1) with mean ≈ 1/2', () => {
    const a = xoshiro128ss()
    const b = xoshiro128ss(0x9e3779b9)
    let sum = 0
    for (let i = 0; i < 20_000; i++) {
      const v = a()
      expect(v).toBe(b())
      expect(v >= 0 && v < 1).toBe(true)
      sum += v
    }
    expect(Math.abs(sum / 20_000 - 0.5)).toBeLessThan(0.01)
  })

  test('seeds 0 and 1 (and 2^32) are distinct streams', () => {
    const first = [0, 1, 2 ** 32].map((seed) => xoshiro128ss(seed)())
    expect(new Set(first).size).toBe(3)
  })

  test('rejects non-integer, negative, or unsafe seeds', () => {
    for (const seed of [-1, 1.5, 2 ** 53, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(codeOf(() => xoshiro128ss(seed))).toBe('invalid_input')
    }
  })
})

describe('rng contract', () => {
  test('randomInt rejects generators returning 1, NaN, or negatives', () => {
    for (const bad of [1, Number.NaN, -0.1, 2]) {
      expect(codeOf(() => randomInt(() => bad, 4))).toBe('invalid_input')
    }
    expect(randomInt(() => 0.999_999_999_999, 3)).toBe(2)
  })

  test('surrogates never silently corrupt the multiset with a bad rng (regression)', () => {
    expect(codeOf(() => sourceShuffle([1, 2, 3, 4], () => 1))).toBe('invalid_input')
    expect(codeOf(() => sourceShuffle([1, 2, 3, 4], () => Number.NaN))).toBe('invalid_input')
  })
})

describe('sourceShuffle', () => {
  test('preserves the symbol multiset, never mutates the input', () => {
    const original = prngSymbols(500, 5, 0x5eed)
    const copy = Int32Array.from(original)
    const shuffled = sourceShuffle(original, xoshiro128ss(7))
    expect(original).toEqual(copy)
    expect(sorted(shuffled)).toEqual(sorted(original))
  })

  test('same seed → same shuffle, different seed → different shuffle', () => {
    const x = prngSymbols(200, 4, 0xabc)
    expect(sourceShuffle(x, xoshiro128ss(3))).toEqual(sourceShuffle(x, xoshiro128ss(3)))
    expect(sourceShuffle(x, xoshiro128ss(3))).not.toEqual(sourceShuffle(x, xoshiro128ss(4)))
  })

  test('all 24 permutations of 4 elements are roughly uniform', () => {
    const rng = xoshiro128ss(99)
    const counts = new Map<string, number>()
    const draws = 24_000
    for (let i = 0; i < draws; i++) {
      const key = sourceShuffle([0, 1, 2, 3], rng).join('')
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    expect(counts.size).toBe(24)
    let chi2 = 0
    for (const c of counts.values()) chi2 += (c - 1000) ** 2 / 1000
    expect(chi2).toBeLessThan(49.7) // χ²(23) 99.9th percentile
  })

  test('rejects non-symbol input', () => {
    expect(() => sourceShuffle([0.5, 1], xoshiro128ss(1))).toThrow(FlowError)
  })
})

describe('circularShift', () => {
  test('output is a nontrivial rotation of the input', () => {
    const x = Int32Array.from({ length: 64 }, (_, i) => i)
    const shifted = circularShift(x, xoshiro128ss(11))
    const offset = shifted[0] as number
    expect(offset).toBeGreaterThanOrEqual(1)
    for (let i = 0; i < x.length; i++) expect(shifted[i]).toBe((i + offset) % 64)
  })

  test('deterministic for a seed; short inputs pass through as copies', () => {
    const x = prngSymbols(100, 3, 0xdef)
    expect(circularShift(x, xoshiro128ss(5))).toEqual(circularShift(x, xoshiro128ss(5)))
    expect(circularShift([7], xoshiro128ss(5))).toEqual(Int32Array.from([7]))
  })
})

describe('blockShuffle', () => {
  test('permutes whole blocks: multiset kept, every block contiguous', () => {
    const n = 103
    const x = Int32Array.from({ length: n }, (_, i) => i)
    const out = blockShuffle(x, xoshiro128ss(5), { blockSize: 10 })
    expect(sorted(out)).toEqual(Array.from(x))
    // cut points: an index i where out[i] !== out[i−1] + 1 starts a block
    let starts = 1
    for (let i = 1; i < n; i++) if (out[i] !== (out[i - 1] as number) + 1) starts++
    expect(starts).toBeLessThanOrEqual(11)
    expect(out).not.toEqual(x)
  })

  test('blockSize 1 is a shuffle of single symbols; blockSize n is the identity', () => {
    const x = prngSymbols(50, 4, 3)
    expect(blockShuffle(x, xoshiro128ss(2), { blockSize: 50 })).toEqual(x)
    expect(sorted(blockShuffle(x, xoshiro128ss(2), { blockSize: 1 }))).toEqual(sorted(x))
  })

  test('default block length is ⌈n^(1/3)⌉ and options are validated', () => {
    const x = Int32Array.from({ length: 27 }, (_, i) => i)
    const out = blockShuffle(x, xoshiro128ss(8))
    for (let i = 0; i < 27; i += 3) {
      expect((out[i + 1] as number) - (out[i] as number)).toBe(1)
      expect((out[i + 2] as number) - (out[i] as number)).toBe(2)
    }
    for (const blockSize of [0, 1.5, 28]) {
      expect(codeOf(() => blockShuffle(x, xoshiro128ss(1), { blockSize }))).toBe('invalid_input')
    }
  })
})

describe('stationaryBootstrap', () => {
  test('resamples observed symbols with mean block length ≈ meanBlockSize', () => {
    const n = 20_000
    const x = Int32Array.from({ length: n }, (_, i) => i)
    const out = stationaryBootstrap(x, xoshiro128ss(12), { meanBlockSize: 8 })
    expect(out.length).toBe(n)
    let blocks = 1
    for (let i = 1; i < n; i++) if (out[i] !== ((out[i - 1] as number) + 1) % n) blocks++
    expect(n / blocks).toBeGreaterThan(7)
    expect(n / blocks).toBeLessThan(9)
  })

  test('meanBlockSize 1 restarts every position; values always come from the input', () => {
    const x = prngSymbols(300, 5, 17)
    const out = stationaryBootstrap(x, xoshiro128ss(1), { meanBlockSize: 1 })
    const allowed = new Set(Array.from(x))
    for (const v of out) expect(allowed.has(v)).toBe(true)
    expect(codeOf(() => stationaryBootstrap(x, xoshiro128ss(1), { meanBlockSize: 0.5 }))).toBe(
      'invalid_input',
    )
  })
})

describe('markovSurrogate', () => {
  test('uses only observed (circular) transitions', () => {
    const x = prngSymbols(400, 4, 0x42)
    const seen = new Set<string>()
    for (let t = 0; t < x.length; t++) seen.add(`${x[t]}>${x[(t + 1) % x.length]}`)
    const out = markovSurrogate(x, xoshiro128ss(3))
    for (let t = 0; t + 1 < out.length; t++) expect(seen.has(`${out[t]}>${out[t + 1]}`)).toBe(true)
  })

  test('a deterministic cycle reproduces a rotation of the cycle', () => {
    const x = Int32Array.from({ length: 30 }, (_, i) => i % 3)
    const out = markovSurrogate(x, xoshiro128ss(9))
    for (let t = 1; t < out.length; t++) expect(out[t]).toBe(((out[t - 1] as number) + 1) % 3)
  })

  test('order-2 contexts are respected and transition frequencies are preserved in distribution', () => {
    // sticky binary chain: P(stay) = 0.9
    const rng = xoshiro128ss(77)
    const n = 20_000
    const x = new Int32Array(n)
    for (let t = 1; t < n; t++) x[t] = rng() < 0.9 ? (x[t - 1] as number) : 1 - (x[t - 1] as number)
    const out = markovSurrogate(x, xoshiro128ss(4), { order: 1 })
    let stays = 0
    for (let t = 1; t < n; t++) if (out[t] === out[t - 1]) stays++
    expect(stays / (n - 1)).toBeCloseTo(0.9, 1)
    const out2 = markovSurrogate(
      Int32Array.from({ length: 39 }, (_, i) => [0, 0, 1][i % 3] as number),
      xoshiro128ss(2),
      {
        order: 2,
      },
    )
    for (let t = 2; t < out2.length; t++) {
      const ctx = `${out2[t - 2]}${out2[t - 1]}`
      expect(out2[t]).toBe(ctx === '00' ? 1 : 0)
    }
    expect(codeOf(() => markovSurrogate(x, xoshiro128ss(1), { order: 0 }))).toBe('invalid_input')
  })
})
