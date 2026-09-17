import { describe, expect, test } from 'bun:test'
import { NegentropyError } from '../../src/errors.js'
import { epochAverage } from '../../src/stats/epoch.js'
import { stoufferZ } from '../../src/stats/zscores.js'
import { gaussians } from '../helpers/byte-sources.js'

describe('epochAverage', () => {
  test('per-index Stouffer across aligned events, bit-identical to stoufferZ', () => {
    const a = gaussians(40, 0x51)
    const b = gaussians(55, 0x52)
    const c = gaussians(30, 0x53)
    const out = epochAverage([a, b, c], { align: [10, 20, 5], offset: -5, length: 25 })
    expect(out.length).toBe(25)
    for (let j = 0; j < 25; j++) {
      const column = [a[5 + j] as number, b[15 + j] as number, c[j] as number]
      expect(out[j]).toBe(stoufferZ(column))
    }
  })

  test('defaults: onsets at 0 and the longest common epoch', () => {
    const out = epochAverage([
      [1, 2, 3, 4],
      [3, 4, 5],
    ])
    expect([...out]).toEqual([4 / Math.SQRT2, 6 / Math.SQRT2, 8 / Math.SQRT2])
    const shifted = epochAverage([[0, 0, 7, 8], [9]], { align: [2, 0] })
    expect([...shifted]).toEqual([16 / Math.SQRT2])
  })

  test('H0: each index is N(0, 1) across independent events', () => {
    const events = 16
    const length = 3000
    const g = gaussians(events * length, 0x54)
    const curves = Array.from({ length: events }, (_, e) =>
      g.subarray(e * length, (e + 1) * length),
    )
    const out = epochAverage(curves)
    let sum = 0
    let squares = 0
    for (const z of out) {
      sum += z
      squares += z * z
    }
    const mean = sum / length
    expect(Math.abs(mean)).toBeLessThan(4 / Math.sqrt(length))
    expect(Math.abs(squares / length - 1)).toBeLessThan(4 * Math.sqrt(2 / length))
  })

  test('only values inside the epochs are read (NaN outside is fine)', () => {
    const out = epochAverage(
      [
        [Number.NaN, 1, 2],
        [3, 4],
      ],
      { align: [1, 0], length: 2 },
    )
    expect([...out]).toEqual([4 / Math.SQRT2, 6 / Math.SQRT2])
    expect(() => epochAverage([[Number.NaN, 1]], { length: 2 })).toThrow(NegentropyError)
  })

  test('validation and window errors', () => {
    const codes = (call: () => unknown): string => {
      try {
        call()
      } catch (error) {
        return (error as NegentropyError).code
      }
      return 'none'
    }
    expect(codes(() => epochAverage([]))).toBe('insufficient_data')
    expect(codes(() => epochAverage([5 as unknown as number[]]))).toBe('invalid_config')
    expect(codes(() => epochAverage([[1, 2]], { align: [0, 1] }))).toBe('invalid_config')
    expect(codes(() => epochAverage([[1, 2]], { align: [0.5] }))).toBe('invalid_config')
    expect(codes(() => epochAverage([[1, 2]], { offset: 1.5 }))).toBe('invalid_config')
    expect(codes(() => epochAverage([[1, 2]], { offset: -1 }))).toBe('invalid_window')
    expect(codes(() => epochAverage([[1, 2]], { length: 3 }))).toBe('invalid_window')
    expect(codes(() => epochAverage([[1, 2]], { length: 0 }))).toBe('invalid_window')
    expect(codes(() => epochAverage([[1, 2]], { align: [2] }))).toBe('invalid_window')
  })
})
