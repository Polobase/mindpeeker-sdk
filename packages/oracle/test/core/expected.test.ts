import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expectedBytes } from '../../src/core/expected.js'
import { byteReader } from '../../src/core/reader.js'
import type { OracleError } from '../../src/errors.js'
import { castSpread } from '../../src/systems/tarot/cast.js'
import { SPREADS } from '../../src/systems/tarot/data.js'
import { prngBytes } from '../helpers/byte-sources.js'

interface Case {
  readonly name: string
  readonly n: number
  readonly count: number
  readonly reversals: boolean
  readonly value: number
}

const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'fixtures', 'expected-bytes.json'), 'utf8'),
) as { readonly cases: readonly Case[] }

describe('expectedBytes', () => {
  test.each(
    fixture.cases.map((c) => [c.name, c] as const),
  )('matches the exact-rational fixture: %s', (_name, c) => {
    expect(expectedBytes({ n: c.n, count: c.count, reversals: c.reversals })).toBeCloseTo(
      c.value,
      10,
    )
  })

  test('spreads and spread names use the 78-card deck; a Celtic Cross with reversals ≈ 13.63', () => {
    const celtic = fixture.cases.find((c) => c.name === 'celticCross+reversals') as Case
    expect(expectedBytes('celticCross', { reversals: true })).toBeCloseTo(celtic.value, 10)
    expect(expectedBytes(SPREADS.celticCross, { reversals: true })).toBeCloseTo(13.63, 2)
    expect(expectedBytes('single')).toBeCloseTo(256 / 234, 12) // 1 byte / (234/256)
    const custom = { id: 'x', name: 'x', positions: [{ name: 'a', meaning: 'a' }] }
    expect(expectedBytes(custom)).toBe(expectedBytes('single'))
  })

  test('n = 1 and count = 0 cost nothing; a DealSpec reversals flag wins over opts', () => {
    expect(expectedBytes({ n: 1, count: 1 })).toBe(0)
    expect(expectedBytes({ n: 0, count: 0, reversals: true })).toBe(0)
    expect(expectedBytes({ n: 256, count: 1, reversals: false }, { reversals: true })).toBe(1)
    expect(expectedBytes({ n: 256, count: 9 }, { reversals: true })).toBeGreaterThan(11)
  })

  test('agrees with the empirical mean consumption of seeded Celtic Cross casts', async () => {
    const casts = 4_000
    const reader = byteReader(prngBytes(casts * 20, 0xe8b7))
    let total = 0
    for (let i = 0; i < casts; i++) {
      total += (await castSpread(reader, 'celticCross', { reversals: true })).bytesConsumed
    }
    const mean = total / casts
    // Per-cast sd is < 1.5 bytes, so the sd of the mean is < 0.03: 0.15 is > 5 sd.
    expect(Math.abs(mean - expectedBytes('celticCross', { reversals: true }))).toBeLessThan(0.15)
  })

  test('rejects invalid specs', () => {
    const bad: unknown[] = [
      null,
      42,
      { n: -1, count: 0 },
      { n: 2 ** 48 + 1, count: 1 },
      { n: 3, count: 4 },
      { n: 3.5, count: 1 },
      { n: 3, count: 1, reversals: 'yes' },
    ]
    for (const spec of bad) {
      try {
        expectedBytes(spec as never)
        expect.unreachable()
      } catch (err) {
        expect((err as OracleError).code).toBe('invalid_input')
      }
    }
    try {
      expectedBytes('constructor' as never)
      expect.unreachable()
    } catch (err) {
      expect((err as OracleError).code).toBe('invalid_spread')
    }
  })
})
