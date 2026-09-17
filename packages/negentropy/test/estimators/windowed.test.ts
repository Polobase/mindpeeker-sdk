import { describe, expect, test } from 'bun:test'
import { negentropyKurtosis, negentropyLogcosh } from '../../src/estimators/negentropy.js'
import type { WindowedNegentropyPoint } from '../../src/estimators/windowed.js'
import { windowedNegentropy } from '../../src/estimators/windowed.js'
import { gaussians, prngUniforms } from '../helpers/byte-sources.js'

async function collect(
  generator: AsyncGenerator<WindowedNegentropyPoint>,
): Promise<WindowedNegentropyPoint[]> {
  const out: WindowedNegentropyPoint[] = []
  for await (const point of generator) out.push(point)
  return out
}

describe('windowedNegentropy', () => {
  test('streamed values EXACTLY equal the batch estimator on the same slices', async () => {
    const samples = gaussians(1000, 0x1234)
    const windowSize = 128
    const hopSize = 64
    const points = await collect(
      windowedNegentropy(Array.from(samples), { windowSize, hopSize, estimator: 'logcosh' }),
    )
    expect(points.length).toBe(Math.floor((1000 - windowSize) / hopSize) + 1)
    for (const point of points) {
      const slice = samples.slice(point.startSample, point.startSample + windowSize)
      expect(point.j).toBe(negentropyLogcosh(slice).j)
    }
  })

  test('window/hop indexing', async () => {
    const points = await collect(
      windowedNegentropy(Array.from(gaussians(32, 0x99)), { windowSize: 16, hopSize: 8 }),
    )
    expect(points.map((p) => p.startSample)).toEqual([0, 8, 16])
    expect(points.map((p) => p.index)).toEqual([0, 1, 2])
  })

  test('byte chunks and plain numbers are equivalent inputs', async () => {
    const bytes = new Uint8Array(256)
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37) & 0xff
    const asChunks = await collect(
      windowedNegentropy([bytes.slice(0, 100), bytes.slice(100)], { windowSize: 64 }),
    )
    const asNumbers = await collect(windowedNegentropy(Array.from(bytes), { windowSize: 64 }))
    expect(asChunks).toEqual(asNumbers)
  })

  test('detects a change-point within a window of the boundary', async () => {
    // 4 windows of Gaussian, then 4 windows of uniform (sub-Gaussian, exkurt −1.2)
    const w = 1024
    const gaussian = gaussians(4 * w, 0xabc)
    const uniform = prngUniforms(4 * w, 0xdef)
    const stream = [...gaussian, ...uniform]
    const points = await collect(
      windowedNegentropy(stream, { windowSize: w, estimator: 'kurtosis' }),
    )
    expect(points.length).toBe(8)
    for (const point of points.slice(0, 4)) expect(point.j).toBeLessThan(0.01)
    for (const point of points.slice(5)) expect(point.j).toBeGreaterThan(0.02)
  })

  test('degenerate windows yield NaN, not Infinity', async () => {
    const points = await collect(
      windowedNegentropy(new Array(64).fill(5), { windowSize: 32, estimator: 'kurtosis' }),
    )
    for (const point of points) expect(point.j).toBeNaN()
  })

  test('is lazy and abortable', async () => {
    let pulled = 0
    async function* source(): AsyncGenerator<number> {
      const values = gaussians(10_000, 0x321)
      for (const v of values) {
        pulled++
        yield v
      }
    }
    const controller = new AbortController()
    const generator = windowedNegentropy(source(), { windowSize: 64, signal: controller.signal })
    expect(pulled).toBe(0)
    await generator.next()
    expect(pulled).toBe(64)
    controller.abort()
    await expect(generator.next()).rejects.toMatchObject({ code: 'aborted' })
  })

  test('abort pre-empts a blocked async input and closes it', async () => {
    let released = false
    async function* stuck(): AsyncGenerator<number> {
      try {
        for (const v of gaussians(64, 0x322)) yield v
        await new Promise(() => {}) // blocks forever without yielding
      } finally {
        released = true
      }
    }
    const controller = new AbortController()
    const generator = windowedNegentropy(stuck(), { windowSize: 64, signal: controller.signal })
    await generator.next()
    const pending = generator.next()
    setTimeout(() => controller.abort(), 10)
    const started = performance.now()
    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
    expect(performance.now() - started).toBeLessThan(1000)
    // the input is stuck in an await, so return() cannot run its finally — the
    // consumer is not held hostage by it (bounded grace period)
    expect(released).toBe(false)
  })

  test('early exit closes an async input', async () => {
    let released = false
    async function* endless(): AsyncGenerator<number> {
      try {
        let seed = 1
        while (true) for (const v of gaussians(16, seed++)) yield v
      } finally {
        released = true
      }
    }
    for await (const point of windowedNegentropy(endless(), { windowSize: 32 })) {
      if (point.index === 2) break
    }
    expect(released).toBe(true)
  })

  test('rejects bad configuration', async () => {
    await expect(windowedNegentropy([], { windowSize: 4 }).next()).rejects.toMatchObject({
      code: 'invalid_config',
    })
    await expect(
      windowedNegentropy([], { windowSize: 64, hopSize: 0 }).next(),
    ).rejects.toMatchObject({
      code: 'invalid_config',
    })
  })

  test('verifies the kurtosis path against the batch estimator too', async () => {
    const samples = prngUniforms(512, 0x777)
    const points = await collect(
      windowedNegentropy(Array.from(samples), { windowSize: 256, estimator: 'kurtosis' }),
    )
    expect(points[0]?.j).toBe(negentropyKurtosis(samples.slice(0, 256)).j)
  })
})
