import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { byteReader } from '../../../src/core/reader.js'
import { OracleError } from '../../../src/errors.js'
import { castSpread } from '../../../src/systems/tarot/cast.js'
import { SPREADS } from '../../../src/systems/tarot/data.js'
import { bump, chiSquare, prngBytes } from '../../helpers/byte-sources.js'

describe('castSpread determinism fixtures (hand-computed)', () => {
  test('single, byte [0]: The Fool, upright, 1 byte / 8 bits', async () => {
    // uniformInt(78): threshold floor(256/78)*78 = 234; v = 0 accepted → card 0.
    const cast = await castSpread(new Uint8Array([0]), 'single')
    expect(cast.cards.length).toBe(1)
    expect(cast.cards[0]?.card.id).toBe('m00')
    expect(cast.cards[0]?.reversed).toBe(false)
    expect(cast.cards[0]?.position.name).toBe('The Card')
    expect(cast.bytesConsumed).toBe(1)
    expect(cast.bitsUsed).toBe(8)
  })

  test('threeCard, bytes [234, 0, 100, 200]: rejection then Fool, Three of Wands, Ace of Swords', async () => {
    // Draw 1, uniformInt(78): 234 ≥ 234 rejected; 0 → index 0 (The Fool).
    // Draw 2, uniformInt(77): threshold 231; 100 → 100 mod 77 = 23 → j = 1+23 = 24 → 'Three of Wands'.
    // Draw 3, uniformInt(76): threshold 228; 200 → 200 mod 76 = 48 → j = 2+48 = 50 → 'Ace of Swords'.
    const cast = await castSpread(new Uint8Array([234, 0, 100, 200]), 'threeCard')
    expect(cast.cards.map((c) => c.card.name)).toEqual([
      'The Fool',
      'Three of Wands',
      'Ace of Swords',
    ])
    expect(cast.cards.map((c) => c.position.name)).toEqual(['Past', 'Present', 'Future'])
    expect(cast.bytesConsumed).toBe(4)
    expect(cast.bitsUsed).toBe(32) // rejected draws still spend entropy
  })

  test('reversals consume exactly one MSB-first bit per card, after all draws', async () => {
    // Same three cards as above, then reversal bits from 0b1010_0000: [1, 0, 1].
    const cast = await castSpread(new Uint8Array([234, 0, 100, 200, 0b1010_0000]), 'threeCard', {
      reversals: true,
    })
    expect(cast.cards.map((c) => c.reversed)).toEqual([true, false, true])
    expect(cast.bytesConsumed).toBe(5)
    expect(cast.bitsUsed).toBe(32 + 3)
  })

  test('celticCross deals 10 distinct cards', async () => {
    const cast = await castSpread(prngBytes(32, 0xcc), 'celticCross', { reversals: true })
    expect(cast.cards.length).toBe(10)
    expect(new Set(cast.cards.map((c) => c.card.id)).size).toBe(10)
    expect(cast.spread.id).toBe('celticCross')
  })

  test('accepts a custom spread object', async () => {
    const custom = {
      id: 'pair',
      name: 'Pair',
      positions: [
        { name: 'A', meaning: 'first' },
        { name: 'B', meaning: 'second' },
      ],
    }
    const cast = await castSpread(prngBytes(8), custom)
    expect(cast.spread).toEqual(custom)
    expect(cast.cards.length).toBe(2)
  })

  test('a custom spread is stored as a frozen defensive copy', async () => {
    const custom = {
      id: 'pair',
      name: 'Pair',
      extra: 'kept',
      positions: [
        { name: 'A', meaning: 'first' },
        { name: 'B', meaning: 'second' },
      ],
    }
    const cast = await castSpread(prngBytes(8), custom)
    expect(cast.spread).not.toBe(custom)
    expect(Object.isFrozen(cast.spread)).toBe(true)
    expect(Object.isFrozen(cast.spread.positions)).toBe(true)
    expect(Object.isFrozen(cast.spread.positions[0])).toBe(true)
    expect((cast.spread as typeof custom).extra).toBe('kept')
    custom.positions[0] = { name: 'mutated', meaning: 'later' }
    custom.name = 'mutated'
    expect(cast.spread.name).toBe('Pair')
    expect(cast.spread.positions[0]?.name).toBe('A')
    expect(cast.cards[0]?.position.name).toBe('A')
  })

  test('built-in spreads are passed through by identity', async () => {
    const cast = await castSpread(prngBytes(16), SPREADS.threeCard)
    expect(cast.spread).toBe(SPREADS.threeCard)
    expect((await castSpread(prngBytes(16), 'celticCross')).spread).toBe(SPREADS.celticCross)
  })

  test('unknown, inherited, malformed, empty, or oversized spreads throw invalid_spread', async () => {
    const position = { name: 'p', meaning: 'm' }
    const bad: unknown[] = [
      'horseshoe',
      'constructor',
      '__proto__',
      'toString',
      null,
      42,
      { id: 'x', name: 'x', positions: [] },
      { id: 'x', name: 'x', positions: 'abc' },
      { id: 'x', name: 'x' },
      { id: 'x', name: 'x', positions: [null] },
      { id: 'x', name: 'x', positions: [{ name: 'p' }] },
      { id: 'x', name: 'x', positions: new Array(2) },
      { id: 1, name: 'x', positions: [position] },
      { id: 'x', name: 'x', positions: new Array(79).fill(position) },
    ]
    for (const spread of bad) {
      try {
        await castSpread(new Uint8Array(128), spread as never)
        expect.unreachable()
      } catch (err) {
        expect(err).toBeInstanceOf(OracleError)
        expect((err as OracleError).code).toBe('invalid_spread')
      }
    }
    const full = await castSpread(prngBytes(512, 0x78), {
      id: 'deck',
      name: 'Deck',
      positions: new Array(78).fill(position),
    })
    expect(new Set(full.cards.map((c) => c.card.id)).size).toBe(78)
  })

  test('non-boolean reversals throw invalid_input instead of silently meaning "off"', async () => {
    for (const reversals of [1, 'true', 'on', {}, null]) {
      try {
        await castSpread(new Uint8Array([0, 0xff]), 'single', { reversals: reversals as never })
        expect.unreachable()
      } catch (err) {
        expect((err as OracleError).code).toBe('invalid_input')
      }
    }
  })

  test('finite input ending mid-spread throws insufficient_entropy', async () => {
    await expect(castSpread(new Uint8Array([0]), 'threeCard')).rejects.toMatchObject({
      code: 'insufficient_entropy',
    })
  })
})

describe('castSpread distribution (seeded PRNG)', () => {
  const fixture = JSON.parse(
    readFileSync(join(import.meta.dir, '..', '..', 'fixtures', 'chi2-critical.json'), 'utf8'),
  ) as { alpha: number; critical: Record<string, number> }

  test('single-card draws are uniform over 78 — chi-square df=77', async () => {
    const draws = 19_500 // expected 250 per card
    const reader = byteReader(prngBytes(Math.ceil(draws * 1.2), 0x7a07))
    const counts = new Array<number>(78).fill(0)
    for (let i = 0; i < draws; i++) {
      const cast = await castSpread(reader, 'single')
      bump(counts, cast.cards[0]?.card.index as number)
    }
    const expected = new Array<number>(78).fill(draws / 78)
    expect(chiSquare(counts, expected)).toBeLessThan(fixture.critical['77'] as number)
  })

  test('reversal bits are balanced (exact binomial bound, seeded)', async () => {
    const draws = 4_000
    // each cast: ~1.09 bytes for the draw + 1 byte for its reversal bit
    const reader = byteReader(prngBytes(10_000, 0xbeef))
    let reversed = 0
    for (let i = 0; i < draws; i++) {
      const cast = await castSpread(reader, 'single', { reversals: true })
      if (cast.cards[0]?.reversed) reversed++
    }
    // ±4σ around n/2 with σ = √(n/4): deterministic seed, generous bound.
    const sigma = Math.sqrt(draws / 4)
    expect(Math.abs(reversed - draws / 2)).toBeLessThan(4 * sigma)
  })
})
