import { describe, expect, test } from 'bun:test'
import {
  byteReader,
  castHexagram,
  castRunes,
  castShield,
  castSpread,
  ELDER_FUTHARK,
  GEOMANTIC_FIGURES,
  HEXAGRAMS,
  type OracleError,
  SPREADS,
  TAROT_DECK,
} from '../src/index.js'
import { countingSource, prngBytes } from './helpers/byte-sources.js'

describe('public surface', () => {
  test('data tables are exported with the documented sizes', () => {
    expect(HEXAGRAMS.length).toBe(64)
    expect(TAROT_DECK.length).toBe(78)
    expect(ELDER_FUTHARK.length).toBe(24)
    expect(GEOMANTIC_FIGURES.length).toBe(16)
    expect(Object.keys(SPREADS)).toEqual(['single', 'threeCard', 'celticCross'])
  })

  test('every cast works straight off a live ByteSource', async () => {
    const source = countingSource('qrng-sim', 16, 0xfeed)
    const hex = await castHexagram(source, { method: 'yarrow' })
    expect(hex.primary.kingWen).toBeGreaterThanOrEqual(1)
    const spread = await castSpread(source, 'threeCard', { reversals: true })
    expect(spread.cards.length).toBe(3)
    const runes = await castRunes(source, 3, { merkstave: true })
    expect(runes.runes.length).toBe(3)
    const shield = await castShield(source)
    expect(shield.judge.points % 2).toBe(0)
  })

  test('several casts can share one reader; accounting reports per-cast deltas', async () => {
    const reader = byteReader(prngBytes(64, 0xacc0))
    const first = await castShield(reader)
    const second = await castShield(reader)
    expect(first.bytesConsumed).toBe(2)
    expect(second.bytesConsumed).toBe(2)
    expect(reader.bytesConsumed).toBe(4)
  })

  test('entropy accounting invariant: bitsUsed ≤ 8 × bytesConsumed', async () => {
    const results = [
      await castHexagram(prngBytes(8, 1)),
      await castHexagram(prngBytes(8, 2), { method: 'yarrow' }),
      await castSpread(prngBytes(32, 3), 'celticCross', { reversals: true }),
      await castRunes(prngBytes(16, 4), 5, { merkstave: true }),
      await castShield(prngBytes(4, 5)),
    ]
    for (const r of results) {
      expect(r.bitsUsed).toBeGreaterThan(0)
      expect(r.bitsUsed).toBeLessThanOrEqual(8 * r.bytesConsumed)
    }
  })

  test('cast results are frozen', async () => {
    const cast = await castHexagram(prngBytes(3, 6))
    expect(Object.isFrozen(cast)).toBe(true)
    expect(Object.isFrozen(cast.lines)).toBe(true)
    expect(Object.isFrozen(cast.lines[0])).toBe(true)
  })

  test('an aborted signal aborts a cast over a slow stream', async () => {
    const controller = new AbortController()
    const stalled: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
    }
    const pending = castSpread(stalled, 'single', { signal: controller.signal })
    controller.abort()
    try {
      await pending
      expect.unreachable()
    } catch (err) {
      expect((err as OracleError).code).toBe('aborted')
    }
  })

  test('signal is forwarded to a ByteSource stream', async () => {
    let received: AbortSignal | undefined
    const source = {
      name: 'signal-check',
      stream(opts?: { signal?: AbortSignal }) {
        received = opts?.signal
        return (async function* () {
          while (true) yield prngBytes(8, 7)
        })()
      },
    }
    const controller = new AbortController()
    await castShield(source, { signal: controller.signal })
    expect(received).toBe(controller.signal)
  })
})
