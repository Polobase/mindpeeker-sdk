import { describe, expect, test } from 'bun:test'
import { defineCatalog } from '../../src/catalog.js'
import { ScanError } from '../../src/errors.js'
import { scan } from '../../src/scan/scan.js'
import type { Catalog, CatalogItem } from '../../src/types.js'
import { batchSource, cyclingSource, prngBytes } from '../helpers/byte-sources.js'

function catalog(n: number): Catalog {
  const items: CatalogItem[] = Array.from({ length: n }, (_, i) => ({
    id: `i${i}`,
    name: `item-${i}`,
    category: i % 2 === 0 ? 'even' : 'odd',
  }))
  return defineCatalog('c', 'Catalog', items)
}

const src = (seed: number) => cyclingSource('u', prngBytes(8192, seed), 100)

describe('scan', () => {
  test('is deterministic: fixed bytes → fixed ranking and accounting', async () => {
    const cat = catalog(20)
    const a = await scan(cat, src(11), { deviationRounds: 64 })
    const b = await scan(cat, src(11), { deviationRounds: 64 })
    expect(a.results.map((r) => r.name)).toEqual(b.results.map((r) => r.name))
    expect(a.numberOfTrials).toBe(b.numberOfTrials)
    expect(a.accounting.bytesConsumed).toBe(b.accounting.bytesConsumed)
    expect(a.accounting.bitsUsed).toBe(a.accounting.bytesConsumed * 8)
  })

  test("mode 'both' races a subset and attaches vitality + deviation", async () => {
    const report = await scan(catalog(20), src(2), { deviationRounds: 64 })
    expect(report.mode).toBe('both')
    expect(report.results.length).toBe(12) // clamp(round(2), 12, 20)
    expect(report.numberOfTrials).toBeGreaterThan(0)
    const top = report.results[0]
    expect(top?.rank).toBe(1)
    expect(top?.energy).toBe(1) // winner normalised to 1
    expect(top?.vitality).toBeGreaterThanOrEqual(0)
    expect(top?.deviation).toBeDefined()
    // energy is monotone non-increasing down the ranking
    for (let i = 1; i < report.results.length; i++) {
      expect(report.results[i - 1]?.energy ?? 0).toBeGreaterThanOrEqual(
        report.results[i]?.energy ?? 0,
      )
    }
  })

  test("mode 'race' omits deviation; mode 'deviation' omits energy and ranks by Bayes factor", async () => {
    const raceOnly = await scan(catalog(20), src(3), { mode: 'race', withVitality: false })
    expect(raceOnly.results.every((r) => r.deviation === undefined)).toBe(true)
    expect(raceOnly.results.every((r) => r.vitality === undefined)).toBe(true)
    expect(raceOnly.results[0]?.energy).toBe(1)

    const devOnly = await scan(catalog(10), src(3), {
      mode: 'deviation',
      withVitality: false,
      deviationRounds: 128,
    })
    expect(devOnly.numberOfTrials).toBe(0)
    expect(devOnly.results.length).toBe(10) // whole catalog scored
    expect(devOnly.results.every((r) => r.energy === undefined)).toBe(true)
    for (let i = 1; i < devOnly.results.length; i++) {
      expect(devOnly.results[i - 1]?.deviation?.bayesFactor ?? 0).toBeGreaterThanOrEqual(
        devOnly.results[i]?.deviation?.bayesFactor ?? 0,
      )
    }
  })

  test('deviation-only rank 1 does not depend on catalog order', async () => {
    // All-even bytes → every item scores k = 0 → identical Bayes factors, a
    // pure tie. The old stable sort surfaced the first-listed item; the fixed
    // tie-break makes the winner invariant under permuting the catalog.
    const names = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']
    const rounds = 64
    const cat = (order: readonly string[]) =>
      defineCatalog(
        'tie',
        'tie',
        order.map((name) => ({ id: name, name })),
      )
    const zeros = () => batchSource('even', new Uint8Array(rounds * names.length))
    const opts = { mode: 'deviation' as const, withVitality: false, deviationRounds: rounds }
    const a = await scan(cat(names), zeros(), opts)
    const b = await scan(cat([...names].reverse()), zeros(), opts)
    const bfs = a.results.map((r) => r.deviation?.bayesFactor)
    expect(new Set(bfs).size).toBe(1) // genuinely a full tie
    expect(a.results[0]?.name).toBe(b.results[0]?.name)
    expect(a.results.map((r) => r.name)).toEqual(b.results.map((r) => r.name))
  })

  test('rejects an empty catalog', async () => {
    const empty = { id: 'x', name: 'x', items: [] } as Catalog
    expect(scan(empty, src(1))).rejects.toBeInstanceOf(ScanError)
  })

  test('a starved source raises insufficient_entropy', async () => {
    // a tiny finite source cannot complete the race
    const tiny = {
      name: 'tiny',
      async *stream() {
        yield new Uint8Array([1, 2, 3])
      },
    }
    expect(scan(catalog(30), tiny)).rejects.toMatchObject({
      name: 'ScanError',
      code: 'insufficient_entropy',
    })
  })
})
