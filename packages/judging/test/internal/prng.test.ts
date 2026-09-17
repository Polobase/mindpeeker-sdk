import { describe, expect, test } from 'bun:test'
import { seedToUint64, Xoshiro128 } from '../../src/internal/prng.js'
import { expectJudgingError } from '../helpers/fixtures.js'

// The same splitmix64 → xoshiro128** stream as @mindpeeker/psi, so a seed in a
// registration means the same permutations in both packages. Reference values
// are psi's pinned outputs of an independent Python big-integer implementation.

describe('Xoshiro128 (splitmix64 → xoshiro128**)', () => {
  test('matches the reference outputs', () => {
    const cases: [bigint | number, number[]][] = [
      [0, [513008459, 2795874746, 972916236, 1374099887, 2042740824, 3697851841]],
      [42, [825760943, 2622800619, 310231447, 2495256757, 2989135795, 2459417038]],
      [(1n << 64n) - 1n, [1684066916, 570735087, 88880781, 2327579996, 1691556425, 2193366438]],
    ]
    for (const [seed, expected] of cases) {
      const rng = new Xoshiro128(seed)
      expect(Array.from({ length: 6 }, () => rng.nextUint32())).toEqual(expected)
    }
  })

  test('byte seeds fold with a length prefix; shuffle and uniformInt match', () => {
    expect(seedToUint64('00112233445566778899')).toBe(0x1ad02374fff9770n)
    const small = new Xoshiro128(7)
    expect(Array.from({ length: 12 }, () => small.uniformInt(6))).toEqual([
      4, 0, 5, 1, 3, 4, 3, 3, 0, 1, 5, 0,
    ])
    const shuffled = new Xoshiro128(2026).shuffle(Array.from({ length: 10 }, (_, i) => i))
    expect(shuffled).toEqual([6, 0, 5, 4, 2, 8, 1, 7, 9, 3])
  })

  test('invalid seeds and bounds throw invalid_options', () => {
    expectJudgingError(() => new Xoshiro128(-1), 'invalid_options')
    expectJudgingError(() => new Xoshiro128(1.5), 'invalid_options')
    expectJudgingError(() => new Xoshiro128(1n << 64n), 'invalid_options')
    expectJudgingError(() => new Xoshiro128('abc'), 'invalid_options')
    expectJudgingError(() => new Xoshiro128(new Uint8Array(0)), 'invalid_options')
    expectJudgingError(() => new Xoshiro128(0).uniformInt(0), 'invalid_options')
  })
})
