import { describe, expect, test } from 'bun:test'
import { FlowError } from '../src/errors.js'
import { transferEntropyByLag } from '../src/lag-scan.js'
import { localTransferEntropy, transferEntropy } from '../src/transfer.js'
import { coupledPair, prngBits } from './helpers/streams.js'

function codeOf(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(FlowError)
    return (error as FlowError).code
  }
  throw new Error('expected a FlowError')
}

describe('transferEntropyByLag', () => {
  test('recovers the true interaction delay with a family-wise significant peak', () => {
    const { x, y } = coupledPair(3000, 0.7, 0x3a3a, 3)
    const r = transferEntropyByLag(x, y, { maxLag: 6, surrogates: 99, seed: 1 })
    expect(r.bestLag).toBe(3)
    expect(r.lags.map((entry) => entry.lag)).toEqual([1, 2, 3, 4, 5, 6])
    expect(r.p).toBe(1 / 100)
    expect(r.lags[2]?.significant).toBe(true)
    for (const entry of r.lags) if (entry.lag !== 3) expect(entry.significant).toBe(false)
    expect(r.te).toBeGreaterThan(r.threshold)
  })

  test('all lags share the tuple range valid at maxLag', () => {
    const { x, y } = coupledPair(500, 0.5, 0x77, 2)
    const r = transferEntropyByLag(x, y, { minLag: 2, maxLag: 4, l: 2, k: 1, surrogates: 9 })
    const first = Math.max(0, 4 + 2 - 2)
    expect(r.count).toBe(500 - 1 - first)
    // equal to transferEntropy on the trimmed series that starts every lag at the same t
    for (const entry of r.lags) {
      const shift = first - Math.max(0, entry.lag + 2 - 2)
      const xs = x.subarray(shift)
      const ys = y.subarray(shift)
      expect(localTransferEntropy(xs, ys, { lag: entry.lag, l: 2 }).count).toBe(r.count)
      expect(entry.te).toBe(transferEntropy(xs, ys, { lag: entry.lag, l: 2 }))
    }
  })

  test('p and threshold are consistent max-statistic quantities', () => {
    const x = prngBits(800, 0x10)
    const y = prngBits(800, 0x20)
    const r = transferEntropyByLag(x, y, { maxLag: 5, surrogates: 199, seed: 7 })
    expect(r.maxNull.length).toBe(199)
    const sorted = Array.from(r.maxNull).sort((a, b) => b - a)
    expect(r.threshold).toBe(sorted[Math.floor(0.05 * 200) - 1] as number)
    for (const entry of r.lags) {
      const exceed = sorted.filter((m) => m >= entry.te).length
      expect(entry.p).toBe((1 + exceed) / 200)
      expect(entry.significant).toBe(entry.p <= 0.05)
      expect(entry.significant).toBe(entry.te > r.threshold)
    }
    // the max null dominates each single-lag null: independent streams stay non-significant
    expect(r.lags.every((entry) => !entry.significant)).toBe(true)
  })

  test('too few surrogates for alpha → infinite threshold; exact rotations and embeddingShuffle work', () => {
    const { x, y } = coupledPair(60, 0.9, 0x5, 2)
    const few = transferEntropyByLag(x, y, { maxLag: 3, surrogates: 10 })
    expect(few.threshold).toBe(Number.POSITIVE_INFINITY)
    expect(few.lags.every((entry) => !entry.significant)).toBe(true)
    const exact = transferEntropyByLag(x, y, {
      maxLag: 3,
      surrogate: 'circularShift',
      surrogates: 100,
    })
    expect(exact.surrogate.exact).toBe(true)
    expect(exact.maxNull.length).toBe(59)
    const emb = transferEntropyByLag(x, y, {
      maxLag: 3,
      surrogate: 'embeddingShuffle',
      surrogates: 19,
    })
    expect(emb.bestLag).toBe(2)
    expect(emb).toEqual(
      transferEntropyByLag(x, y, { maxLag: 3, surrogate: 'embeddingShuffle', surrogates: 19 }),
    )
  })

  test('validates options before any estimate', () => {
    const x = prngBits(100, 1)
    const y = prngBits(100, 2)
    expect(codeOf(() => transferEntropyByLag(x, y, {} as never))).toBe('invalid_input')
    expect(codeOf(() => transferEntropyByLag(x, y, { maxLag: 0 }))).toBe('invalid_input')
    expect(codeOf(() => transferEntropyByLag(x, y, { minLag: 3, maxLag: 2 }))).toBe('invalid_input')
    expect(codeOf(() => transferEntropyByLag(x, y, { maxLag: 2, alpha: 1 }))).toBe('invalid_input')
    expect(codeOf(() => transferEntropyByLag(x, y, { maxLag: 2, surrogate: 'x' as never }))).toBe(
      'invalid_input',
    )
    expect(codeOf(() => transferEntropyByLag(x, y, { maxLag: 99 }))).toBe('insufficient_data')
  })
})
