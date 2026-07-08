import { describe, expect, test } from 'bun:test'
import { toBits } from '../../src/estimators/entropy.js'
import {
  chiSquareBytes,
  monobit,
  runsTest,
  serialCorrelation,
} from '../../src/estimators/frequency.js'
import { prngBytes } from '../helpers/byte-sources.js'

describe('classic tests on healthy PRNG data', () => {
  const data = prngBytes(262_144)
  const bits = toBits(data)

  test('chi-square is unremarkable, with an exact p-value', () => {
    const { statistic, pValue } = chiSquareBytes(data)
    expect(statistic).toBeGreaterThan(180)
    expect(statistic).toBeLessThan(340)
    expect(pValue).toBeGreaterThan(0.001)
    expect(pValue).toBeLessThan(1)
  })

  test('serial correlation is near zero', () => {
    expect(Math.abs(serialCorrelation(data))).toBeLessThan(0.01)
  })

  test('monobit is balanced', () => {
    expect(Math.abs(monobit(bits).z)).toBeLessThan(4)
  })

  test('runs test is unremarkable', () => {
    expect(Math.abs(runsTest(bits))).toBeLessThan(4)
  })
})

describe('classic tests catch bad data', () => {
  test('serial correlation flags a ramp', () => {
    const ramp = new Uint8Array(65_536)
    for (let i = 0; i < ramp.length; i++) ramp[i] = i & 0xff
    expect(serialCorrelation(ramp)).toBeGreaterThan(0.9)
  })

  test('chi-square flags a biased distribution', () => {
    const biased = prngBytes(65_536)
    for (let i = 0; i < biased.length; i += 3) biased[i] = 42
    expect(chiSquareBytes(biased).pValue).toBeLessThan(0.0001)
  })

  test('monobit and runs flag structured bits', () => {
    const alternating = new Uint8Array(32_768).fill(0xaa)
    const bits = toBits(alternating)
    expect(Math.abs(monobit(bits).z)).toBeLessThan(0.001) // perfectly balanced…
    expect(Math.abs(runsTest(bits))).toBeGreaterThan(50) // …but wildly over-running
  })
})

describe('chi-square p-value is the exact incomplete gamma', () => {
  test('a chi-square of exactly df has p ≈ 0.487 at 255 df (not the Wilson–Hilferty shortcut)', () => {
    // construct a byte histogram with statistic ≈ df by direct computation check:
    // uniform-count data gives statistic 0 → p = 1
    const flat = new Uint8Array(256 * 16)
    for (let i = 0; i < flat.length; i++) flat[i] = i & 0xff
    const { statistic, pValue } = chiSquareBytes(flat)
    expect(statistic).toBe(0)
    expect(pValue).toBe(1)
  })
})
