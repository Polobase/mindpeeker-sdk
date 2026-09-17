import { describe, expect, test } from 'bun:test'
import { defineCatalog } from '../../src/catalog.js'
import { ScanError } from '../../src/errors.js'
import { scan } from '../../src/scan/scan.js'
import { generalVitalitySf } from '../../src/scan/vitality.js'
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
    expect(a.results.map((r) => r.id)).toEqual(b.results.map((r) => r.id))
    expect(a.numberOfTrials).toBe(b.numberOfTrials)
    expect(a.accounting).toEqual(b.accounting)
    expect(a.accounting.bitsUsed).toBeLessThanOrEqual(a.accounting.bytesConsumed * 8)
  })

  test("mode 'both' races a subset and attaches vitality + deviation + multiplicity", async () => {
    const report = await scan(catalog(20), src(2), { deviationRounds: 64 })
    expect(report.mode).toBe('both')
    expect(report.results.length).toBe(20) // AetherOnePi rule: min(20, clamp(2, 120, 5000))
    expect(report.numberOfTrials).toBeGreaterThan(0)
    const top = report.results[0]
    expect(top?.rank).toBe(1)
    expect(top?.energy).toBe(1)
    expect(top?.vitality).toBeGreaterThanOrEqual(0)
    expect(top?.vitalityP).toBe(generalVitalitySf((top?.vitality as number) - 1))
    expect(top?.deviation?.pHolm).toBeGreaterThanOrEqual(top?.deviation?.p as number)
    expect(report.multiplicity?.tests).toBe(20)
    for (let i = 1; i < report.results.length; i++) {
      expect(report.results[i - 1]?.energy ?? 0).toBeGreaterThanOrEqual(
        report.results[i]?.energy ?? 0,
      )
    }
  })

  test('accounting: 8 bits per race/vitality byte plus one bit per deviation coin', async () => {
    const cat = catalog(10)
    const rounds = 13
    const raceOnly = await scan(cat, src(4), { mode: 'race' })
    const both = await scan(cat, src(4), { deviationRounds: rounds })
    expect(raceOnly.accounting.bitsUsed).toBe(8 * raceOnly.accounting.bytesConsumed)
    // same bytes up to the deviation phase (race then vitality), then ⌈M·N/8⌉ coin bytes
    const withVitality = await scan(cat, src(4), { mode: 'race', withVitality: true })
    const prefixBytes = withVitality.accounting.bytesConsumed
    expect(both.accounting.bytesConsumed).toBe(prefixBytes + Math.ceil((10 * rounds) / 8))
    expect(both.accounting.bitsUsed).toBe(8 * prefixBytes + 10 * rounds)
  })

  test("mode 'race' omits deviation; mode 'deviation' omits energy and ranks by ln BF10", async () => {
    const raceOnly = await scan(catalog(20), src(3), { mode: 'race', withVitality: false })
    expect(raceOnly.results.every((r) => r.deviation === undefined)).toBe(true)
    expect(raceOnly.results.every((r) => r.vitality === undefined)).toBe(true)
    expect(raceOnly.multiplicity).toBeUndefined()
    expect(raceOnly.results[0]?.energy).toBe(1)

    const devOnly = await scan(catalog(10), src(3), {
      mode: 'deviation',
      withVitality: false,
      deviationRounds: 128,
    })
    expect(devOnly.numberOfTrials).toBe(0)
    expect(devOnly.results.length).toBe(10)
    expect(devOnly.results.every((r) => r.energy === undefined)).toBe(true)
    for (let i = 1; i < devOnly.results.length; i++) {
      expect(devOnly.results[i - 1]?.deviation?.lnBayesFactor ?? 0).toBeGreaterThanOrEqual(
        devOnly.results[i]?.deviation?.lnBayesFactor ?? 0,
      )
    }
  })

  test('deviation-only rank 1 does not depend on catalog order', async () => {
    const ids = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']
    const rounds = 64
    const cat = (order: readonly string[]) =>
      defineCatalog(
        'tie',
        'tie',
        order.map((id) => ({ id, name: id })),
      )
    const zeros = () => batchSource('even', new Uint8Array((rounds * ids.length) / 8))
    const opts = { mode: 'deviation' as const, withVitality: false, deviationRounds: rounds }
    const a = await scan(cat(ids), zeros(), opts)
    const b = await scan(cat([...ids].reverse()), zeros(), opts)
    expect(new Set(a.results.map((r) => r.deviation?.bayesFactor)).size).toBe(1)
    expect(a.results.map((r) => r.id)).toEqual(b.results.map((r) => r.id))
  })

  test('rejects an empty catalog', async () => {
    const empty = { id: 'x', name: 'x', items: [] } as Catalog
    await expect(scan(empty, src(1))).rejects.toBeInstanceOf(ScanError)
  })

  test('a starved source raises insufficient_entropy', async () => {
    const tiny = {
      name: 'tiny',
      async *stream() {
        yield new Uint8Array([1, 2, 3])
      },
    }
    await expect(scan(catalog(30), tiny)).rejects.toMatchObject({
      name: 'ScanError',
      code: 'insufficient_entropy',
    })
  })
})

describe('scan — validation', () => {
  test('every malformed option is invalid_options, never a hang or a foreign error', async () => {
    const cases: Record<string, unknown>[] = [
      { maxValue: Number.NaN },
      { maxValue: Number.POSITIVE_INFINITY },
      { maxValue: 0 },
      { subsetFraction: Number.NaN },
      { subsetFraction: 2 },
      { subsetMin: 0 },
      { subsetMax: 1.5 },
      { deviationRounds: 0 },
      { deviationRounds: 10.5 },
      { prior: { a: -1 } },
      { alpha: 5 },
      { mode: 'fast' },
      { withVitality: 'yes' },
      { signal: {} },
    ]
    for (const opts of cases) {
      await expect(scan(catalog(5), src(1), opts as never)).rejects.toMatchObject({
        name: 'ScanError',
        code: 'invalid_options',
      })
    }
    await expect(scan(catalog(5), {} as never)).rejects.toMatchObject({ code: 'invalid_options' })
  })

  test('a hand-built catalog with duplicate ids is invalid_catalog', async () => {
    const dup = { id: 'd', name: 'd', items: [{ name: 'A' }, { name: 'A' }] } as Catalog
    await expect(scan(dup, src(1))).rejects.toMatchObject({ code: 'invalid_catalog' })
  })

  test('a pre-aborted signal rejects with aborted', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(scan(catalog(5), src(1), { signal: ac.signal })).rejects.toMatchObject({
      code: 'aborted',
    })
  })
})
