import { describe, expect, test } from 'bun:test'
import type { OracleError } from '../../../src/errors.js'
import {
  ASTRAGALUS_FACES,
  ASTRAGALUS_WEIGHTS,
  castAstragaloi,
} from '../../../src/systems/astragaloi/cast.js'

describe('castAstragaloi', () => {
  test('hagstrom fixture: [0, 1, 5, 9, 250, 3] → 1 3 4 6 3 (250 rejected)', async () => {
    // uniformInt(10): threshold 250; v mod 10 against cumulative [1, 5, 9, 10].
    const cast = await castAstragaloi(new Uint8Array([0, 1, 5, 9, 250, 3]))
    expect(cast.model).toBe('hagstrom')
    expect(cast.bones).toEqual([1, 3, 4, 6, 3])
    expect(cast.sum).toBe(17)
    expect(cast.key).toBe('13346')
    expect(cast.bytesConsumed).toBe(6)
    expect(cast.bitsUsed).toBe(48)
  })

  test('uniform fixture: 2 bits per bone', async () => {
    const cast = await castAstragaloi(new Uint8Array([0b0001_1011, 0b1100_0000]), 5, {
      model: 'uniform',
    })
    expect(cast.bones).toEqual([1, 3, 4, 6, 6])
    expect(cast.bytesConsumed).toBe(2)
    expect(cast.bitsUsed).toBe(10)
  })

  test('exhaustive single bone: hagstrom 25:100:100:25 of 250 bytes, uniform 1:1:1:1', async () => {
    expect(ASTRAGALUS_FACES).toEqual([1, 3, 4, 6])
    const hag = new Map<number, number>()
    for (let v = 0; v < 250; v++) {
      const face = (await castAstragaloi(new Uint8Array([v]), 1)).bones[0] as number
      hag.set(face, (hag.get(face) ?? 0) + 1)
    }
    expect([1, 3, 4, 6].map((f) => hag.get(f))).toEqual(
      ASTRAGALUS_WEIGHTS.hagstrom.map((w) => 25 * w),
    )
    const uni = new Map<number, number>()
    for (let v = 0; v < 4; v++) {
      const cast = await castAstragaloi(new Uint8Array([v << 6]), 1, { model: 'uniform' })
      uni.set(cast.bones[0] as number, (uni.get(cast.bones[0] as number) ?? 0) + 1)
    }
    expect([1, 3, 4, 6].map((f) => uni.get(f))).toEqual([1, 1, 1, 1])
  })

  test('exhaustive two bones (62 500 byte pairs): unordered keys match the multinomial formula', async () => {
    const counts = new Map<string, number>()
    for (let a = 0; a < 250; a++) {
      for (let b = 0; b < 250; b++) {
        const { key } = await castAstragaloi(new Uint8Array([a, b]), 2)
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
    // Expected: 2!/(n!) · Π (25 w_f)^{n_f} over the 10 unordered pairs.
    const w = new Map([
      [1, 1],
      [3, 4],
      [4, 4],
      [6, 1],
    ])
    expect(counts.size).toBe(10)
    for (const [key, count] of counts) {
      const [f, g] = [...key].map(Number) as [number, number]
      const orderings = f === g ? 1 : 2
      expect(count).toBe(orderings * 25 * (w.get(f) as number) * 25 * (w.get(g) as number))
    }
  })

  test('invalid counts and models throw invalid_input', async () => {
    const bad: [unknown, unknown][] = [
      [0, {}],
      [65, {}],
      [2.5, {}],
      [5, { model: 'dice' }],
      [5, { model: 'constructor' }],
      [5, null],
    ]
    for (const [count, opts] of bad) {
      try {
        await castAstragaloi(new Uint8Array(64), count as never, opts as never)
        expect.unreachable()
      } catch (err) {
        expect((err as OracleError).code).toBe('invalid_input')
      }
    }
  })
})
