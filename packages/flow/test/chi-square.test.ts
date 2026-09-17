import { describe, expect, test } from 'bun:test'
import { chiSquareTest } from '../src/chi-square.js'
import { FlowError } from '../src/errors.js'
import { transferEntropy } from '../src/transfer.js'
import { balancedShiftPair, coupledPair, prngSymbols } from './helpers/streams.js'

/**
 * Independent χ² survival for EVEN df (the only kind TE produces, since
 * (A_Y − 1)·A_Y^k is always even): the Poisson-sum closed form
 * Q(m, x/2) = e^{−x/2} Σ_{j<m} (x/2)^j / j!, m = df/2, summed in log space.
 */
function chi2SfEvenDf(x: number, df: number): number {
  const m = df / 2
  const half = x / 2
  let logTerm = -half
  let sum = Math.exp(logTerm)
  for (let j = 1; j < m; j++) {
    logTerm += Math.log(half) - Math.log(j)
    sum += Math.exp(logTerm)
  }
  return Math.min(1, sum)
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

describe('chiSquareTest', () => {
  test('binary k = l = 1: df = 2 and p = exp(−G/2) = 2^(−N·TE) exactly', () => {
    const { x, y } = coupledPair(400, 0.1, 0x51)
    const r = chiSquareTest(x, y)
    expect(r.df).toBe(2)
    expect(r.count).toBe(399)
    expect(r.te).toBe(transferEntropy(x, y))
    expect(r.statistic).toBe(2 * 399 * Math.LN2 * r.te)
    expect(r.p).toBeCloseTo(2 ** (-399 * r.te), 13)
    expect(r.cells).toBe(8)
    expect(r.occupiedCells).toBe(8)
    expect(r.adequate).toBe(true)
  })

  test('df = (A_Y − 1)·A_Y^k·(A_X^l − 1) and p matches the Poisson-sum closed form', () => {
    const cases = [
      { A: 2, k: 2, l: 1, df: 4, cells: 16 },
      { A: 2, k: 1, l: 2, df: 6, cells: 16 },
      { A: 3, k: 1, l: 1, df: 12, cells: 27 },
      { A: 4, k: 1, l: 1, df: 36, cells: 64 },
      { A: 3, k: 2, l: 2, df: 144, cells: 243 },
    ]
    for (const [i, c] of cases.entries()) {
      const x = prngSymbols(3000, c.A, 11 + i)
      const y = prngSymbols(3000, c.A, 101 + i)
      const r = chiSquareTest(x, y, { k: c.k, l: c.l })
      expect(r.df).toBe(c.df)
      expect(r.cells).toBe(c.cells)
      const reference = chi2SfEvenDf(r.statistic, r.df)
      expect(Math.abs(r.p - reference)).toBeLessThan(1e-12 * Math.max(1, reference))
    }
  })

  test('different stream alphabets enter df separately; explicit alphabet overrides inference', () => {
    const x = prngSymbols(2000, 2, 5) // A_X = 2
    const y = prngSymbols(2000, 4, 6) // A_Y = 4
    expect(chiSquareTest(x, y).df).toBe(3 * 4 * 1)
    expect(chiSquareTest(y, x).df).toBe(1 * 2 * 3)
    expect(chiSquareTest(x, y, { alphabet: 4 }).df).toBe(3 * 4 * 3)
  })

  test('calibrated where adequate: FPR ≈ 0.05 for binary k = l = 1 at N = 500', () => {
    let rejections = 0
    let meanStatistic = 0
    const reps = 1000
    for (let r = 0; r < reps; r++) {
      const t = chiSquareTest(
        prngSymbols(500, 2, 1 + r * 7919),
        prngSymbols(500, 2, 99_991 + r * 104_729),
      )
      if (t.p <= 0.05) rejections++
      meanStatistic += t.statistic / reps
    }
    expect(rejections / reps).toBeGreaterThan(0.03)
    expect(rejections / reps).toBeLessThan(0.08)
    expect(meanStatistic).toBeGreaterThan(1.8) // E[G] ≈ df = 2
    expect(meanStatistic).toBeLessThan(2.4)
  })

  test('undersampled regime is flagged: A = 4, k = 2, l = 1, N = 500 is not adequate (and anti-conservative)', () => {
    let rejections = 0
    const reps = 100
    for (let r = 0; r < reps; r++) {
      const t = chiSquareTest(
        prngSymbols(500, 4, 3 + r * 7919),
        prngSymbols(500, 4, 7 + r * 104_729),
        {
          k: 2,
        },
      )
      expect(t.adequate).toBe(false)
      expect(t.cells).toBe(256)
      if (t.p <= 0.05) rejections++
    }
    expect(rejections / reps).toBeGreaterThan(0.3)
    const mid = chiSquareTest(prngSymbols(2000, 4, 1), prngSymbols(2000, 4, 2), { k: 2 })
    expect(mid.adequate).toBe(false) // 1998 < 10 · 256
    const looser = { k: 2, minSamplesPerCell: 5 }
    expect(chiSquareTest(prngSymbols(2000, 4, 1), prngSymbols(2000, 4, 2), looser).adequate).toBe(
      true,
    )
    expect(chiSquareTest(prngSymbols(5000, 4, 1), prngSymbols(5000, 4, 2), { k: 2 }).adequate).toBe(
      true,
    )
  })

  test('strong coupling → tiny p; degenerate df = 0 (constant source) → p = 1', () => {
    const { x, y } = balancedShiftPair(64)
    const r = chiSquareTest(x, y)
    expect(r.te).toBe(1)
    expect(r.p).toBeLessThan(1e-50)
    const constant = new Int32Array(200)
    const c = chiSquareTest(constant, prngSymbols(200, 2, 3))
    expect(c.df).toBe(0)
    expect(c.p).toBe(1)
  })

  test('validates options and rejects millerMadow', () => {
    const x = prngSymbols(100, 2, 1)
    const y = prngSymbols(100, 2, 2)
    expect(codeOf(() => chiSquareTest(x, y, { minSamplesPerCell: -1 }))).toBe('invalid_input')
    expect(codeOf(() => chiSquareTest(x, y, { minSamplesPerCell: Number.NaN }))).toBe(
      'invalid_input',
    )
    expect(codeOf(() => chiSquareTest(x, y, { millerMadow: true } as never))).toBe('invalid_input')
    expect(codeOf(() => chiSquareTest(x, y, { k: 0 }))).toBe('invalid_input')
    expect(codeOf(() => chiSquareTest([0, 1], [1, 0]))).toBe('insufficient_data')
  })
})
