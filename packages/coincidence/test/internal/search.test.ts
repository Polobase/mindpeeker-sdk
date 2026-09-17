import { describe, expect, test } from 'bun:test'
import { smallestSatisfying } from '../../src/internal/search.js'

describe('smallestSatisfying', () => {
  test('finds the threshold from any guess, with O(log distance) evaluations', () => {
    for (const threshold of [1, 2, 17, 1000, 123_456]) {
      for (const guess of [-5, 1, threshold - 1, threshold, threshold + 1, 10 * threshold, 1e9]) {
        let calls = 0
        const found = smallestSatisfying(
          (n) => {
            calls++
            return n >= threshold
          },
          1,
          2e6,
          guess,
        )
        expect(found).toBe(threshold)
        expect(calls).toBeLessThanOrEqual(2 * Math.ceil(Math.log2(2e6)) + 4)
      }
    }
  })

  test('returns hi when only hi satisfies, lo when everything does', () => {
    expect(smallestSatisfying((n) => n >= 50, 1, 50, 3)).toBe(50)
    expect(smallestSatisfying(() => true, 7, 50, 30)).toBe(7)
  })
})
