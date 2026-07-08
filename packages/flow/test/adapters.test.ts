import { describe, expect, test } from 'bun:test'
import { equalWidthBins, ordinalPatterns, quantileBins, symbolsFromBytes } from '../src/adapters.js'
import { shannonEntropy } from '../src/entropy.js'
import { FlowError } from '../src/errors.js'
import { prngUniforms } from './helpers/streams.js'

describe('symbolsFromBytes', () => {
  test('alphabet 2 expands MSB-first', () => {
    expect(Array.from(symbolsFromBytes(Uint8Array.of(0b1011_0000), { alphabet: 2 }))).toEqual([
      1, 0, 1, 1, 0, 0, 0, 0,
    ])
    expect(Array.from(symbolsFromBytes(Uint8Array.of(0x01, 0x80), { alphabet: 2 }))).toEqual([
      0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0,
    ])
  })

  test('rejects an alphabet other than 2 or 256 at runtime (regression)', () => {
    for (const alphabet of [4, 16, 0, 3]) {
      expect(() => symbolsFromBytes(Uint8Array.of(0xb0), { alphabet } as never)).toThrow(FlowError)
    }
  })

  test('default alphabet 256 copies bytes without aliasing', () => {
    const bytes = Uint8Array.of(3, 255, 0)
    const symbols = symbolsFromBytes(bytes)
    expect(Array.from(symbols)).toEqual([3, 255, 0])
    symbols[0] = 9
    expect(bytes[0]).toBe(3)
  })
})

describe('quantileBins', () => {
  test('equal counts per bin when n divides evenly', () => {
    const values = [9.5, 1.2, 7.7, 0.1, 3.3, 8.8, 2.2, 5.5]
    const bins = quantileBins(values, 4)
    const counts = [0, 0, 0, 0]
    for (const b of bins) counts[b] = (counts[b] as number) + 1
    expect(counts).toEqual([2, 2, 2, 2])
    // smallest two values land in bin 0, largest two in bin 3
    expect(bins[3]).toBe(0)
    expect(bins[1]).toBe(0)
    expect(bins[0]).toBe(3)
    expect(bins[5]).toBe(3)
  })

  test('binning is deterministic under ties (stable by index)', () => {
    const a = quantileBins([1, 1, 1, 1], 2)
    expect(Array.from(a)).toEqual([0, 0, 1, 1])
  })

  test('quantile bins maximize marginal entropy vs equal-width on skewed data', () => {
    const skewed = Array.from(prngUniforms(1000, 0xfade), (u) => -Math.log(u)) // exponential
    const hQuantile = shannonEntropy(quantileBins(skewed, 8))
    const hWidth = shannonEntropy(equalWidthBins(skewed, 8))
    expect(hQuantile).toBeGreaterThan(hWidth)
    expect(hQuantile).toBeCloseTo(3, 2)
  })

  test('rejects bad input', () => {
    expect(() => quantileBins([], 2)).toThrow(FlowError)
    expect(() => quantileBins([1, 2], 1)).toThrow(FlowError)
    expect(() => quantileBins([1, Number.NaN], 2)).toThrow(FlowError)
  })
})

describe('equalWidthBins', () => {
  test('splits the observed range evenly and clamps the maximum', () => {
    expect(Array.from(equalWidthBins([0, 1, 2, 3], 2))).toEqual([0, 0, 1, 1])
    expect(Array.from(equalWidthBins([0, 0.49, 0.51, 1], 2))).toEqual([0, 0, 1, 1])
    expect(Array.from(equalWidthBins([0, 10], 4))).toEqual([0, 3]) // max lands in the last bin
  })

  test('constant input maps to all zeros', () => {
    expect(Array.from(equalWidthBins([5, 5, 5], 3))).toEqual([0, 0, 0])
  })

  test('rejects non-finite values', () => {
    expect(() => equalWidthBins([0, Number.POSITIVE_INFINITY], 2)).toThrow(FlowError)
  })
})

describe('ordinalPatterns', () => {
  test('order 2: ascending → 0, descending → 1 (Bandt–Pompe example series)', () => {
    // Bandt & Pompe (2002) example: x = (4, 7, 9, 10, 6, 11, 3)
    const symbols = ordinalPatterns([4, 7, 9, 10, 6, 11, 3], 2)
    expect(Array.from(symbols)).toEqual([0, 0, 0, 1, 0, 1])
  })

  test('order 3 enumerates all six patterns with distinct symbols', () => {
    const windows = [
      [1, 2, 3], // 012
      [1, 3, 2], // 021
      [2, 1, 3], // 102
      [3, 1, 2], // 120
      [2, 3, 1], // 201
      [3, 2, 1], // 210
    ]
    const symbols = windows.map((w) => ordinalPatterns(w, 3)[0] as number)
    expect(new Set(symbols).size).toBe(6)
    for (const s of symbols) {
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThan(6)
    }
    expect(ordinalPatterns([1, 2, 3], 3)[0]).toBe(0) // identity permutation → code 0
    expect(ordinalPatterns([3, 2, 1], 3)[0]).toBe(5) // full reversal → code m! − 1
  })

  test('ties break by temporal order (stable)', () => {
    expect(ordinalPatterns([1, 1], 2)[0]).toBe(0) // treated as ascending
    expect(ordinalPatterns([2, 2, 1], 3)[0]).toBe(ordinalPatterns([2, 3, 1], 3)[0] as number)
  })

  test('delay stretches the embedding', () => {
    // with delay 2 the windows are (x0, x2), (x1, x3), ...
    const symbols = ordinalPatterns([0, 9, 1, 8, 2], 2, { delay: 2 })
    expect(Array.from(symbols)).toEqual([0, 1, 0])
  })

  test('output length is n − (order − 1)·delay', () => {
    expect(ordinalPatterns(prngUniforms(100, 0x123), 3, { delay: 4 }).length).toBe(92)
  })

  test('rejects bad orders, delays, and short inputs', () => {
    expect(() => ordinalPatterns([1, 2, 3], 1)).toThrow(FlowError)
    expect(() => ordinalPatterns([1, 2, 3], 2, { delay: 0 })).toThrow(FlowError)
    try {
      ordinalPatterns(prngUniforms(100, 1), 13)
      expect.unreachable()
    } catch (error) {
      expect((error as FlowError).code).toBe('alphabet_overflow')
    }
    try {
      ordinalPatterns([1, 2], 3)
      expect.unreachable()
    } catch (error) {
      expect((error as FlowError).code).toBe('insufficient_data')
    }
  })
})
