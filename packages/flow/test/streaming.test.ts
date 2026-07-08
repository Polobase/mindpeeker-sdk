import { describe, expect, test } from 'bun:test'
import { FlowError } from '../src/errors.js'
import { pairStreams, windowedTransferEntropy } from '../src/streaming.js'
import { transferEntropy } from '../src/transfer.js'
import { asyncValues, collect, countingByteSource, prngSymbols } from './helpers/streams.js'

function toPairs(x: ArrayLike<number>, y: ArrayLike<number>): Array<readonly [number, number]> {
  return Array.from({ length: x.length }, (_, i) => [x[i] as number, y[i] as number] as const)
}

describe('pairStreams', () => {
  test('zips numbers and flattens byte chunks in lock-step', async () => {
    const a = asyncValues<number | Uint8Array>([1, Uint8Array.of(2, 3), 4])
    const b = asyncValues<number | Uint8Array>([Uint8Array.of(9, 8, 7, 6)])
    expect(await collect(pairStreams(a, b))).toEqual([
      [1, 9],
      [2, 8],
      [3, 7],
      [4, 6],
    ])
  })

  test('ends when the shorter side ends; empty chunks are skipped', async () => {
    const a = asyncValues<number | Uint8Array>([Uint8Array.of(), 1, 2, 3])
    const b = asyncValues<number | Uint8Array>([5, 6])
    expect(await collect(pairStreams(a, b))).toEqual([
      [1, 5],
      [2, 6],
    ])
  })

  test('accepts live ByteSources structurally and pulls with backpressure', async () => {
    const source = countingByteSource('a', 4)
    const dest = countingByteSource('b', 4)
    const gen = pairStreams(source, dest)
    for (let i = 0; i < 8; i++) await gen.next()
    // 8 pairs from 4-byte chunks: exactly 2 chunks pulled per side
    expect(source.pulls).toBe(2)
    expect(dest.pulls).toBe(2)
    await gen.return(undefined)
  })

  test('abort throws a FlowError with code aborted', async () => {
    const controller = new AbortController()
    const gen = pairStreams(countingByteSource('a'), countingByteSource('b'), {
      signal: controller.signal,
    })
    await gen.next()
    controller.abort()
    try {
      await gen.next()
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(FlowError)
      expect((error as FlowError).code).toBe('aborted')
    }
  })

  test('rejects streams yielding neither numbers nor bytes', async () => {
    const bad = asyncValues(['nope'] as unknown as number[])
    const good = asyncValues<number | Uint8Array>([1])
    await expect(collect(pairStreams(bad, good))).rejects.toThrow(FlowError)
  })
})

describe('windowedTransferEntropy', () => {
  const x = prngSymbols(400, 2, 0xf00d)
  const y = Int32Array.from(x)
  for (let t = y.length - 1; t >= 1; t--) y[t] = x[t - 1] as number
  y[0] = 0

  test('non-overlapping windows are batch-exact', async () => {
    const points = await collect(windowedTransferEntropy(toPairs(x, y), { windowSize: 100 }))
    expect(points.length).toBe(4)
    points.forEach((p, i) => {
      expect(p.index).toBe(i)
      expect(p.startSample).toBe(i * 100)
      const sx = Array.from(x.slice(p.startSample, p.startSample + 100))
      const sy = Array.from(y.slice(p.startSample, p.startSample + 100))
      expect(p.te).toBe(transferEntropy(sx, sy))
    })
  })

  test('hopping windows are batch-exact, options forwarded', async () => {
    const opts = { k: 2, l: 1, lag: 1 } as const
    const points = await collect(
      windowedTransferEntropy(toPairs(x, y), { windowSize: 128, hopSize: 32, ...opts }),
    )
    expect(points.length).toBe(Math.floor((400 - 128) / 32) + 1)
    for (const p of points) {
      const sx = Array.from(x.slice(p.startSample, p.startSample + 128))
      const sy = Array.from(y.slice(p.startSample, p.startSample + 128))
      expect(p.te).toBe(transferEntropy(sx, sy, opts))
    }
  })

  test('detects coupling switching on midway through a stream', async () => {
    // first half independent, second half y driven by x
    const n = 512
    const sx = prngSymbols(n, 2, 0x9090)
    const noise = prngSymbols(n, 2, 0x1313)
    const sy = new Int32Array(n)
    for (let t = 1; t < n; t++) {
      sy[t] = t < n / 2 ? (noise[t] as number) : (sx[t - 1] as number)
    }
    const points = await collect(
      windowedTransferEntropy(toPairs(sx, sy), { windowSize: 128, hopSize: 128 }),
    )
    expect(points.length).toBe(4)
    expect((points[0] as { te: number }).te).toBeLessThan(0.1)
    expect((points[3] as { te: number }).te).toBeGreaterThan(0.9)
  })

  test('abort mid-stream cleanly ends the generator with a typed error', async () => {
    const controller = new AbortController()
    async function* endless(): AsyncGenerator<readonly [number, number]> {
      let state = 0x1357
      while (true) {
        state = (state * 48_271) % 2_147_483_647
        yield [state & 1, (state >> 1) & 1] as const
      }
    }
    const gen = windowedTransferEntropy(endless(), {
      windowSize: 64,
      signal: controller.signal,
    })
    const first = await gen.next()
    expect(first.done).toBe(false)
    controller.abort()
    try {
      await gen.next()
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(FlowError)
      expect((error as FlowError).code).toBe('aborted')
    }
    // the generator is finished — subsequent pulls resolve done, nothing hangs
    expect((await gen.next()).done).toBe(true)
  })

  test('pre-aborted signal throws before consuming anything', async () => {
    const controller = new AbortController()
    controller.abort()
    const gen = windowedTransferEntropy(toPairs(x, y), {
      windowSize: 64,
      signal: controller.signal,
    })
    await expect(gen.next()).rejects.toThrow(FlowError)
  })

  test('validates window geometry against the embedding', async () => {
    await expect(
      windowedTransferEntropy(toPairs(x, y), { windowSize: 4, k: 3, l: 2, lag: 2 }).next(),
    ).rejects.toThrow(FlowError)
    await expect(
      windowedTransferEntropy(toPairs(x, y), { windowSize: 64, hopSize: 0 }).next(),
    ).rejects.toThrow(FlowError)
  })

  test('works end-to-end over pairStreams of live byte sources', async () => {
    const gen = windowedTransferEntropy(
      pairStreams(countingByteSource('src', 32, 0xaa), countingByteSource('dst', 32, 0xbb)),
      { windowSize: 64 },
    )
    const first = await gen.next()
    expect(first.done).toBe(false)
    expect((first.value as { te: number }).te).toBeGreaterThanOrEqual(0)
    await gen.return(undefined)
  })
})
