import { describe, expect, test } from 'bun:test'
import { packBits, vonNeumann } from '../../src/internal/bits.js'

describe('packBits', () => {
  test('packs eight bits into one byte, MSB first', () => {
    const [bytes, leftover] = packBits([1, 0, 1, 0, 1, 0, 1, 0])
    expect(bytes).toEqual(new Uint8Array([0b10101010]))
    expect(leftover).toEqual([])
  })

  test('returns trailing bits that do not fill a byte', () => {
    const [bytes, leftover] = packBits([1, 1, 1, 1, 0, 0, 0, 0, 1, 0])
    expect(bytes).toEqual(new Uint8Array([0b11110000]))
    expect(leftover).toEqual([1, 0])
  })

  test('handles empty input', () => {
    const [bytes, leftover] = packBits([])
    expect(bytes).toEqual(new Uint8Array(0))
    expect(leftover).toEqual([])
  })

  test('packs multiple bytes in order', () => {
    const bits = [0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0]
    const [bytes] = packBits(bits)
    expect(bytes).toEqual(new Uint8Array([1, 128]))
  })
})

describe('vonNeumann', () => {
  test('maps 01→0 and 10→1, drops 00 and 11', () => {
    expect(vonNeumann([0, 1, 1, 0, 0, 0, 1, 1, 0, 1])).toEqual([0, 1, 0])
  })

  test('ignores a trailing unpaired bit', () => {
    expect(vonNeumann([0, 1, 1])).toEqual([0])
  })

  test('returns empty output for constant input', () => {
    expect(vonNeumann([1, 1, 1, 1, 1, 1])).toEqual([])
  })

  test('removes bias from a skewed but independent stream', () => {
    // deterministic LCG producing ~80% ones
    let state = 12345
    const next = () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff
      return state / 0x7fffffff
    }
    const biased = Array.from({ length: 40_000 }, () => (next() < 0.8 ? 1 : 0))
    const out = vonNeumann(biased)
    expect(out.length).toBeGreaterThan(1000)
    const mean = out.reduce((a, b) => a + b, 0) / out.length
    expect(mean).toBeGreaterThan(0.45)
    expect(mean).toBeLessThan(0.55)
  })
})
