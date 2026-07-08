import { describe, expect, test } from 'bun:test'
import type { TripolarPlan } from '@mindpeeker/psi'
import { defineCatalog } from '../../src/catalog.js'
import { ScanError } from '../../src/errors.js'
import { scanTripolar } from '../../src/protocol/tripolar-scan.js'
import type { Catalog, CatalogItem } from '../../src/types.js'
import { cyclingSource, prngBytes, tripolarBiasBytes } from '../helpers/byte-sources.js'

function catalog(n: number): Catalog {
  const items: CatalogItem[] = Array.from({ length: n }, (_, i) => ({
    id: `i${i}`,
    name: `item-${i}`,
  }))
  return defineCatalog('t', 'Tripolar catalog', items)
}

const PLAN: TripolarPlan = { trialsPerRun: 8, bitsPerTrial: 8, runsPerIntention: 2 }

describe('scanTripolar', () => {
  test('recovers an injected high-minus-low bias (deltaZ far from 0)', async () => {
    // bitsPerTrial=8, one byte/trial: high runs 0xff (8 ones), low 0x00, baseline 0x0f.
    const biased = cyclingSource('esp32', tripolarBiasBytes(8, 2, 48))
    const report = await scanTripolar(catalog(4), biased, PLAN, { rounds: 16 })
    expect(report.deltaZ).toBeGreaterThan(5)
    expect(report.analysis.deltaP).toBeLessThan(1e-6)
    expect(report.deltaEffect).toBeGreaterThan(0)
    expect(report.deltaZ).toBe(report.analysis.deltaZ)
  })

  test('null data stays null: |deltaZ| in a plausible range', async () => {
    const fair = cyclingSource('esp32', prngBytes(4096, 20250708))
    const report = await scanTripolar(catalog(4), fair, PLAN, { rounds: 16 })
    expect(Math.abs(report.deltaZ)).toBeLessThan(4)
    expect(report.analysis.deltaP).toBeGreaterThan(1e-4)
  })

  test('scores the catalog under each intention, ranked by Bayes factor', async () => {
    const M = 4
    const rounds = 16
    const report = await scanTripolar(catalog(M), cyclingSource('u', prngBytes(4096, 3)), PLAN, {
      rounds,
    })
    for (const intention of ['high', 'low', 'baseline'] as const) {
      const scores = report.perIntention[intention]
      expect(scores.length).toBe(M)
      expect(scores[0]?.rank).toBe(1)
      expect(scores.every((r) => r.deviation !== undefined)).toBe(true)
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i - 1]?.deviation?.bayesFactor ?? 0).toBeGreaterThanOrEqual(
          scores[i]?.deviation?.bayesFactor ?? 0,
        )
      }
    }
    // accounting covers only the per-intention scoring phase: 3 × rounds × M coins.
    expect(report.accounting.bytesConsumed).toBe(3 * rounds * M)
    expect(report.accounting.bitsUsed).toBe(3 * rounds * M * 8)
  })

  test('per-intention rank 1 does not depend on catalog order', async () => {
    // An all-even source makes every item score k = 0 in the scoring phase, so
    // all Bayes factors tie. The old catalog-order stable sort surfaced the
    // first-listed item as rank 1; the fixed tie-break makes rank 1 invariant
    // under permuting the catalog, for every intention.
    const names = ['alpha', 'bravo', 'charlie', 'delta']
    const cat = (order: readonly string[]) =>
      defineCatalog(
        't',
        'Tripolar catalog',
        order.map((name) => ({ id: name, name })),
      )
    const zeros = () => cyclingSource('even', new Uint8Array(4096))
    const a = await scanTripolar(cat(names), zeros(), PLAN, { rounds: 16 })
    const b = await scanTripolar(cat([...names].reverse()), zeros(), PLAN, { rounds: 16 })
    for (const intention of ['high', 'low', 'baseline'] as const) {
      const bfs = a.perIntention[intention].map((r) => r.deviation?.bayesFactor)
      expect(new Set(bfs).size).toBe(1) // a full tie for this intention
      expect(a.perIntention[intention][0]?.name).toBe(b.perIntention[intention][0]?.name)
      expect(a.perIntention[intention].map((r) => r.name)).toEqual(
        b.perIntention[intention].map((r) => r.name),
      )
    }
  })

  test('rejects an empty catalog', async () => {
    const empty = { id: 'x', name: 'x', items: [] } as Catalog
    expect(scanTripolar(empty, cyclingSource('u', prngBytes(64, 1)), PLAN)).rejects.toBeInstanceOf(
      ScanError,
    )
  })

  test('abort raises ScanError aborted', async () => {
    const ac = new AbortController()
    const run = scanTripolar(catalog(4), cyclingSource('u', prngBytes(8192, 1)), PLAN, {
      rounds: 16,
      signal: ac.signal,
    })
    ac.abort()
    expect(run).rejects.toMatchObject({ name: 'ScanError', code: 'aborted' })
  })
})
