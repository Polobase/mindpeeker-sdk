import { describe, expect, test } from 'bun:test'
import { EphemerisError } from '../../src/index.js'
import { seedToUint64, Xoshiro128 } from '../../src/internal/prng.js'
import fixture from '../fixtures/prng.json' with { type: 'json' }

describe('Xoshiro128 (splitmix64 → xoshiro128**)', () => {
  test('matches an independent Python transcription', () => {
    for (const c of fixture.cases) {
      const rng = new Xoshiro128(c.seed)
      expect(Array.from({ length: c.outputs.length }, () => rng.nextUint32())).toEqual(c.outputs)
    }
  })

  test('uniformInt stays in range and shuffle is a permutation', () => {
    const rng = new Xoshiro128(7)
    for (let i = 0; i < 1000; i++) {
      const x = rng.uniformInt(10)
      expect(x >= 0 && x < 10 && Number.isInteger(x)).toBe(true)
    }
    const values = Float64Array.from({ length: 50 }, (_, i) => i)
    rng.shuffle(values)
    expect(Array.from(values).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 50 }, (_, i) => i),
    )
  })

  test('seeds: integers, bigints, hex and bytes; invalid seeds throw invalid_options', () => {
    expect(seedToUint64(5)).toBe(5n)
    expect(seedToUint64(2n ** 64n - 1n)).toBe(2n ** 64n - 1n)
    expect(seedToUint64('00ff')).toBe(seedToUint64(new Uint8Array([0, 255])))
    expect(seedToUint64('01')).not.toBe(seedToUint64('0100'))
    for (const bad of [-1, 1.5, 2n ** 64n, '', 'abc', 'zz', new Uint8Array(0)]) {
      try {
        seedToUint64(bad)
        throw new Error('expected a throw')
      } catch (error) {
        expect(error).toBeInstanceOf(EphemerisError)
        expect((error as EphemerisError).code).toBe('invalid_options')
      }
    }
  })
})

describe('uniformInt rejection sampling', () => {
  test('equals the reference x mod n after rejecting x ≥ 2^32 − (2^32 mod n), in BigInt', () => {
    const bounds = [
      1,
      2,
      3,
      6,
      7,
      1000,
      2483,
      65537,
      2 ** 31 - 1,
      2 ** 31,
      2 ** 31 + 1,
      2 ** 32 - 5,
      2 ** 32,
    ]
    const fast = new Xoshiro128(2026)
    const reference = new Xoshiro128(2026)
    for (let round = 0; round < 200; round++) {
      for (const n of bounds) {
        const big = BigInt(n)
        const limit = 2n ** 32n - (2n ** 32n % big)
        let expected = 0
        if (n > 1) {
          for (;;) {
            const x = BigInt(reference.nextUint32())
            if (x < limit) {
              expected = Number(x % big)
              break
            }
          }
        }
        expect(fast.uniformInt(n)).toBe(expected)
      }
    }
  })
})
