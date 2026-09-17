import { describe, expect, test } from 'bun:test'
import { byteReader } from '@mindpeeker/oracle'
import { race, raceSubsetSize, resolveRaceOptions } from '../../src/scan/race.js'
import type { CatalogItem } from '../../src/types.js'
import { bump, chiSquare, cyclingSource, prngBytes } from '../helpers/byte-sources.js'

function items(n: number): CatalogItem[] {
  return Array.from({ length: n }, (_, i) => ({ id: `i${i}`, name: `item-${i}` }))
}

const reader = (seed: number, size = 4096) => byteReader(cyclingSource('u', prngBytes(size, seed)))

describe('race', () => {
  test('is deterministic for identical bytes', async () => {
    const cat = items(20)
    const a = await race(reader(7), cat)
    const b = await race(reader(7), cat)
    expect(a.numberOfTrials).toBe(b.numberOfTrials)
    expect(a.items.map((r) => [r.item.name, r.ev, r.increments, r.winner])).toEqual(
      b.items.map((r) => [r.item.name, r.ev, r.increments, r.winner]),
    )
  })

  test('exactly one winner, which is the unique item to reach maxValue', async () => {
    const result = await race(reader(3), items(30), { maxValue: 100 })
    const winners = result.items.filter((r) => r.winner)
    expect(winners.length).toBe(1)
    expect((winners[0] as (typeof winners)[number]).ev).toBeGreaterThanOrEqual(100)
    for (const r of result.items) {
      if (!r.winner) expect(r.ev).toBeLessThan(100)
    }
  })
})

describe('race subset rule (AetherOnePi AnalysisService parity)', () => {
  const defaults = resolveRaceOptions({})

  test('min(size, clamp(floor(size/10), 120, 5000))', () => {
    expect(raceSubsetSize(20, defaults)).toBe(20)
    expect(raceSubsetSize(500, defaults)).toBe(120)
    expect(raceSubsetSize(1205, defaults)).toBe(120)
    expect(raceSubsetSize(1239, defaults)).toBe(123)
    expect(raceSubsetSize(60_000, defaults)).toBe(5000)
    // the size/10 integer division of the Java source equals floor(size * 0.1) exactly
    for (let size = 0; size <= 100_000; size += 7) {
      expect(raceSubsetSize(size, defaults)).toBe(
        Math.min(size, Math.max(120, Math.min(5000, Math.trunc(size / 10)))),
      )
    }
  })

  test('the 0.1 fraction rule stays reachable via subsetMin 12 / subsetMax Infinity', async () => {
    const old = resolveRaceOptions({ subsetMin: 12, subsetMax: Number.POSITIVE_INFINITY })
    expect(raceSubsetSize(5, old)).toBe(5)
    expect(raceSubsetSize(40, old)).toBe(12)
    expect(raceSubsetSize(200, old)).toBe(20)
    const big = await race(reader(1, 32768), items(200), {
      subsetMin: 12,
      subsetMax: Number.POSITIVE_INFINITY,
    })
    expect(big.items.length).toBe(20)
  })

  test('subset selection is uniform over the catalog (chi-square)', async () => {
    const M = 40
    const cat = items(M)
    const trials = 1200
    const counts = new Array<number>(M).fill(0)
    for (let t = 0; t < trials; t++) {
      const result = await race(reader(1000 + t), cat, { maxValue: 60, subsetMin: 12 })
      for (const r of result.items) bump(counts, Number(r.item.id?.slice(1)))
    }
    const subset = 12
    const expected = new Array<number>(M).fill((trials * subset) / M)
    // dof = 39; the 0.999 chi-square quantile is ≈ 72.05 — 90 is a safe gate.
    expect(chiSquare(counts, expected)).toBeLessThan(90)
  })

  test('the winner is uniform over the catalog despite the within-pass position advantage', async () => {
    const M = 12
    const cat = items(M)
    const trials = 1800
    const wins = new Array<number>(M).fill(0)
    for (let t = 0; t < trials; t++) {
      const result = await race(reader(5000 + t), cat, { maxValue: 60 })
      const w = result.items.find((r) => r.winner)
      bump(wins, Number(w?.item.id?.slice(1)))
    }
    const expected = new Array<number>(M).fill(trials / M)
    // dof = 11; the 0.999 quantile is ≈ 31.26.
    expect(chiSquare(wins, expected)).toBeLessThan(35)
  })
})

describe('race — validation', () => {
  test('maxValue, subsetFraction, subsetMin/Max are typed errors (no endless race)', async () => {
    for (const opts of [
      { maxValue: Number.NaN },
      { maxValue: Number.POSITIVE_INFINITY },
      { maxValue: 0 },
      { maxValue: -3 },
      { subsetFraction: Number.NaN },
      { subsetFraction: 0 },
      { subsetFraction: 1.5 },
      { subsetMin: 0 },
      { subsetMin: 2.5 },
      { subsetMin: 10, subsetMax: 5 },
    ]) {
      await expect(race(reader(1), items(10), opts)).rejects.toMatchObject({
        name: 'ScanError',
        code: 'invalid_options',
      })
    }
    await expect(race(reader(1), [])).rejects.toMatchObject({ code: 'invalid_catalog' })
  })
})
