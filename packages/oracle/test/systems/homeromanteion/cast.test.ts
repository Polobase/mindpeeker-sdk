import { describe, expect, test } from 'bun:test'
import { castHomeromanteion } from '../../../src/systems/homeromanteion/cast.js'

describe('castHomeromanteion (PGM VII.1–148)', () => {
  test('papyrus numbering: 1-1-1 is #1, 6-6-3 is #213, 6-6-6 is #216', async () => {
    const first = await castHomeromanteion(new Uint8Array([0, 0, 0]))
    expect(first.dice).toEqual([1, 1, 1])
    expect(first.index).toBe(1)
    expect((await castHomeromanteion(new Uint8Array([5, 5, 2]))).index).toBe(213)
    const last = await castHomeromanteion(new Uint8Array([5, 5, 5]))
    expect(last.index).toBe(216)
    expect(last.bytesConsumed).toBe(3)
    expect(last.bitsUsed).toBe(24)
  })

  test('the 216 dice triples map one-to-one, lexicographically, onto 1..216', async () => {
    const seen: number[] = []
    for (let a = 0; a < 6; a++) {
      for (let b = 0; b < 6; b++) {
        for (let c = 0; c < 6; c++) {
          seen.push((await castHomeromanteion(new Uint8Array([a, b, c]))).index)
        }
      }
    }
    expect(seen).toEqual(Array.from({ length: 216 }, (_, i) => i + 1))
  })

  test('each die is uniform over its accepted bytes (42 per face); a rejected byte is spent', async () => {
    const faces = new Array<number>(7).fill(0)
    for (let v = 0; v < 252; v++) {
      const cast = await castHomeromanteion(new Uint8Array([0, v, 0]))
      faces[cast.dice[1]] = (faces[cast.dice[1]] as number) + 1
    }
    expect(faces.slice(1)).toEqual([42, 42, 42, 42, 42, 42])
    const rejected = await castHomeromanteion(new Uint8Array([255, 0, 0, 0]))
    expect(rejected.dice).toEqual([1, 1, 1])
    expect(rejected.bytesConsumed).toBe(4)
  })
})
