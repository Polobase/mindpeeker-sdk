import { describe, expect, test } from 'bun:test'
import { compressionRatio, monteCarloPi } from '../../scripts/stats.js'

// The estimator suite that used to live here moved to @mindpeeker/negentropy
// (packages/negentropy/test/estimators/*), which carries the original cases
// as its regression baseline. Only the script-local helpers remain.

function prng(n: number, seed = 0xabcdef01): Uint8Array<ArrayBuffer> {
  let state = seed
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    out[i] = state & 0xff
  }
  return out
}

describe('monteCarloPi', () => {
  test('lands near pi on healthy data', () => {
    expect(Math.abs(monteCarloPi(prng(262_144)) - Math.PI)).toBeLessThan(0.05)
  })

  test('is degenerate on constant data', () => {
    expect(monteCarloPi(new Uint8Array(6000).fill(0))).toBe(4) // (0,0) is inside
  })
})

describe('compressionRatio', () => {
  test('random data is incompressible, constant data is not', () => {
    expect(compressionRatio(prng(65_536))).toBeGreaterThan(0.99)
    expect(compressionRatio(new Uint8Array(65_536).fill(7))).toBeLessThan(0.01)
  })
})
