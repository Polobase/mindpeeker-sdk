import { describe, expect, test } from 'bun:test'
import { FlowError } from '../src/errors.js'
import { xorshift32 } from '../src/internal/prng.js'
import { circularShift, sourceShuffle } from '../src/surrogates.js'
import { prngSymbols } from './helpers/streams.js'

describe('xorshift32', () => {
  test('deterministic, in (0, 1), seed 0 remapped', () => {
    const a = xorshift32(42)
    const b = xorshift32(42)
    for (let i = 0; i < 100; i++) {
      const v = a()
      expect(v).toBe(b())
      expect(v).toBeGreaterThan(0)
      expect(v).toBeLessThan(1)
    }
    expect(xorshift32(0)()).toBe(xorshift32(1)())
  })
})

describe('sourceShuffle', () => {
  test('preserves the symbol multiset, never mutates the input', () => {
    const original = prngSymbols(500, 5, 0x5eed)
    const copy = Int32Array.from(original)
    const shuffled = sourceShuffle(original, xorshift32(7))
    expect(original).toEqual(copy)
    expect(Array.from(shuffled).sort()).toEqual(Array.from(original).sort())
  })

  test('same seed → same shuffle, different seed → different shuffle', () => {
    const x = prngSymbols(200, 4, 0xabc)
    expect(sourceShuffle(x, xorshift32(3))).toEqual(sourceShuffle(x, xorshift32(3)))
    expect(sourceShuffle(x, xorshift32(3))).not.toEqual(sourceShuffle(x, xorshift32(4)))
  })

  test('rejects non-symbol input', () => {
    expect(() => sourceShuffle([0.5, 1], xorshift32(1))).toThrow(FlowError)
  })
})

describe('circularShift', () => {
  test('output is a nontrivial rotation of the input', () => {
    const x = Int32Array.from({ length: 64 }, (_, i) => i % 7)
    const shifted = circularShift(x, xorshift32(11))
    expect(shifted).not.toEqual(x)
    // find the rotation offset and verify every position matches it
    let offset = -1
    for (let o = 1; o < x.length; o++) {
      if ((x[o] as number) === (shifted[0] as number)) {
        let ok = true
        for (let i = 0; i < x.length; i++) {
          if ((shifted[i] as number) !== (x[(i + o) % x.length] as number)) {
            ok = false
            break
          }
        }
        if (ok) {
          offset = o
          break
        }
      }
    }
    expect(offset).toBeGreaterThanOrEqual(1)
  })

  test('deterministic for a seed; short inputs pass through as copies', () => {
    const x = prngSymbols(100, 3, 0xdef)
    expect(circularShift(x, xorshift32(5))).toEqual(circularShift(x, xorshift32(5)))
    expect(circularShift([7], xorshift32(5))).toEqual(Int32Array.from([7]))
  })
})
