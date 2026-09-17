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
  /** A boolean, or [upright, reversed] integer weights. */
  readonly reversals: boolean | readonly [number, number]
  readonly value: number
}

const reversalsOf = (c: Case) =>
  typeof c.reversals === 'boolean'
    ? c.reversals
    : { upright: c.reversals[0], reversed: c.reversals[1] }

const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'fixtures', 'expected-bytes.json'), 'utf8'),
) as { readonly cases: readonly Case[] }

describe('expectedBytes', () => {
  test.each(
    fixture.cases.map((c) => [c.name, c] as const),
  )('matches the exact-rational fixture: %s', (_name, c) => {
    expect(expectedBytes({ n: c.n, count: c.count, reversals: reversalsOf(c) })).toBeCloseTo(
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

  test('significator: a spread is dealt from 77 cards (fixture), also for a spread object', () => {
    const waite = fixture.cases.find((c) => c.name === 'celticCrossWaite+significator') as Case
    const waiteRev = fixture.cases.find(
      (c) => c.name === 'celticCrossWaite+significator+reversals',
    ) as Case
    expect(expectedBytes('celticCrossWaite', { significator: 'p12' })).toBeCloseTo(waite.value, 10)
    expect(
      expectedBytes(SPREADS.celticCrossWaite, { significator: 'm11', reversals: true }),
    ).toBeCloseTo(waiteRev.value, 10)
  })

  test('reversal weights on spreads: dyadic k bits per card, otherwise one rejection draw per card', () => {
    const find = (name: string) => fixture.cases.find((c) => c.name === name) as Case
    expect(expectedBytes('threeCard', { reversals: { reversed: 1, upright: 3 } })).toBeCloseTo(
      find('threeCard+reversed1-upright3').value,
      10,
    )
    expect(expectedBytes('celticCross', { reversals: { reversed: 1, upright: 2 } })).toBeCloseTo(
      find('celticCross+reversed1-upright2').value,
      10,
    )
    // {1, 1} is exactly `true`; {0, 1} costs nothing.
    expect(expectedBytes('celticCross', { reversals: { reversed: 1, upright: 1 } })).toBe(
      expectedBytes('celticCross', { reversals: true }),
    )
    expect(expectedBytes('single', { reversals: { reversed: 0, upright: 1 } })).toBe(
      expectedBytes('single'),
    )
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
      { n: 3, count: 1, reversals: { reversed: -1, upright: 2 } },
      { n: 3, count: 1, reversals: { reversed: 0, upright: 0 } },
    ]
    for (const spec of bad) {
      try {
        expectedBytes(spec as never)
        expect.unreachable()
      } catch (err) {
        expect((err as OracleError).code).toBe('invalid_input')
      }
    }
    const badOpts: [unknown, unknown][] = [
      [{ n: 78, count: 1 }, { significator: 'm00' }], // DealSpec states n itself
      ['single', { significator: 'x99' }],
      ['single', null],
    ]
    for (const [spec, opts] of badOpts) {
      try {
        expectedBytes(spec as never, opts as never)
        expect.unreachable()
      } catch (err) {
        expect((err as OracleError).code).toBe('invalid_input')
      }
    }
    try {
      const deck = {
        id: 'deck',
        name: 'Deck',
        positions: new Array(78).fill({ name: 'p', meaning: 'm' }),
      }
      expectedBytes(deck, { significator: 'm00' })
      expect.unreachable()
    } catch (err) {
      expect((err as OracleError).code).toBe('invalid_spread')
    }
    try {
      expectedBytes('constructor' as never)
      expect.unreachable()
    } catch (err) {
      expect((err as OracleError).code).toBe('invalid_spread')
    }
  })
})
