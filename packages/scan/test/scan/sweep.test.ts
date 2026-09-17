import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineCatalog } from '../../src/catalog.js'
import { sweepNullPmf, sweepScan } from '../../src/scan/sweep.js'
import { batchSource, cyclingSource, prngBytes } from '../helpers/byte-sources.js'

const fx = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'fixtures', 'sweep.json'), 'utf8'),
) as {
  cases: { positions: number; pmf: number[] }[]
}

describe('sweepNullPmf', () => {
  test('first-passage law matches exact rationals and sums to 1', () => {
    for (const c of fx.cases) {
      const pmf = sweepNullPmf(c.positions)
      expect(pmf.length).toBe(c.positions)
      pmf.forEach((p, k) => {
        expect(p).toBeCloseTo(c.pmf[k] as number, 14)
      })
      expect(pmf.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
    }
  })

  test('uniform law is flat; first-passage is not', () => {
    expect(sweepNullPmf(10, 'uniform')).toEqual(new Array(10).fill(0.1))
    const fp = sweepNullPmf(100)
    const mode = fp.indexOf(Math.max(...fp))
    expect(mode).toBeGreaterThanOrEqual(8)
    expect(mode).toBeLessThanOrEqual(10)
    expect(fp[0]).toBeCloseTo(0.01, 15)
  })

  test('exhaustive replay: every draw sequence reproduces the first-passage law exactly', async () => {
    // positions 4: uniformInt(4) reads one byte, accepts every value, returns v mod 4 —
    // so feeding draw values 0..3 as bytes enumerates the model's 4^3 paths exactly
    const P = 4
    const counts = new Array<number>(P).fill(0)
    for (let code = 0; code < P ** (P - 1); code++) {
      const draws = [code >> 4, (code >> 2) & 3, code & 3]
      const report = await sweepScan(
        { dials: 1, positions: P },
        batchSource('enum', Uint8Array.from(draws)),
      )
      counts[report.stops[0] as number] = (counts[report.stops[0] as number] as number) + 1
    }
    const pmf = sweepNullPmf(P)
    counts.forEach((c, k) => {
      expect(c / P ** (P - 1)).toBeCloseTo(pmf[k] as number, 15)
    })
  })
})

describe('sweepScan', () => {
  test('dials: nearest-well first, stops form a rate, replayable, with accounting', async () => {
    const src = () => cyclingSource('dial', prngBytes(2048, 77))
    const a = await sweepScan({ dials: 6, positions: 10 }, src())
    const b = await sweepScan({ dials: 6, positions: 10 }, src())
    expect(a).toEqual(b)
    expect(a.kind).toBe('dials')
    expect(a.stops.length).toBe(6)
    expect(a.rate).toEqual({ digits: [...a.stops], base: 10 })
    expect(a.stopProbabilities).toEqual(a.stops.map((k) => a.nullPmf[k] as number))
    expect(a.accounting.bitsUsed).toBe(8 * a.accounting.bytesConsumed)
    expect(a.accounting.bytesConsumed).toBeGreaterThan(0)
  })

  test('uniform model: one draw per dial', async () => {
    const report = await sweepScan(
      { dials: 3, positions: 16 },
      batchSource('b', Uint8Array.from([1, 2, 3])),
      {
        model: 'uniform',
      },
    )
    expect(report.stops).toEqual([1, 2, 3])
    expect(report.accounting.bytesConsumed).toBe(3)
  })

  test('catalog: reads the list top to bottom and reports the item', async () => {
    const cat = defineCatalog('k', 'K', [
      { id: 'a', name: 'Arnica', category: 'homeo' },
      { id: 'b', name: 'Bryonia' },
      { id: 'c', name: 'Calendula' },
    ])
    const report = await sweepScan(cat, cyclingSource('c', prngBytes(256, 5)))
    expect(report.kind).toBe('catalog')
    expect(report.positions).toBe(3)
    expect(report.rate).toBeUndefined()
    expect(['a', 'b', 'c']).toContain(report.item?.id as string)
    expect(report.item?.id).toBe(cat.items[report.stops[0] as number]?.id as string)
  })

  test('validation', async () => {
    const src = cyclingSource('v', prngBytes(64, 1))
    for (const target of [
      { dials: 0, positions: 10 },
      { dials: 65, positions: 10 },
      { dials: 2, positions: 1 },
      { dials: 2, positions: 2.5 },
    ]) {
      await expect(sweepScan(target, src)).rejects.toMatchObject({ code: 'invalid_options' })
    }
    await expect(
      sweepScan({ dials: 1, positions: 4 }, src, { model: 'magic' as never }),
    ).rejects.toMatchObject({
      code: 'invalid_options',
    })
    await expect(sweepScan({ id: 'x', name: 'x', items: [] }, src)).rejects.toMatchObject({
      code: 'invalid_catalog',
    })
  })
})
