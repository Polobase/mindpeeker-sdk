import { describe, expect, test } from 'bun:test'
import { byteReader } from '@mindpeeker/oracle'
import { race } from '../../src/scan/race.js'
import type { CatalogItem } from '../../src/types.js'
import { bump, chiSquare, cyclingSource, prngBytes } from '../helpers/byte-sources.js'

function items(n: number): CatalogItem[] {
  return Array.from({ length: n }, (_, i) => ({ id: `i${i}`, name: `item-${i}` }))
}

describe('race', () => {
  test('is deterministic for identical bytes', async () => {
    const cat = items(20)
    const a = await race(byteReader(cyclingSource('u', prngBytes(4096, 7))), cat)
    const b = await race(byteReader(cyclingSource('u', prngBytes(4096, 7))), cat)
    expect(a.numberOfTrials).toBe(b.numberOfTrials)
    expect(a.items.map((r) => [r.item.name, r.ev, r.increments, r.winner])).toEqual(
      b.items.map((r) => [r.item.name, r.ev, r.increments, r.winner]),
    )
  })

  test('exactly one winner, which is the unique item to cross maxValue', async () => {
    const result = await race(byteReader(cyclingSource('u', prngBytes(4096, 3))), items(30), {
      maxValue: 100,
    })
    const winners = result.items.filter((r) => r.winner)
    expect(winners.length).toBe(1)
    expect((winners[0] as (typeof winners)[number]).ev).toBeGreaterThanOrEqual(100)
    for (const r of result.items) {
      if (!r.winner) expect(r.ev).toBeLessThan(100)
    }
  })

  test('subset is clamped to [min(12, size), size]', async () => {
    const small = await race(byteReader(cyclingSource('u', prngBytes(2048, 1))), items(5))
    expect(small.items.length).toBe(5) // min(12,5)=5 → whole catalog
    const mid = await race(byteReader(cyclingSource('u', prngBytes(4096, 1))), items(40))
    expect(mid.items.length).toBe(12) // round(4) clamped up to 12
    const big = await race(byteReader(cyclingSource('u', prngBytes(32768, 1))), items(200))
    expect(big.items.length).toBe(20) // round(20) inside [12,200]
  })

  test('subset selection is uniform (chi-square, vs the old modulo bias)', async () => {
    const M = 40
    const cat = items(M)
    const trials = 1200
    const counts = new Array<number>(M).fill(0)
    for (let t = 0; t < trials; t++) {
      const reader = byteReader(cyclingSource('u', prngBytes(4096, 1000 + t)))
      const result = await race(reader, cat, { maxValue: 60 })
      for (const r of result.items) bump(counts, Number(r.item.id?.slice(1)))
    }
    const subset = 12 // clamp(round(40*0.1)=4, 12, 40)
    const expected = new Array<number>(M).fill((trials * subset) / M)
    // dof = 39; the 0.999 chi-square quantile is ≈ 72.05 — 90 is a safe gate.
    expect(chiSquare(counts, expected)).toBeLessThan(90)
  })
})
