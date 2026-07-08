import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deviationStat } from '../../src/scan/deviation.js'

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

const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'fixtures', 'deviation.json'), 'utf8'),
) as { p0: number; cases: Case[] }

/**
 * The honest null model, cross-checked against scipy: `z` and its two-sided
 * p-value against `scipy.stats.norm`, and the Bayes factor against
 * `scipy.special.betaln`. Fixtures are checked in; regenerate with
 * `uv run scripts/fixtures/generate.py`.
 */
describe('deviation null model vs scipy fixtures', () => {
  test('every case matches z, two-sided p, and BF10', () => {
    for (const c of fixture.cases) {
      const s = deviationStat(c.k, c.n, { a: c.a, b: c.b })
      expect(s.z).toBeCloseTo(c.z, 12)
      expect(s.p).toBeCloseTo(c.p, 10)
      if (c.bf10 !== null) {
        expect(Math.abs(s.bayesFactor - c.bf10) / c.bf10).toBeLessThan(1e-9)
      } else {
        expect(s.bayesFactor).toBeGreaterThan(1e300)
      }
    }
  })

  test('p0 in the fixture is exactly 1/2', () => {
    expect(fixture.p0).toBe(0.5)
  })
})
