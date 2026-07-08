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

  test('k = 60 of 100 → z = 2, two-sided p ≈ 0.0455', () => {
    const s = deviationStat(60, 100)
    expect(s.z).toBeCloseTo(2, 12)
    expect(s.p).toBeCloseTo(0.045500263896, 8)
  })

  test('Bayes factor grows with the deviation', () => {
    expect(deviationStat(90, 100).bayesFactor).toBeGreaterThan(deviationStat(55, 100).bayesFactor)
  })
})

describe('scanDeviation — fair source is null', () => {
  test('BF ≈ 1, |z| small, ranking has no strong outlier', async () => {
    const rounds = 800
    const M = 16
    const report = await scanDeviation(catalog(M), batchSource('fair', deviationBytes(rounds, M)), {
      rounds,
    })
    expect(report.p0).toBe(0.5)
    expect(report.results.length).toBe(M)
    for (const r of report.results) {
      expect(Math.abs(r.deviation.z)).toBeLessThan(4)
      expect(r.deviation.bayesFactor).toBeLessThan(5) // no strong evidence under the null
    }
    // p-values spread across the unit interval (not clustered near 0)
    const ps = report.results.map((r) => r.deviation.p)
    expect(Math.min(...ps)).toBeGreaterThan(0.001)
    expect(ps.filter((p) => p > 0.25).length).toBeGreaterThanOrEqual(M / 2)
    // exact byte accounting: one byte per coin
    expect(report.accounting.bytesConsumed).toBe(rounds * M)
    expect(report.accounting.bitsUsed).toBe(rounds * M * 8)
  })
})

describe('scanDeviation — a biased item is caught', () => {
  test('the injected item J has the highest Bayes factor and |z|', async () => {
    const rounds = 400
    const M = 12
    const J = 5
    const report = await scanDeviation(
      catalog(M),
      batchSource('biased', deviationBytes(rounds, M, { biasedItem: J })),
      { rounds },
    )
    // ranked by Bayes factor descending → J is rank 1
    expect(report.results[0]?.name).toBe(`item-${J}`)
    expect(report.results[0]?.rank).toBe(1)
    const jr = report.results.find((r) => r.name === `item-${J}`)
    expect(jr?.deviation.successes).toBe(rounds) // every round scored
    expect(jr?.deviation.z).toBeCloseTo(Math.sqrt(rounds), 6) // (N − N/2)/√(N/4) = √N
    expect(jr?.deviation.bayesFactor).toBeGreaterThan(1e6)
    // J is the unique argmax of both statistics
    const maxBf = Math.max(...report.results.map((r) => r.deviation.bayesFactor))
    const maxAbsZ = Math.max(...report.results.map((r) => Math.abs(r.deviation.z)))
    expect(jr?.deviation.bayesFactor).toBe(maxBf)
    expect(Math.abs(jr?.deviation.z ?? 0)).toBe(maxAbsZ)
  })
})

describe('byBayesFactor — tie-break is order-independent (not catalog order)', () => {
  const dev = (bf: number) => ({ bayesFactor: bf })

  test('strictly higher Bayes factor always wins, regardless of position', () => {
    const lo = { name: 'aaa', deviation: dev(1) }
    const hi = { name: 'zzz', deviation: dev(10) }
    expect(byBayesFactor(lo, hi)).toBeGreaterThan(0) // hi sorts before lo
    expect(byBayesFactor(hi, lo)).toBeLessThan(0)
  })

  test('exact ties break by the name hash, not the argument (catalog) order', () => {
    // Same Bayes factor for every item → the tie-break alone decides rank 1.
    const names = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel']
    const items = names.map((name) => ({ name, deviation: dev(3) }))
    const forward = [...items].sort(byBayesFactor)
    const reversed = [...items].reverse().sort(byBayesFactor)
    // The winner (and the whole order) is invariant under input permutation.
    expect(forward.map((r) => r.name)).toEqual(reversed.map((r) => r.name))
    // …and it is the smallest-hash name, which for this set is NOT names[0].
    const expected = [...names].sort((a, b) => tieBreakKey(a) - tieBreakKey(b))[0]
    expect(forward[0]?.name).toBe(expected)
    expect(forward[0]?.name).not.toBe(names[0]) // the old stable-sort winner
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
  // An all-even byte stream makes every item score k = 0, so every Bayes factor
  // is bit-identical: the report is a pure tie and rank 1 is decided solely by
  // the tie-break. Under the old catalog-order stable sort, rank 1 was always
  // the first-listed item, so permuting the catalog changed the "top hit".
  test('rank 1 is invariant under permuting a fully-tied catalog', async () => {
    const rounds = 64
    const names = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel']
    const zeros = () => batchSource('even', new Uint8Array(rounds * names.length))
    const forward = defineCatalog(
      'tie',
      'tie',
      names.map((name) => ({ id: name, name })),
    )
    const reversed = defineCatalog(
      'tie',
      'tie',
      [...names].reverse().map((name) => ({ id: name, name })),
    )
    const a = await scanDeviation(forward, zeros(), { rounds })
    const b = await scanDeviation(reversed, zeros(), { rounds })
    // Precondition: it really is a full tie (all Bayes factors equal).
    const bfs = a.results.map((r) => r.deviation.bayesFactor)
    expect(new Set(bfs).size).toBe(1)
    // The surfaced winner is the same no matter how the catalog was ordered —
    // this assertion fails under the old catalog-order tie-break.
    expect(a.results[0]?.name).toBe(b.results[0]?.name)
    expect(a.results.map((r) => r.name)).toEqual(b.results.map((r) => r.name))
  })
})
