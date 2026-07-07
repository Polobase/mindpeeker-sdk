import { describe, expect, test } from 'bun:test'
import {
  chiSquare,
  markovMinEntropyPerBit,
  mcvMinEntropy,
  monobit,
  monteCarloPi,
  runsTest,
  serialCorrelation,
  shannonEntropy,
  toBits,
} from '../../scripts/stats.js'

function prng(n: number, seed = 0xabcdef01): Uint8Array {
  let state = seed
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    out[i] = state & 0xff
  }
  return out
}

describe('shannonEntropy', () => {
  test('is 0 for constant data and ~8 for uniform data', () => {
    expect(shannonEntropy(new Uint8Array(4096).fill(7))).toBe(0)
    expect(shannonEntropy(prng(262_144))).toBeGreaterThan(7.99)
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
    expect(mcvMinEntropy(prng(1_048_576))).toBeGreaterThan(7.8)
  })

  test('reflects a dominant symbol', () => {
    // 50% zeros, rest uniform → p_max ≈ 0.5 → H ≈ 1 bit
    const data = prng(65_536)
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
    expect(markovMinEntropyPerBit(toBits(prng(131_072)))).toBeGreaterThan(0.95)
  })
})

describe('classic tests on healthy PRNG data', () => {
  const data = prng(262_144)
  const bits = toBits(data)

  test('chi-square is unremarkable', () => {
    const { statistic, pValue } = chiSquare(data)
    expect(statistic).toBeGreaterThan(180)
    expect(statistic).toBeLessThan(340)
    expect(pValue).toBeGreaterThan(0.001)
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

  test('monte-carlo pi lands near pi', () => {
    expect(Math.abs(monteCarloPi(data) - Math.PI)).toBeLessThan(0.05)
  })
})

describe('classic tests catch bad data', () => {
  test('serial correlation flags a ramp', () => {
    const ramp = new Uint8Array(65_536)
    for (let i = 0; i < ramp.length; i++) ramp[i] = i & 0xff
    expect(serialCorrelation(ramp)).toBeGreaterThan(0.9)
  })

  test('chi-square flags a biased distribution', () => {
    const biased = prng(65_536)
    for (let i = 0; i < biased.length; i += 3) biased[i] = 42
    expect(chiSquare(biased).pValue).toBeLessThan(0.0001)
  })
})
