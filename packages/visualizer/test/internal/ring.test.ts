import { describe, expect, test } from 'bun:test'
import { VisualizerError } from '../../src/errors.js'
import { RingBuffer } from '../../src/internal/ring.js'

describe('RingBuffer', () => {
  test('holds items in arrival order below capacity', () => {
    const ring = new RingBuffer<number>(4)
    ring.push(1)
    ring.push(2)
    ring.push(3)
    expect(ring.size).toBe(3)
    expect(ring.dropped).toBe(0)
    expect(ring.snapshot()).toEqual([1, 2, 3])
  })

  test('drops oldest first once full', () => {
    const ring = new RingBuffer<number>(3)
    for (const n of [1, 2, 3, 4, 5]) ring.push(n)
    expect(ring.size).toBe(3)
    expect(ring.dropped).toBe(2)
    expect(ring.snapshot()).toEqual([3, 4, 5])
  })

  test('keeps exactly the newest `capacity` items over long runs', () => {
    const ring = new RingBuffer<number>(256)
    for (let i = 0; i < 10_000; i++) ring.push(i)
    const snapshot = ring.snapshot()
    expect(snapshot).toHaveLength(256)
    expect(snapshot[0]).toBe(10_000 - 256)
    expect(snapshot[255]).toBe(9999)
    expect(ring.dropped).toBe(10_000 - 256)
  })

  test('capacity one behaves as a latest-value cell', () => {
    const ring = new RingBuffer<string>(1)
    ring.push('a')
    ring.push('b')
    expect(ring.snapshot()).toEqual(['b'])
    expect(ring.dropped).toBe(1)
  })

  test('snapshot is a copy, not a live view', () => {
    const ring = new RingBuffer<number>(2)
    ring.push(1)
    const snap = ring.snapshot()
    ring.push(2)
    expect(snap).toEqual([1])
  })

  test('rejects invalid capacities', () => {
    expect(() => new RingBuffer(0)).toThrow(VisualizerError)
    expect(() => new RingBuffer(-1)).toThrow(VisualizerError)
    expect(() => new RingBuffer(2.5)).toThrow(VisualizerError)
    try {
      new RingBuffer(0)
    } catch (error) {
      expect((error as VisualizerError).code).toBe('server')
    }
  })
})
