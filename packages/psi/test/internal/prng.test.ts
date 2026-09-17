import { describe, expect, test } from 'bun:test'
import { seedToUint64, Xoshiro128 } from '../../src/internal/prng.js'

// Reference values from an independent Python big-integer implementation of
// splitmix64 → xoshiro128** (scratch script prng_ref.py, pinned here). The
// splitmix64 first output for state 0 is the published 0xe220a8397b1dcdaf.

describe('Xoshiro128 (splitmix64 → xoshiro128**)', () => {
  test('matches the independent reference outputs', () => {
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

  test('byte seeds fold with a length prefix; hex and bytes agree', () => {
    expect(seedToUint64('00112233445566778899')).toBe(0x1ad02374fff9770n)
    const bytes = Uint8Array.from([0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99])
    expect(seedToUint64(bytes)).toBe(0x1ad02374fff9770n)
    const rng = new Xoshiro128('00112233445566778899')
    expect(Array.from({ length: 4 }, () => rng.nextUint32())).toEqual([
      2074136817, 590443222, 2925427517, 2331466076,
    ])
    expect(seedToUint64(Uint8Array.from([1]))).toBe(0xfccd77c0d6f9a3dan)
    expect(seedToUint64(Uint8Array.from([1, 0]))).toBe(0x883229623f1a2749n)
    expect(seedToUint64('ABCD')).toBe(seedToUint64('abcd'))
  })

  test('uniformInt and shuffle match the reference (rejection sampling)', () => {
    const small = new Xoshiro128(7)
    expect(Array.from({ length: 12 }, () => small.uniformInt(6))).toEqual([
      4, 0, 5, 1, 3, 4, 3, 3, 0, 1, 5, 0,
    ])
    const large = new Xoshiro128(7)
    expect(Array.from({ length: 5 }, () => large.uniformInt(3_000_000_000))).toEqual([
      1102073705, 465550927, 195718809, 1406345469, 2604866193,
    ])
    const shuffled = new Xoshiro128(2026).shuffle(Array.from({ length: 10 }, (_, i) => i))
    expect(shuffled).toEqual([6, 0, 5, 4, 2, 8, 1, 7, 9, 3])
  })

  test('uniformInt is uniform: χ² over 60 000 draws of n = 6 stays unremarkable', () => {
    const rng = new Xoshiro128(99)
    const tally = new Array<number>(6).fill(0)
    for (let i = 0; i < 60_000; i++) {
      const k = rng.uniformInt(6)
      tally[k] = (tally[k] as number) + 1
    }
    let chi2 = 0
    for (const c of tally) chi2 += (c - 10_000) ** 2 / 10_000
    // χ²(5) 99.9th percentile is 20.515 (closed form tables); deterministic seed
    expect(chi2).toBeLessThan(20.52)
  })

  test('invalid seeds and bounds throw PsiError invalid_plan', () => {
    const bad = expect.objectContaining({
      name: 'PsiError',
      code: 'invalid_plan',
    }) as unknown as Error
    for (const seed of [
      -1,
      1.5,
      Number.NaN,
      2 ** 53,
      -1n,
      1n << 64n,
      '',
      'abc',
      'zz',
      new Uint8Array(0),
    ]) {
      expect(() => seedToUint64(seed)).toThrow(bad)
    }
    expect(() => seedToUint64(new Uint8Array(513))).toThrow(bad)
    // biome-ignore lint/suspicious/noExplicitAny: deliberately wrong type
    expect(() => seedToUint64({} as any)).toThrow(bad)
    const rng = new Xoshiro128()
    for (const n of [0, 1.5, 2 ** 32 + 1, Number.NaN]) expect(() => rng.uniformInt(n)).toThrow(bad)
    expect(rng.uniformInt(1)).toBe(0)
  })
})
