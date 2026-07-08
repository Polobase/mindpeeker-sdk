import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { byteReader } from '../../../src/core/reader.js'
import { castShield, houses } from '../../../src/systems/geomancy/cast.js'
import { chiSquare, prngBytes } from '../../helpers/byte-sources.js'

/** Bytes whose 16 MSB-first bits produce the given four mother binaries. */
function bytesForMothers(m1: string, m2: string, m3: string, m4: string): Uint8Array {
  const bits = m1 + m2 + m3 + m4
  return new Uint8Array([Number.parseInt(bits.slice(0, 8), 2), Number.parseInt(bits.slice(8), 2)])
}

describe('castShield worked example (The Digital Ambler, "How to Construct the Shield Chart of Geomancy", 2020)', () => {
  test('Mothers Populus, Populus, Puella, Via reproduce the published chart', async () => {
    // Published example: Mothers Populus (0000), Populus (0000), Puella (1011),
    // Via (1111) → Daughters Fortuna Major, Tristitia, Fortuna Major, Fortuna
    // Major → Nieces Populus, Rubeus, Albus, Populus → Witnesses Rubeus (right),
    // Albus (left) → Judge Conjunctio.
    const cast = await castShield(bytesForMothers('0000', '0000', '1011', '1111'))
    expect(cast.mothers.map((f) => f.name)).toEqual(['Populus', 'Populus', 'Puella', 'Via'])
    expect(cast.daughters.map((f) => f.name)).toEqual([
      'Fortuna Major',
      'Tristitia',
      'Fortuna Major',
      'Fortuna Major',
    ])
    expect(cast.nieces.map((f) => f.name)).toEqual(['Populus', 'Rubeus', 'Albus', 'Populus'])
    expect(cast.witnesses.map((f) => f.name)).toEqual(['Rubeus', 'Albus'])
    expect(cast.judge.name).toBe('Conjunctio')
    expect(cast.bytesConsumed).toBe(2)
    expect(cast.bitsUsed).toBe(16)
  })
})

describe('castShield structure', () => {
  test('all-ones input: four Via mothers collapse to a Populus judge', async () => {
    const cast = await castShield(new Uint8Array([0xff, 0xff]))
    expect(cast.mothers.every((f) => f.id === 'via')).toBe(true)
    expect(cast.daughters.every((f) => f.id === 'via')).toBe(true)
    expect(cast.nieces.every((f) => f.id === 'populus')).toBe(true)
    expect(cast.judge.id).toBe('populus')
  })

  test('daughter k row m equals mother m row k (transposition)', async () => {
    const cast = await castShield(prngBytes(2, 0x9e0))
    for (let k = 0; k < 4; k++) {
      for (let m = 0; m < 4; m++) {
        expect(cast.daughters[k]?.pattern[m]).toBe(cast.mothers[m]?.pattern[k] as 0 | 1)
      }
    }
  })

  test('exhaustive over all 2^16 charts: the Judge always has an even point total', async () => {
    // The classical validity criterion (Greer 2009): only the eight even
    // figures can be the Judge. Judge parity is even because every mother
    // bit enters the XOR pipeline exactly twice (once via Mothers, once via
    // Daughters).
    for (let v = 0; v < 65_536; v++) {
      const cast = await castShield(new Uint8Array([v >>> 8, v & 0xff]))
      expect(cast.judge.points % 2).toBe(0)
    }
  })

  test('houses projection: Mothers 1-4, Daughters 5-8, Nieces 9-12', async () => {
    const cast = await castShield(prngBytes(2, 0x40e))
    const chart = houses(cast)
    expect(chart.length).toBe(12)
    expect(chart.slice(0, 4)).toEqual([...cast.mothers])
    expect(chart.slice(4, 8)).toEqual([...cast.daughters])
    expect(chart.slice(8, 12)).toEqual([...cast.nieces])
    expect(Object.isFrozen(chart)).toBe(true)
  })

  test('insufficient bytes throw insufficient_entropy', async () => {
    expect(castShield(new Uint8Array([0xff]))).rejects.toMatchObject({
      code: 'insufficient_entropy',
    })
  })
})

describe('castShield distribution (seeded PRNG)', () => {
  const fixture = JSON.parse(
    readFileSync(join(import.meta.dir, '..', '..', 'fixtures', 'chi2-critical.json'), 'utf8'),
  ) as { alpha: number; critical: Record<string, number> }

  test('first mother is uniform over the 16 figures — chi-square df=15', async () => {
    const casts = 8_000
    const reader = byteReader(prngBytes(2 * casts, 0x16f))
    const counts = new Map<string, number>()
    for (let i = 0; i < casts; i++) {
      const cast = await castShield(reader)
      const id = cast.mothers[0]?.id as string
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    expect(counts.size).toBe(16)
    const observed = [...counts.values()]
    const expected = new Array<number>(16).fill(casts / 16)
    expect(chiSquare(observed, expected)).toBeLessThan(fixture.critical['15'] as number)
  })
})
