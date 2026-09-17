import { describe, expect, test } from 'bun:test'
import * as oracle from '../src/index.js'
import {
  byteReader,
  castHexagram,
  castRunes,
  castShield,
  castSpread,
  DEFAULT_CAST_CHUNK_BYTES,
  ELDER_FUTHARK,
  expectedBytes,
  GEOMANTIC_FIGURES,
  HEXAGRAMS,
  type OracleError,
  recordingReader,
  SPREADS,
  TAROT_DECK,
  weightedIndexRational,
} from '../src/index.js'
import { countingSource, liveSource, prngBytes } from './helpers/byte-sources.js'

describe('public surface', () => {
  test('data tables are exported with the documented sizes', () => {
    expect(HEXAGRAMS.length).toBe(64)
    expect(TAROT_DECK.length).toBe(78)
    expect(ELDER_FUTHARK.length).toBe(24)
    expect(GEOMANTIC_FIGURES.length).toBe(16)
    expect(Object.keys(SPREADS)).toEqual(['single', 'threeCard', 'celticCross', 'celticCrossWaite'])
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

  test('0.2 additions are exported', () => {
    expect(typeof recordingReader).toBe('function')
    expect(typeof expectedBytes).toBe('function')
    expect(typeof weightedIndexRational).toBe('function')
    expect(DEFAULT_CAST_CHUNK_BYTES).toBe(32)
  })

  test('0.2 systems and helpers are exported from the root', () => {
    const fns = [
      oracle.castOdu,
      oracle.castCowries,
      oracle.castLot,
      oracle.castMo,
      oracle.castAstragaloi,
      oracle.castHomeromanteion,
      oracle.castRuneSets,
      oracle.reconciler,
      oracle.partOfFortune,
      oracle.houses,
      oracle.figureElement,
      oracle.nuclearHexagram,
      oracle.inverseHexagram,
      oracle.oppositeHexagram,
      oracle.fuXiNumber,
      oracle.hexagramFromFuXi,
      oracle.oduFromBinary,
    ]
    for (const fn of fns) expect(typeof fn).toBe('function')
    expect(oracle.ODU_FIGURES.length).toBe(16)
    expect(oracle.COWRIE_ODU.length).toBe(17)
    expect(oracle.MO_SYLLABLES.length).toBe(6)
    expect(oracle.YOUNGER_FUTHARK.length).toBe(16)
    expect(Object.keys(oracle.FUTHARKS)).toEqual([
      'elder',
      'younger',
      'futhorc28',
      'futhorc29',
      'futhorc33',
    ])
    expect(Object.keys(oracle.HOUSE_SYSTEMS)).toEqual(['sequential', 'goldenDawn'])
    expect(Object.keys(oracle.RUNE_LAYOUTS)).toEqual(['norns'])
    expect(oracle.JIAOBEI_WEIGHTS).toEqual([2, 1, 1])
    expect(oracle.ASTRAGALUS_WEIGHTS.hagstrom).toEqual([1, 4, 4, 1])
    expect(oracle.LEGGE_NAMES[1]).toBe('Khien')
    expect(oracle.FUTHORC_28.length + oracle.FUTHORC_29.length + oracle.FUTHORC_33.length).toBe(90)
  })

  test('README usage: one-off casts release the source; a shared reader is closed by await using', async () => {
    const src = liveSource('crypto-sim', 1024)
    await castHexagram(src, { method: 'yarrow' })
    await castSpread(src, 'celticCross', { reversals: true })
    expect(src.opened).toBe(2)
    expect(src.finalized).toBe(2)
    {
      await using reader = byteReader(src)
      const runes = await castRunes(reader, 3, { merkstave: true })
      const shield = await castShield(reader)
      expect(runes.runes.length + shield.mothers.length).toBe(7)
      expect(src.finalized).toBe(2)
    }
    expect(src.opened).toBe(3)
    expect(src.finalized).toBe(3)
  })
})
