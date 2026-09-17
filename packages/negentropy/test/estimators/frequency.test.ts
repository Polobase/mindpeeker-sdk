import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { toBits } from '../../src/estimators/entropy.js'
import {
  chiSquareBytes,
  monobit,
  runsTest,
  serialCorrelation,
} from '../../src/estimators/frequency.js'
import { normSf } from '../../src/internal/special.js'
import { prngBytes } from '../helpers/byte-sources.js'

const numerics = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'fixtures', 'numerics.json'), 'utf8'),
) as { chi2Sf255: number }

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
  test('a flat histogram gives statistic 0 and p = 1', () => {
    const flat = new Uint8Array(256 * 16)
    for (let i = 0; i < flat.length; i++) flat[i] = i & 0xff
    const { statistic, pValue } = chiSquareBytes(flat)
    expect(statistic).toBe(0)
    expect(pValue).toBe(1)
  })

  test('a statistic of exactly df = 255 has p = 0.48822… (mpmath), not the Wilson–Hilferty value', () => {
    // expected count 64 per symbol; deviations ±63, ±63, ±14, ±5, ±1 on ten symbols give
    // Σ(c − 64)²/64 = 2·(63² + 63² + 14² + 5² + 1²)/64 = 255 exactly
    const counts = new Array<number>(256).fill(64)
    const deviations = [63, 63, 14, 5, 1]
    deviations.forEach((d, i) => {
      counts[2 * i] = 64 + d
      counts[2 * i + 1] = 64 - d
    })
    const data = new Uint8Array(256 * 64)
    let offset = 0
    counts.forEach((count, symbol) => {
      data.fill(symbol, offset, offset + count)
      offset += count
    })
    const { statistic, pValue } = chiSquareBytes(data)
    expect(statistic).toBe(255)
    expect(Math.abs(pValue - numerics.chi2Sf255)).toBeLessThan(1e-14)
    // the Wilson–Hilferty shortcut Φ(−√(2/(9·255))) is off by ~5e-7 — far outside that tolerance
    const wilsonHilferty = normSf(Math.sqrt(2 / (9 * 255)))
    expect(Math.abs(pValue - wilsonHilferty)).toBeGreaterThan(1e-8)
  })
})

describe('input validation', () => {
  test('empty and non-bit inputs throw typed errors instead of NaN/nonsense', () => {
    const insufficient = expect.objectContaining({ code: 'insufficient_data' })
    const invalid = expect.objectContaining({ code: 'invalid_config' })
    expect(() => chiSquareBytes(new Uint8Array(0))).toThrow(insufficient)
    expect(() => monobit(new Uint8Array(0))).toThrow(insufficient)
    expect(() => runsTest(Uint8Array.from([1]))).toThrow(insufficient)
    // packed bytes instead of toBits(bytes): onesFraction 70 / z 240 before 0.2.0
    expect(() => monobit(Uint8Array.from([3, 200, 7]))).toThrow(invalid)
    expect(() => runsTest(Uint8Array.from([0, 1, 2, 1]))).toThrow(invalid)
  })
})
