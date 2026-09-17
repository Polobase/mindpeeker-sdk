import { describe, expect, test } from 'bun:test'
import { byteReader } from '../../src/core/reader.js'
import { recordingReader } from '../../src/core/recording.js'
import { uniformInt } from '../../src/core/uniform.js'
import { OracleError } from '../../src/errors.js'
import { castShield } from '../../src/systems/geomancy/cast.js'
import { castHexagram } from '../../src/systems/iching/cast.js'
import { castRunes } from '../../src/systems/runes/cast.js'
import { castSpread } from '../../src/systems/tarot/cast.js'
import { liveSource, stalledIterable } from '../helpers/byte-sources.js'

describe('recordingReader', () => {
  test('captures every consumed byte, including rejected ones', async () => {
    // n = 100: 200 and 255 are rejected, 5 accepted.
    const rec = recordingReader(new Uint8Array([200, 255, 5, 9]))
    expect(await uniformInt(rec.reader, 100)).toBe(5)
    expect([...rec.bytes()]).toEqual([200, 255, 5])
    expect(rec.reader.bytesConsumed).toBe(3)
  })

  test('bytes() returns a copy that grows past the initial buffer', async () => {
    const source = liveSource('big', 64)
    const rec = recordingReader(source)
    const seen: number[] = []
    for (let i = 0; i < 300; i++) seen.push(await rec.reader.next())
    const snapshot = rec.bytes()
    expect([...snapshot]).toEqual(seen)
    snapshot[0] = (snapshot[0] as number) ^ 0xff
    expect(rec.bytes()[0]).toBe(seen[0] as number)
    await rec.reader.close()
  })

  test('a live reading replays exactly from the recorded bytes (all four casts)', async () => {
    const source = liveSource('qrng-sim', 32, 0x5eed)
    const rec = recordingReader(source)
    const live = {
      hex: await castHexagram(rec.reader, { method: 'yarrow' }),
      spread: await castSpread(rec.reader, 'celticCross', { reversals: true }),
      runes: await castRunes(rec.reader, 7, { merkstave: true }),
      shield: await castShield(rec.reader),
    }
    // casts never close a caller-supplied reader
    expect(source.finalized).toBe(0)
    await rec.reader.close()
    expect(source.finalized).toBe(1)

    const replay = byteReader(rec.bytes())
    const again = {
      hex: await castHexagram(replay, { method: 'yarrow' }),
      spread: await castSpread(replay, 'celticCross', { reversals: true }),
      runes: await castRunes(replay, 7, { merkstave: true }),
      shield: await castShield(replay),
    }
    expect(again.hex.lines).toEqual(live.hex.lines)
    expect(again.spread.cards).toEqual(live.spread.cards)
    expect(again.runes.runes).toEqual(live.runes.runes)
    expect(again.shield.mothers).toEqual(live.shield.mothers)
    expect(replay.bytesConsumed).toBe(rec.bytes().length)
    const consumed =
      live.hex.bytesConsumed +
      live.spread.bytesConsumed +
      live.runes.bytesConsumed +
      live.shield.bytesConsumed
    expect(consumed).toBe(rec.bytes().length)
  })

  test('closing a recorder over a shared reader leaves the shared reader open', async () => {
    const source = liveSource('shared', 8)
    const shared = byteReader(source)
    const rec = recordingReader(shared)
    await rec.reader.next()
    await rec.reader.close()
    expect(source.finalized).toBe(0)
    await expect(rec.reader.next()).rejects.toMatchObject({ code: 'closed' })
    expect(typeof (await shared.next())).toBe('number')
    await shared.close()
  })

  test('honours a signal and invalid options like byteReader', async () => {
    const controller = new AbortController()
    const rec = recordingReader(stalledIterable(), { signal: controller.signal })
    const pending = rec.reader.next()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
    expect(rec.bytes().length).toBe(0)
    expect(() => recordingReader(new Uint8Array(1), { chunkBytes: -1 })).toThrow(OracleError)
  })

  test('supports await using', async () => {
    const source = liveSource('scoped', 8)
    {
      await using reader = recordingReader(source).reader
      await reader.next()
    }
    expect(source.finalized).toBe(1)
  })
})
