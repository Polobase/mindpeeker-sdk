import { describe, expect, test } from 'bun:test'
import { FlowError } from '../src/errors.js'
import { effectiveTransferEntropy, permutationTest } from '../src/significance.js'
import { rotate } from '../src/surrogates.js'
import { transferEntropy } from '../src/transfer.js'
import { coupledPair, prngBits, prngSymbols } from './helpers/streams.js'

/** An ArrayLike that counts element reads — proves validation happens first. */
function readCounter(values: Int32Array): { input: ArrayLike<number>; reads: () => number } {
  let reads = 0
  const input = new Proxy(Array.from(values), {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && /^\d+$/.test(prop)) reads++
      return Reflect.get(target, prop, receiver)
    },
  })
  return { input, reads: () => reads }
}

function codeOf(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(FlowError)
    return (error as FlowError).code
  }
  throw new Error('expected a FlowError')
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
    expect(result.surrogate).toEqual({ method: 'shuffle', n: 99, seed: 1, exact: false })
  })

  test('independent streams → p not significant (seeded run)', () => {
    const x = prngBits(2048, 0x111)
    const y = prngBits(2048, 0x999)
    const result = permutationTest(x, y, { surrogates: 99, seed: 2 })
    expect(result.p).toBeGreaterThan(0.05)
  })

  test('p, mean, sd, z and distinct agree with a by-hand count of the ensemble', () => {
    const x = prngBits(256, 5)
    const y = prngBits(256, 6)
    const r = permutationTest(x, y, { surrogates: 49, seed: 3 })
    const values = Array.from(r.surrogates)
    const exceed = values.filter((v) => v >= r.te).length
    expect(r.p).toBe((1 + exceed) / 50)
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1))
    expect(r.mean).toBeCloseTo(mean, 14)
    expect(r.sd).toBeCloseTo(sd, 14)
    expect(r.z).toBeCloseTo((r.te - mean) / sd, 10)
    expect(r.distinct).toBe(new Set(values).size)
  })

  test('circularShift enumerates all n − 1 rotations exactly when n − 1 ≤ surrogates', () => {
    const { x, y } = coupledPair(40, 0.6, 0x77)
    const r = permutationTest(x, y, { surrogates: 199, surrogate: 'circularShift', seed: 5 })
    expect(r.surrogate.exact).toBe(true)
    expect(r.surrogate.n).toBe(39)
    expect(r.surrogates.length).toBe(39)
    const te = transferEntropy(x, y)
    let exceed = 0
    const distinct = new Set<number>()
    for (let offset = 1; offset < 40; offset++) {
      const value = transferEntropy(rotate(x, offset), y)
      expect(r.surrogates[offset - 1]).toBe(value)
      if (value >= te - 1e-12) exceed++
      distinct.add(Math.round(value * 1e9))
    }
    expect(r.p).toBe((1 + exceed) / 40)
    expect(r.distinct).toBe(distinct.size)
    expect(r.distinct).toBeLessThan(39)
    // the seed is irrelevant for an exact test
    const other = permutationTest(x, y, { surrogates: 39, surrogate: 'circularShift', seed: 99 })
    expect(other.surrogates).toEqual(r.surrogates)
  })

  test('every surrogate family exposes strong coupling and is deterministic', () => {
    const { x, y } = coupledPair(1024, 0.8, 0xdad)
    const families = [
      { surrogate: 'shuffle' },
      { surrogate: 'circularShift' },
      { surrogate: 'embeddingShuffle', l: 2 },
      { surrogate: 'blockShuffle', blockSize: 8 },
      { surrogate: 'stationaryBootstrap', meanBlockSize: 6 },
      { surrogate: 'markov', markovOrder: 2 },
    ] as const
    for (const family of families) {
      const opts = { surrogates: 39, seed: 4, ...family }
      const r = permutationTest(x, y, opts)
      expect(r.p).toBe(1 / 40)
      expect(r.surrogate.method).toBe(family.surrogate)
      expect(permutationTest(x, y, opts).surrogates).toEqual(r.surrogates)
    }
  })

  test('embeddingShuffle keeps within-vector structure: identical source tuples, permuted order', () => {
    // with l = 2, a source whose 2-vectors are all (1, 0)/(0, 1) alternations keeps
    // exactly that vector multiset under embeddingShuffle but not under shuffle
    const n = 400
    const x = Int32Array.from({ length: n }, (_, i) => i % 2)
    const y = prngBits(n, 9)
    const emb = permutationTest(x, y, { surrogates: 20, surrogate: 'embeddingShuffle', l: 2 })
    const raw = permutationTest(x, y, { surrogates: 20, surrogate: 'shuffle', l: 2 })
    expect(emb.distinct).toBeGreaterThan(1)
    // shuffling the raw series creates (0,0)/(1,1) vectors → different TE distribution
    expect(emb.mean).not.toBeCloseTo(raw.mean, 6)
  })

  test('shuffle null is calibrated: false-positive rate ≈ α on independent pairs', () => {
    let rejections = 0
    const reps = 300
    for (let rep = 0; rep < reps; rep++) {
      const x = prngBits(150, 1000 + rep)
      const y = prngBits(150, 5000 + rep)
      if (permutationTest(x, y, { surrogates: 19, seed: rep }).p <= 0.05) rejections++
    }
    expect(rejections / reps).toBeGreaterThan(0.015)
    expect(rejections / reps).toBeLessThan(0.1)
  })

  test('rejects an unknown surrogate method instead of silently rotating (regression)', () => {
    for (const surrogate of ['bogus', 'shuffled', 'circular', '']) {
      expect(
        codeOf(() => permutationTest([0, 1, 0, 1], [1, 0, 1, 0], { surrogate } as never)),
      ).toBe('invalid_input')
    }
  })

  test('validates every option before reading a single symbol', () => {
    const { input, reads } = readCounter(prngSymbols(5000, 2, 1))
    const dest = prngSymbols(5000, 2, 2)
    const bad = [
      { surrogates: 0 },
      { surrogates: 1.5 },
      { surrogate: 'nope' },
      { seed: -1 },
      { seed: 2 ** 53 },
      { blockSize: 4 }, // without surrogate: 'blockShuffle'
      { surrogate: 'blockShuffle', blockSize: 0 },
      { surrogate: 'stationaryBootstrap', meanBlockSize: 0.5 },
      { surrogate: 'markov', markovOrder: 0 },
      { k: 0 },
      { alphabet: -2 },
    ]
    for (const opts of bad) {
      expect(codeOf(() => permutationTest(input, dest, opts as never))).toBe('invalid_input')
    }
    expect(reads()).toBe(0)
  })

  test('millerMadow and alphabet are honoured for observed and surrogate TEs alike', () => {
    const { x, y } = coupledPair(300, 0.3, 0x31)
    const plain = permutationTest(x, y, { surrogates: 9, seed: 8 })
    const mm = permutationTest(x, y, { surrogates: 9, seed: 8, millerMadow: true })
    expect(mm.te).toBe(transferEntropy(x, y, { millerMadow: true }))
    expect(mm.surrogates).not.toEqual(plain.surrogates)
    const wide = permutationTest(x, y, { surrogates: 9, seed: 8, alphabet: 5 })
    expect(Array.from(wide.surrogates)).toEqual(Array.from(plain.surrogates))
  })
})

describe('effectiveTransferEntropy', () => {
  test('independent streams → ETE ≈ 0 (bias removed)', () => {
    const x = prngBits(4096, 0xc1c1)
    const y = prngBits(4096, 0xd2d2)
    const { te, shuffleMean, ete } = effectiveTransferEntropy(x, y, { surrogates: 20, seed: 9 })
    expect(te).toBeGreaterThanOrEqual(0)
    expect(shuffleMean).toBeGreaterThan(0) // the bias floor is real
    expect(Math.abs(ete)).toBeLessThan(0.005)
  })

  test('coupled pair → ETE retains nearly all of the TE', () => {
    const { x, y } = coupledPair(4096, 0.8, 0xe3e3)
    const result = effectiveTransferEntropy(x, y, { surrogates: 10, seed: 10 })
    expect(result.ete).toBeGreaterThan(0.2)
    expect(result.ete).toBeLessThan(result.te)
  })

  test('deterministic for a seed; shuffleMean is the shuffle permutation-test mean', () => {
    const { x, y } = coupledPair(512, 0.5, 0xf4f4)
    const a = effectiveTransferEntropy(x, y, { seed: 11 })
    const b = effectiveTransferEntropy(x, y, { seed: 11 })
    expect(a.ete).toBe(b.ete)
    expect(a.shuffleMean).toBe(permutationTest(x, y, { seed: 11, surrogates: 20 }).mean)
  })

  test('nShuffles is a deprecated alias of surrogates', () => {
    const { x, y } = coupledPair(256, 0.5, 0x1234)
    const alias = effectiveTransferEntropy(x, y, { nShuffles: 7, seed: 3 })
    expect(alias).toEqual(effectiveTransferEntropy(x, y, { surrogates: 7, seed: 3 }))
    expect(effectiveTransferEntropy(x, y, { surrogates: 7, nShuffles: 7, seed: 3 })).toEqual(alias)
    expect(codeOf(() => effectiveTransferEntropy(x, y, { surrogates: 7, nShuffles: 8 }))).toBe(
      'invalid_input',
    )
  })

  test('rejects a non-positive shuffle count', () => {
    expect(() => effectiveTransferEntropy([0, 1, 0], [1, 0, 1], { surrogates: 0 })).toThrow(
      FlowError,
    )
    expect(() => effectiveTransferEntropy([0, 1, 0], [1, 0, 1], { nShuffles: 0 })).toThrow(
      FlowError,
    )
  })
})
