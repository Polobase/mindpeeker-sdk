import { describe, expect, test } from 'bun:test'
import { aptCutoff, rctCutoff } from '../../src/internal/health-cutoffs.js'

const F = 2112n // fixed-point fraction bits: resolves C(W,k)·p^k·q^(W−k) far below α = 2⁻²⁰
const ONE = 1n << F

function isqrt(value: bigint): bigint {
  if (value < 2n) return value
  let x = 1n << BigInt(Math.ceil(value.toString(2).length / 2))
  while (true) {
    const next = (x + value / x) >> 1n
    if (next >= x) return x
    x = next
  }
}

/** 2^(−H) in F-bit fixed point for dyadic H (integers, ½, ¼, 1/16) — exact up to truncation. */
function twoToMinusH(h: number): bigint {
  if (Number.isInteger(h)) return ONE >> BigInt(h)
  const roots = Math.round(-Math.log2(h - Math.floor(h))) // ½ → 1 root, ¼ → 2, 1/16 → 4
  let root = 2n * ONE // 2^(1/2^roots) by repeated fixed-point square roots of 2
  for (let i = 0; i < roots; i++) root = isqrt(root * ONE)
  return ((ONE * ONE) / root) >> BigInt(Math.floor(h))
}

/** SP 800-90B APT cutoff by exact BigInt binomial tail sums (independent of the float code). */
function bigIntAptCutoff(h: number, w: number): number {
  const p = twoToMinusH(h)
  const q = ONE - p
  const powP: bigint[] = [ONE]
  const powQ: bigint[] = [ONE]
  for (let k = 1; k <= w; k++) {
    powP.push(((powP[k - 1] as bigint) * p) >> F)
    powQ.push(((powQ[k - 1] as bigint) * q) >> F)
  }
  const alpha = ONE >> 20n
  const choose: bigint[] = [1n]
  for (let k = 1; k <= w; k++)
    choose.push(((choose[k - 1] as bigint) * BigInt(w - k + 1)) / BigInt(k))
  let tail = 0n
  for (let k = w; k >= 0; k--) {
    const mass = ((choose[k] as bigint) * (powP[k] as bigint) * (powQ[w - k] as bigint)) >> F
    if (tail + mass > alpha) return 1 + k
    tail += mass
  }
  return 1
}

describe('aptCutoff — SP 800-90B Table 2 cross-check', () => {
  const H = [0.0625, 0.25, 0.5, 1, 2, 4, 7, 8]
  for (const w of [512, 1024]) {
    test(`W = ${w}: equals exact BigInt binomial tail sums at H = ${H.join(', ')}`, () => {
      for (const h of H) expect(aptCutoff(h, w)).toBe(bigIntAptCutoff(h, w))
    })
  }

  test('published SP 800-90B values (W = 512: H = 0.5, 1, 2, 4, 8 → 410, 311, 177, 62, 13)', () => {
    expect([0.5, 1, 2, 4, 8].map((h) => aptCutoff(h, 512))).toEqual([410, 311, 177, 62, 13])
  })

  test('low-H credits the entropy package uses are exact (1/16 bit: 509 / 1009, not W + 1)', () => {
    expect(aptCutoff(0.0625, 512)).toBe(509)
    expect(aptCutoff(0.0625, 1024)).toBe(1009)
  })

  test('W + 1 appears exactly when p^W > α, i.e. H < 20/W — never as a float fallback', () => {
    for (const w of [512, 1024]) {
      const edge = 20 / w
      expect(aptCutoff(edge * 1.01, w)).toBeLessThanOrEqual(w)
      expect(aptCutoff(edge * 0.99, w)).toBe(w + 1)
    }
    // 2^−H rounds to 1 in float64 below H ≈ 1e-16; the answer is still exact
    expect(aptCutoff(1e-17, 512)).toBe(513)
    expect(aptCutoff(5e-324, 1024)).toBe(1025)
  })

  test('validation', () => {
    const invalid = expect.objectContaining({ name: 'NegentropyError', code: 'invalid_config' })
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => aptCutoff(bad, 512)).toThrow(invalid)
      expect(() => rctCutoff(bad)).toThrow(invalid)
    }
    expect(() => aptCutoff(1, 0)).toThrow(invalid)
    expect(() => aptCutoff(1, 12.5)).toThrow(invalid)
    expect(() => rctCutoff(1e-300)).toThrow(invalid) // cutoff beyond 2⁵³
  })
})

describe('rctCutoff', () => {
  test('1 + ⌈20/H⌉', () => {
    expect(rctCutoff(8)).toBe(4)
    expect(rctCutoff(1)).toBe(21)
    expect(rctCutoff(0.3)).toBe(68)
    expect(rctCutoff(0.0625)).toBe(321)
  })
})
