import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { byteReader } from '../../../src/core/reader.js'
import type { OracleError } from '../../../src/errors.js'
import { castSpread } from '../../../src/systems/tarot/cast.js'
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
    expect(cast.spread).toBe(custom)
    expect(cast.cards.length).toBe(2)
  })

  test('unknown spread name / empty spread throw invalid_spread', async () => {
    for (const bad of ['horseshoe' as never, { id: 'x', name: 'x', positions: [] }]) {
      try {
        await castSpread(new Uint8Array(8), bad)
        expect.unreachable()
      } catch (err) {
        expect((err as OracleError).code).toBe('invalid_spread')
      }
    }
  })

  test('finite input ending mid-spread throws insufficient_entropy', async () => {
    expect(castSpread(new Uint8Array([0]), 'threeCard')).rejects.toMatchObject({
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
