import { describe, expect, test } from 'bun:test'
import { planReplay } from '../../src/server/replay.js'

/** A fake frame of `size` bytes, tagged for identity. */
const frame = (tag: string, size: number) => ({ tag, byteLength: size })
const tags = (plan: { tag: string }[][]) => plan.map((frames) => frames.map((f) => f.tag))

describe('planReplay', () => {
  test('everything is replayed, oldest first, when the budget allows', () => {
    const rings = [[frame('a1', 10), frame('a2', 10)], [], [frame('c1', 5)]]
    expect(tags(planReplay(rings, 1_000))).toEqual([['a1', 'a2'], [], ['c1']])
  })

  test('each channel keeps a contiguous newest suffix; the budget is shared round-robin', () => {
    const rings = [
      [frame('a1', 10), frame('a2', 10), frame('a3', 10)],
      [frame('b1', 5), frame('b2', 5)],
    ]
    // round 1: a3 (12 left), b2 (7 left); round 2: a2 does not fit → a stops; b1 (2 left)
    expect(tags(planReplay(rings, 22))).toEqual([['a3'], ['b1', 'b2']])
  })

  test('a channel stops at the first frame that does not fit, never skipping to older ones', () => {
    const rings = [[frame('small-old', 1), frame('big', 100), frame('new', 1)]]
    expect(tags(planReplay(rings, 50))).toEqual([['new']])
  })

  test('the chosen bytes never exceed the budget', () => {
    const rings = Array.from({ length: 5 }, (_, c) =>
      Array.from({ length: 40 }, (_, i) => frame(`${c}.${i}`, 1 + ((c * 7 + i * 13) % 23))),
    )
    for (const budget of [0, 1, 17, 100, 333, 1_000, 10_000]) {
      const plan = planReplay(rings, budget)
      const bytes = plan.flat().reduce((sum, f) => sum + f.byteLength, 0)
      expect(bytes).toBeLessThanOrEqual(budget)
      plan.forEach((frames, c) => {
        const ring = rings[c] as { tag: string; byteLength: number }[]
        expect(frames).toEqual(ring.slice(ring.length - frames.length))
      })
    }
  })

  test('a non-positive or NaN budget replays nothing', () => {
    const rings = [[frame('a', 1)]]
    for (const budget of [0, -5, Number.NaN]) expect(tags(planReplay(rings, budget))).toEqual([[]])
  })
})
