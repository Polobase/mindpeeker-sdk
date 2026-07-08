import { describe, expect, test } from 'bun:test'
import {
  markovMinEntropyPerBit,
  mcvMinEntropy,
  shannonEntropy,
  toBits,
} from '../../src/estimators/entropy.js'
import { prngBytes } from '../helpers/byte-sources.js'

// Regression baseline: these cases mirror the original suite in
// packages/entropy/test/scripts/stats.test.ts — the estimators were lifted
// from there and must not drift.

describe('shannonEntropy', () => {
  test('is 0 for constant data and ~8 for uniform data', () => {
    expect(shannonEntropy(new Uint8Array(4096).fill(7))).toBe(0)
    expect(shannonEntropy(prngBytes(262_144))).toBeGreaterThan(7.99)
  })

  test('is exactly 1 for a two-symbol balanced stream', () => {
    const data = new Uint8Array(4096)
    for (let i = 0; i < data.length; i++) data[i] = i % 2 ? 255 : 0
    expect(shannonEntropy(data)).toBeCloseTo(1, 5)
  })
})

describe('mcvMinEntropy', () => {
  test('is ~0 for constant data and near 8 for uniform data', () => {
    expect(mcvMinEntropy(new Uint8Array(4096).fill(9))).toBeLessThan(0.01)
    expect(mcvMinEntropy(prngBytes(1_048_576))).toBeGreaterThan(7.8)
  })

  test('reflects a dominant symbol', () => {
    // 50% zeros, rest uniform → p_max ≈ 0.5 → H ≈ 1 bit
    const data = prngBytes(65_536)
    for (let i = 0; i < data.length; i += 2) data[i] = 0
    const h = mcvMinEntropy(data)
    expect(h).toBeGreaterThan(0.8)
    expect(h).toBeLessThan(1.1)
  })
})

describe('markovMinEntropyPerBit', () => {
  test('scores alternating bits ~0 despite perfect per-symbol balance', () => {
    const bits = new Uint8Array(65_536)
    for (let i = 0; i < bits.length; i++) bits[i] = i % 2
    expect(markovMinEntropyPerBit(bits)).toBeLessThan(0.01)
  })

  test('scores constant bits 0', () => {
    expect(markovMinEntropyPerBit(new Uint8Array(4096).fill(1))).toBe(0)
  })

  test('scores uniform bits near 1', () => {
    expect(markovMinEntropyPerBit(toBits(prngBytes(131_072)))).toBeGreaterThan(0.95)
  })
})

describe('toBits', () => {
  test('unpacks MSB-first', () => {
    expect([...toBits(new Uint8Array([0b10110001]))]).toEqual([1, 0, 1, 1, 0, 0, 0, 1])
  })
})
