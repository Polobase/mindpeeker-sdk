import { describe, expect, test } from 'bun:test'
import { defineCatalog } from '../../src/catalog.js'
import {
  byBayesFactor,
  deviationStat,
  P0,
  scanDeviation,
  tieBreakKey,
} from '../../src/scan/deviation.js'
import type { CatalogItem } from '../../src/types.js'
import { batchSource, deviationBytes } from '../helpers/byte-sources.js'

function catalog(n: number) {
  const items: CatalogItem[] = Array.from({ length: n }, (_, i) => ({
    id: `i${i}`,
    name: `item-${i}`,
  }))
  return defineCatalog('dev', 'Deviation catalog', items)
}

describe('deviationStat (the null-model math)', () => {
  test('p0 is exactly 1/2', () => {
    expect(P0).toBe(0.5)
  })

  test('k = N/2 is dead null: z = 0, p = 1', () => {
    const s = deviationStat(50, 100)
    expect(s.z).toBe(0)
    expect(s.p).toBe(1)
    expect(s.successes).toBe(50)
    expect(s.rounds).toBe(100)
  })

  test('k = 60 of 100: z = 2 (descriptive), exact two-sided p ≈ 0.0569 (not the normal 0.0455)', () => {
    const s = deviationStat(60, 100)
    expect(s.z).toBeCloseTo(2, 12)
    expect(s.p).toBeCloseTo(0.056887933640980784, 12)
  })

  test('Bayes factor grows with the deviation; the log form stays finite', () => {
    expect(deviationStat(90, 100).lnBayesFactor).toBeGreaterThan(
      deviationStat(55, 100).lnBayesFactor,
    )
    const stuck = deviationStat(2000, 2000)
    expect(stuck.bayesFactor).toBe(Number.POSITIVE_INFINITY)
    expect(Number.isFinite(stuck.lnBayesFactor)).toBe(true)
  })
})

describe('scanDeviation — fair source is null', () => {
  test('|z| small, BF10 mostly below 1, exact accounting of 8 coins per byte', async () => {
    const rounds = 800
    const M = 16
    const report = await scanDeviation(catalog(M), batchSource('fair', deviationBytes(rounds, M)), {
      rounds,
    })
    expect(report.p0).toBe(0.5)
    expect(report.results.length).toBe(M)
    for (const r of report.results) {
      expect(Math.abs(r.deviation.z)).toBeLessThan(4)
      expect(r.deviation.bayesFactor).toBeLessThan(5)
      expect(r.deviation.pHolm).toBeGreaterThanOrEqual(r.deviation.p)
      expect(r.id).toMatch(/^i\d+$/)
    }
    const below = report.results.filter((r) => r.deviation.bayesFactor < 1).length
    expect(below).toBeGreaterThanOrEqual(M / 2)
    const ps = report.results.map((r) => r.deviation.p)
    expect(Math.min(...ps)).toBeGreaterThan(0.001)
    expect(report.accounting.bytesConsumed).toBe((rounds * M) / 8)
    expect(report.accounting.bitsUsed).toBe(rounds * M)
    expect(report.multiplicity.tests).toBe(M)
    expect(report.multiplicity.expectedFalsePositives).toBeCloseTo(0.8, 12)
    expect(report.multiplicity.omnibus.p).toBeGreaterThan(0.001)
  })

  test('a coin count that is not a byte multiple still uses exactly one bit per coin', async () => {
    const report = await scanDeviation(catalog(3), batchSource('fair', deviationBytes(7, 3)), {
      rounds: 7,
    })
    expect(report.accounting.bitsUsed).toBe(21)
    expect(report.accounting.bytesConsumed).toBe(3)
  })
})

describe('scanDeviation — a biased item is caught', () => {
  test('the injected item J ranks first with the largest ln BF10 and |z|', async () => {
    const rounds = 400
    const M = 12
    const J = 5
    const report = await scanDeviation(
      catalog(M),
      batchSource('biased', deviationBytes(rounds, M, { biasedItem: J })),
      { rounds },
    )
    expect(report.results[0]?.id).toBe(`i${J}`)
    expect(report.results[0]?.rank).toBe(1)
    const jr = report.results.find((r) => r.id === `i${J}`)
    expect(jr?.deviation.successes).toBe(rounds)
    expect(jr?.deviation.z).toBeCloseTo(Math.sqrt(rounds), 6)
    expect(jr?.deviation.bayesFactor).toBeGreaterThan(1e6)
    expect(jr?.deviation.pHolm).toBeLessThan(1e-50)
    const maxLn = Math.max(...report.results.map((r) => r.deviation.lnBayesFactor))
    expect(jr?.deviation.lnBayesFactor).toBe(maxLn)
    expect(report.multiplicity.omnibus.p).toBeLessThan(1e-50)
    expect(report.multiplicity.holmRejections).toBeGreaterThanOrEqual(1)
  })
})

describe('byBayesFactor — order independent, overflow safe', () => {
  const dev = (lnBayesFactor: number) => ({ lnBayesFactor })

  test('strictly higher ln BF10 always wins, regardless of position', () => {
    const lo = { id: 'aaa', deviation: dev(0) }
    const hi = { id: 'zzz', deviation: dev(2) }
    expect(byBayesFactor(lo, hi)).toBeGreaterThan(0)
    expect(byBayesFactor(hi, lo)).toBeLessThan(0)
  })

  test('exact ties break by the id hash, not the argument (catalog) order', () => {
    const ids = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel']
    const items = ids.map((id) => ({ id, deviation: dev(3) }))
    const forward = [...items].sort(byBayesFactor)
    const reversed = [...items].reverse().sort(byBayesFactor)
    expect(forward.map((r) => r.id)).toEqual(reversed.map((r) => r.id))
    const expected = [...ids].sort((a, b) => tieBreakKey(a) - tieBreakKey(b))[0]
    expect(forward[0]?.id).toBe(expected)
    expect(forward[0]?.id).not.toBe(ids[0])
  })

  test('tieBreakKey is a deterministic unsigned 32-bit hash', () => {
    expect(tieBreakKey('alpha')).toBe(tieBreakKey('alpha'))
    expect(tieBreakKey('alpha')).not.toBe(tieBreakKey('bravo'))
    const k = tieBreakKey('some-item-name')
    expect(Number.isInteger(k)).toBe(true)
    expect(k).toBeGreaterThanOrEqual(0)
    expect(k).toBeLessThan(2 ** 32)
  })
})

describe('scanDeviation — the null winner does not depend on catalog order', () => {
  const ids = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel']
  const cat = (order: readonly string[]) =>
    defineCatalog(
      'tie',
      'tie',
      order.map((id) => ({ id, name: id })),
    )

  test('rank 1 is invariant under permuting a fully tied catalog (finite BFs)', async () => {
    const rounds = 64
    const zeros = () => batchSource('even', new Uint8Array((rounds * ids.length) / 8))
    const a = await scanDeviation(cat(ids), zeros(), { rounds })
    const b = await scanDeviation(cat([...ids].reverse()), zeros(), { rounds })
    expect(new Set(a.results.map((r) => r.deviation.bayesFactor)).size).toBe(1)
    expect(a.results.map((r) => r.id)).toEqual(b.results.map((r) => r.id))
  })

  test('a stuck-high source (BF10 = Infinity for every item) still ranks independent of order', async () => {
    const rounds = 1100
    const ones = () => batchSource('stuck', new Uint8Array((rounds * ids.length) / 8).fill(0xff))
    const a = await scanDeviation(cat(ids), ones(), { rounds })
    const b = await scanDeviation(cat([...ids].reverse()), ones(), { rounds })
    expect(a.results.every((r) => r.deviation.bayesFactor === Number.POSITIVE_INFINITY)).toBe(true)
    expect(a.results.map((r) => r.id)).toEqual(b.results.map((r) => r.id))
    expect(a.multiplicity.omnibus.p).toBe(0)
  })
})

describe('scanDeviation — validation', () => {
  const src = () => batchSource('fair', deviationBytes(64, 4))

  test('bad rounds, prior, alpha, source, and catalogs are typed errors before any byte', async () => {
    for (const opts of [
      { rounds: 0 },
      { rounds: -1 },
      { rounds: 10.5 },
      { rounds: Number.NaN },
      { prior: { a: 0 } },
      { prior: { b: Number.POSITIVE_INFINITY } },
      { alpha: 1 },
      { alpha: 0 },
    ]) {
      await expect(scanDeviation(catalog(4), src(), opts)).rejects.toMatchObject({
        name: 'ScanError',
        code: 'invalid_options',
      })
    }
    await expect(
      scanDeviation(catalog(4), { name: '', stream: src().stream } as never),
    ).rejects.toMatchObject({ code: 'invalid_options' })
    await expect(scanDeviation({ id: 'x', name: 'x', items: [] }, src())).rejects.toMatchObject({
      code: 'invalid_catalog',
    })
  })
})
