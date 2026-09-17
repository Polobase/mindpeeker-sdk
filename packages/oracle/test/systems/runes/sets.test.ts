import { describe, expect, test } from 'bun:test'
import { byteReader } from '../../../src/core/reader.js'
import type { OracleError } from '../../../src/errors.js'
import { castRunes } from '../../../src/systems/runes/cast.js'
import { castRuneSets } from '../../../src/systems/runes/sets.js'
import { liveSource, prngBytes } from '../../helpers/byte-sources.js'

describe('castRuneSets (sets with replacement between sets)', () => {
  test('default 3 + 3 + 1: runes return to the pouch, so all-zero bytes repeat the first runes', async () => {
    const cast = await castRuneSets(new Uint8Array(7))
    expect(cast.sets.map((set) => set.map((r) => r.rune.id))).toEqual([
      ['fehu', 'uruz', 'thurisaz'],
      ['fehu', 'uruz', 'thurisaz'],
      ['fehu'],
    ])
    expect(cast.bytesConsumed).toBe(7)
    expect(cast.bitsUsed).toBe(56)
    expect(Object.isFrozen(cast.sets)).toBe(true)
  })

  test('identical to consecutive castRunes calls on one reader (runes and accounting)', async () => {
    for (let seed = 1; seed <= 25; seed++) {
      const opts = { merkstave: true, blank: seed % 2 === 0 }
      const sets = await castRuneSets(prngBytes(64, seed), [3, 3, 1], opts)
      const reader = byteReader(prngBytes(64, seed))
      let bytes = 0
      let bits = 0
      for (const [j, size] of [3, 3, 1].entries()) {
        const single = await castRunes(reader, size, opts)
        expect(sets.sets[j]).toEqual(single.runes)
        bytes += single.bytesConsumed
        bits += single.bitsUsed
      }
      expect(sets.bytesConsumed).toBe(bytes)
      expect(sets.bitsUsed).toBe(bits)
    }
  })

  test('exhaustive independence of two single-rune sets from the Younger Futhark: 256 per pair', async () => {
    const counts = new Map<string, number>()
    for (let a = 0; a < 256; a++) {
      for (let b = 0; b < 256; b++) {
        const cast = await castRuneSets(new Uint8Array([a, b]), [1, 1], { futhark: 'younger' })
        const key = cast.sets.map((set) => set[0]?.rune.id).join('/')
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
    expect(counts.size).toBe(256) // includes pairs with the same rune twice
    for (const count of counts.values()) expect(count).toBe(256)
  })

  test('closes the stream it opened', async () => {
    const source = liveSource('pouch')
    await castRuneSets(source)
    expect(source.finalized).toBe(source.opened)
  })

  test('invalid sizes throw invalid_input', async () => {
    for (const sizes of [[], [0], [25], [1.5], 'three', new Array(65).fill(1)]) {
      try {
        await castRuneSets(prngBytes(64), sizes as never)
        expect.unreachable()
      } catch (err) {
        expect((err as OracleError).code).toBe('invalid_input')
      }
    }
  })
})
