import { describe, expect, test } from 'bun:test'
import { ordinalPatterns } from '../src/adapters.js'
import { chiSquareTest } from '../src/chi-square.js'
import { FlowError } from '../src/errors.js'
import { transferEntropyReport } from '../src/report.js'
import { permutationTest } from '../src/significance.js'
import { entropyRate } from '../src/storage.js'
import { symbolicTransferEntropy } from '../src/symbolic.js'
import { transferEntropy } from '../src/transfer.js'
import { coupledPair, prngBits, prngUniforms } from './helpers/streams.js'

describe('transferEntropyReport', () => {
  test('fields agree with permutationTest, chiSquareTest and the entropy rate', () => {
    const { x, y } = coupledPair(1500, 0.3, 0xabc)
    const opts = { k: 2, surrogates: 49, seed: 5, surrogate: 'blockShuffle', blockSize: 5 } as const
    const report = transferEntropyReport(x, y, opts)
    const perm = permutationTest(x, y, opts)
    const chi = chiSquareTest(x, y, { k: 2 })
    expect(report.te).toBe(perm.te)
    expect(report.p).toBe(perm.p)
    expect(report.z).toBe(perm.z)
    expect(report.surrogateMean).toBe(perm.mean)
    expect(report.surrogateSd).toBe(perm.sd)
    expect(report.distinct).toBe(perm.distinct)
    expect(report.ete).toBe(perm.te - perm.mean)
    expect(report.pChiSquare).toBe(chi.p)
    expect(report.statistic).toBe(chi.statistic)
    expect(report.df).toBe(chi.df)
    expect(report.count).toBe(chi.count)
    expect(report.cells).toBe(chi.cells)
    expect(report.occupiedCells).toBe(chi.occupiedCells)
    expect(report.adequate).toBe(chi.adequate)
    expect(report.embedding).toEqual({ k: 2, l: 1, lag: 1 })
    expect(report.millerMadow).toBe(false)
    expect(report.surrogate).toEqual(perm.surrogate)
    // H(Y+ | Y^(2)) over the TE tuples = entropy rate of y with k = 2 (same tuple range)
    expect(report.destEntropyRate).toBeCloseTo(entropyRate(y, { k: 2 }), 14)
    expect(report.nte).toBeCloseTo(report.ete / report.destEntropyRate, 14)
    expect(report.p).toBe(1 / 50)
    expect(report.pChiSquare).toBeLessThan(1e-10)
  })

  test('nte of a noiseless delayed copy ≈ 1; independent streams give nte ≈ 0', () => {
    const x = prngBits(4000, 3)
    const y = new Int32Array(4000)
    for (let t = 1; t < 4000; t++) y[t] = x[t - 1] as number
    expect(transferEntropyReport(x, y, { surrogates: 19 }).nte).toBeGreaterThan(0.99)
    const independent = transferEntropyReport(prngBits(4000, 4), prngBits(4000, 5), {
      surrogates: 19,
    })
    expect(Math.abs(independent.nte)).toBeLessThan(0.01)
    expect(independent.adequate).toBe(true)
  })

  test('constant destination: zero conditional entropy → nte 0, not NaN', () => {
    const r = transferEntropyReport(prngBits(200, 1), new Int32Array(200), { surrogates: 9 })
    expect(r.destEntropyRate).toBe(0)
    expect(r.nte).toBe(0)
  })

  test('millerMadow applies to te/p but χ² stays on the plug-in estimate', () => {
    const { x, y } = coupledPair(800, 0.2, 0x99)
    const r = transferEntropyReport(x, y, { millerMadow: true, surrogates: 9 })
    expect(r.te).toBe(transferEntropy(x, y, { millerMadow: true }))
    expect(r.statistic).toBe(chiSquareTest(x, y).statistic)
    expect(r.millerMadow).toBe(true)
  })

  test('validates minSamplesPerCell before running surrogates', () => {
    expect(() =>
      transferEntropyReport([0, 1, 0, 1], [1, 0, 1, 0], { minSamplesPerCell: -3 }),
    ).toThrow(FlowError)
  })
})

describe('symbolicTransferEntropy', () => {
  test('equals transferEntropy on the aligned ordinal-pattern streams with alphabet m!', () => {
    const n = 2000
    const u = prngUniforms(n, 0x5150)
    const x = Array.from(u)
    const y = new Array<number>(n).fill(0)
    for (let t = 1; t < n; t++) y[t] = 0.6 * (x[t - 1] as number) + 0.4 * (u[(t * 7) % n] as number)
    for (const [order, delay, k] of [
      [3, 1, 1],
      [4, 2, 2],
    ] as const) {
      const expected = transferEntropy(
        ordinalPatterns(x, order, { delay }),
        ordinalPatterns(y, order, { delay }),
        { k, alphabet: order === 3 ? 6 : 24 },
      )
      expect(symbolicTransferEntropy(x, y, { order, delay, k })).toBe(expected)
    }
    expect(symbolicTransferEntropy(x, y, { order: 3 })).toBeGreaterThan(
      symbolicTransferEntropy(y, x, { order: 3 }),
    )
  })

  test('validates order, alignment and finiteness', () => {
    const x = Array.from(prngUniforms(100, 1))
    for (const call of [
      () => symbolicTransferEntropy(x, x, {} as never),
      () => symbolicTransferEntropy(x, x.slice(1), { order: 3 }),
      () => symbolicTransferEntropy(x, x, { order: 1 }),
      () => symbolicTransferEntropy([...x.slice(1), Number.NaN], x, { order: 3 }),
    ]) {
      expect(call).toThrow(FlowError)
    }
    try {
      symbolicTransferEntropy(x, x, { order: 13 })
      expect.unreachable()
    } catch (error) {
      expect((error as FlowError).code).toBe('alphabet_overflow')
    }
  })
})
