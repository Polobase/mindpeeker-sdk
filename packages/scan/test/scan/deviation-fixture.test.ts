import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { binomialPmf } from '@mindpeeker/negentropy/numerics'
import { binomialTwoSidedP, deviationStat } from '../../src/scan/deviation.js'

interface Case {
  k: number
  n: number
  a: number
  b: number
  z: number
  p: number
  lnBf10: number
  bf10: number | null
}

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(import.meta.dir, '..', 'fixtures', name), 'utf8')) as T
}

const deviation = fixture<{ p0: number; cases: Case[] }>('deviation.json')
const nullBf = fixture<{ n: number; median: number; pBelowOne: number; mean: number }>(
  'null-bf.json',
)

/**
 * The honest null model, cross-checked against scipy: the exact two-sided
 * binomial p against `scipy.stats.binomtest`, `z` by its closed form, and the
 * log Bayes factor against `scipy.special.betaln`. Fixtures are checked in;
 * regenerate with `uv run scripts/fixtures/generate.py`.
 */
describe('deviation null model vs scipy fixtures', () => {
  test('every case matches z, exact two-sided p, and ln BF10', () => {
    for (const c of deviation.cases) {
      const s = deviationStat(c.k, c.n, { a: c.a, b: c.b })
      expect(s.z).toBeCloseTo(c.z, 12)
      expect(Math.abs(s.p - c.p)).toBeLessThan(1e-12 + 1e-9 * c.p)
      expect(Math.abs(s.lnBayesFactor - c.lnBf10)).toBeLessThan(
        1e-9 * Math.max(1, Math.abs(c.lnBf10)),
      )
      if (c.bf10 !== null) {
        expect(Math.abs(s.bayesFactor - c.bf10) / c.bf10).toBeLessThan(1e-9)
      } else {
        expect(Number.isFinite(s.lnBayesFactor)).toBe(true)
      }
    }
  })

  test('p0 in the fixture is exactly 1/2', () => {
    expect(deviation.p0).toBe(0.5)
  })
})

describe('the exact p is never anti-conservative', () => {
  test('P(p ≤ α | fair coin) ≤ α at every N, where the normal tail failed', () => {
    for (const n of [4, 8, 16, 32, 64, 128, 256]) {
      for (const alpha of [0.01, 0.05, 0.1]) {
        let size = 0
        for (let k = 0; k <= n; k++) {
          if (binomialTwoSidedP(k, n) <= alpha) size += binomialPmf(k, n, 0.5)
        }
        expect(size).toBeLessThanOrEqual(alpha + 1e-12)
      }
    }
    // the replaced normal tail at N = 16: 2Φ(−|z|) ≤ 0.05 for k ≤ 4 or k ≥ 12
    const normalSize = [0, 1, 2, 3, 4, 12, 13, 14, 15, 16].reduce(
      (acc, k) => acc + binomialPmf(k, 16, 0.5),
      0,
    )
    expect(normalSize).toBeCloseTo(0.0768127, 6)
  })
})

describe('Bayes factors under a fair source (N = 256, Beta(1, 1))', () => {
  test('median ≈ 0.095 and P(BF10 < 1) ≈ 0.979, while E[BF10] = 1', () => {
    const n = nullBf.n
    const rows = Array.from({ length: n + 1 }, (_, k) => ({
      bf: deviationStat(k, n).bayesFactor,
      pmf: binomialPmf(k, n, 0.5),
    })).sort((x, y) => x.bf - y.bf)
    let cumulative = 0
    let median = Number.NaN
    for (const row of rows) {
      cumulative += row.pmf
      if (cumulative >= 0.5) {
        median = row.bf
        break
      }
    }
    const below = rows.filter((r) => r.bf < 1).reduce((acc, r) => acc + r.pmf, 0)
    const mean = rows.reduce((acc, r) => acc + r.bf * r.pmf, 0)
    expect(median).toBeCloseTo(nullBf.median, 10)
    expect(below).toBeCloseTo(nullBf.pBelowOne, 10)
    expect(mean).toBeCloseTo(1, 9)
    expect(nullBf.mean).toBeCloseTo(1, 9)
  })
})
