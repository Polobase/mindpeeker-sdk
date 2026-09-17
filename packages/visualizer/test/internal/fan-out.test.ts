import { describe, expect, test } from 'bun:test'
import { VisualizerError } from '../../src/errors.js'
import { fanOut, paced } from '../../src/internal/fan-out.js'

/**
 * A hand-driven source: `emit` delivers the next item (buffering if nobody is
 * pulling), `fail`/`end` finish it. Counts pulls and return() calls.
 */
function manualSource<T>() {
  const buffer: IteratorResult<T>[] = []
  const pending: { resolve: (r: IteratorResult<T>) => void; reject: (e: unknown) => void }[] = []
  let failure: unknown
  const stats = { pulls: 0, returns: 0 }
  const deliver = (result: IteratorResult<T>) => {
    const waiter = pending.shift()
    if (waiter) waiter.resolve(result)
    else buffer.push(result)
  }
  const iterator: AsyncIterableIterator<T> = {
    next() {
      stats.pulls++
      const buffered = buffer.shift()
      if (buffered) return Promise.resolve(buffered)
      if (failure !== undefined) return Promise.reject(failure)
      return new Promise((resolve, reject) => pending.push({ resolve, reject }))
    },
    async return() {
      stats.returns++
      return { done: true, value: undefined }
    },
    [Symbol.asyncIterator]: () => iterator,
  }
  return {
    iterator,
    stats,
    emit: (value: T) => deliver({ done: false, value }),
    end: () => deliver({ done: true, value: undefined }),
    fail: (error: unknown) => {
      failure = error
      for (const waiter of pending.splice(0)) waiter.reject(error)
    },
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

async function drain<T>(it: AsyncIterator<T>): Promise<T[]> {
  const out: T[] = []
  for (let r = await it.next(); !r.done; r = await it.next()) out.push(r.value)
  return out
}

describe('fanOut', () => {
  test('is lazy: nothing is pulled before the first consumer asks', async () => {
    const source = manualSource<number>()
    const [a] = fanOut(source.iterator, 2)
    await tick()
    expect(source.stats.pulls).toBe(0)
    const first = a?.next()
    source.emit(1)
    expect(await first).toEqual({ done: false, value: 1 })
    expect(source.stats.pulls).toBeGreaterThan(0)
  })

  test('a slow consumer drops its OLDEST items; a prompt consumer receives everything', async () => {
    const source = manualSource<number>()
    const [fast, slow] = fanOut(source.iterator, 2, { capacity: 3 }) as [
      AsyncIterableIterator<number>,
      AsyncIterableIterator<number>,
    ]
    const received: number[] = []
    for (let v = 1; v <= 6; v++) {
      const next = fast.next()
      source.emit(v)
      received.push((await next).value as number)
    }
    source.end()
    expect(received).toEqual([1, 2, 3, 4, 5, 6])
    expect(await fast.next()).toEqual({ done: true, value: undefined })
    // the slow consumer never pulled: its queue kept only the newest 3
    expect(await drain(slow)).toEqual([4, 5, 6])
  })

  test('a source error reaches every consumer after its queue drains', async () => {
    const source = manualSource<number>()
    const [a, b] = fanOut(source.iterator, 2) as [
      AsyncIterableIterator<number>,
      AsyncIterableIterator<number>,
    ]
    const first = a.next()
    source.emit(7)
    await first
    const boom = new Error('device unplugged')
    source.fail(boom)
    await tick()
    await expect(a.next()).rejects.toBe(boom)
    expect(await b.next()).toEqual({ done: false, value: 7 })
    await expect(b.next()).rejects.toBe(boom)
    // after the error the consumer is finished
    expect(await b.next()).toEqual({ done: true, value: undefined })
  })

  test('abort pre-empts a blocked pull, ends every consumer and returns the source', async () => {
    const source = manualSource<number>()
    const controller = new AbortController()
    const [a, b] = fanOut(source.iterator, 2, { signal: controller.signal }) as [
      AsyncIterableIterator<number>,
      AsyncIterableIterator<number>,
    ]
    const pendingA = a.next() // starts the pump; the source never emits
    const pendingB = b.next()
    await tick()
    controller.abort()
    expect(await pendingA).toEqual({ done: true, value: undefined })
    expect(await pendingB).toEqual({ done: true, value: undefined })
    await tick()
    expect(source.stats.returns).toBe(1)
  })

  test('a pre-aborted signal ends consumers without touching the source', async () => {
    const source = manualSource<number>()
    const controller = new AbortController()
    controller.abort()
    const [a] = fanOut(source.iterator, 1, { signal: controller.signal })
    expect(await a?.next()).toEqual({ done: true, value: undefined })
    await tick()
    expect(source.stats.pulls).toBe(0)
  })

  test('return() detaches a consumer even while its next() is pending', async () => {
    const source = manualSource<number>()
    const [a, b] = fanOut(source.iterator, 2) as [
      AsyncIterableIterator<number>,
      AsyncIterableIterator<number>,
    ]
    const pending = a.next()
    await tick()
    await a.return?.()
    expect(await pending).toEqual({ done: true, value: undefined })
    // the other consumer keeps flowing
    const next = b.next()
    source.emit(3)
    expect(await next).toEqual({ done: false, value: 3 })
    expect(source.stats.returns).toBe(0)
  })

  test('once every consumer detached, the pull stops and the source is returned', async () => {
    const source = manualSource<number>()
    const [a, b] = fanOut(source.iterator, 2) as [
      AsyncIterableIterator<number>,
      AsyncIterableIterator<number>,
    ]
    const pending = a.next()
    await tick()
    await a.return?.()
    await b.return?.()
    await pending
    await tick()
    expect(source.stats.returns).toBe(1)
    const pullsAfter = source.stats.pulls
    source.emit(9)
    await tick()
    expect(source.stats.pulls).toBe(pullsAfter)
  })

  test('validates n and capacity', () => {
    for (const [n, capacity] of [
      [0, 1],
      [1.5, 1],
      [2, 0],
      [2, Number.NaN],
    ] as const) {
      try {
        fanOut(manualSource<number>().iterator, n, { capacity })
        throw new Error('accepted')
      } catch (error) {
        expect(error).toBeInstanceOf(VisualizerError)
        expect((error as VisualizerError).code).toBe('invalid_options')
      }
    }
  })
})

describe('paced', () => {
  async function* numbers(): AsyncGenerator<number> {
    yield 1
    yield 2
    yield 3
  }

  test('yields every item in order, waiting between pulls', async () => {
    const started = performance.now()
    const out: number[] = []
    for await (const n of paced(numbers(), 25)) out.push(n)
    expect(out).toEqual([1, 2, 3])
    expect(performance.now() - started).toBeGreaterThanOrEqual(45)
  })

  test('an abort cuts the wait short and ends the stream', async () => {
    const controller = new AbortController()
    const it = paced(numbers(), 60_000, controller.signal)
    expect(await it.next()).toEqual({ done: false, value: 1 })
    const started = performance.now()
    const next = it.next() // sleeping 60 s
    controller.abort()
    expect(await next).toEqual({ done: true, value: undefined })
    expect(performance.now() - started).toBeLessThan(1000)
  })

  test('rejects a negative or non-finite interval', async () => {
    for (const interval of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const error = await paced(numbers(), interval)
        .next()
        .then(
          () => undefined,
          (e: unknown) => e,
        )
      expect(error).toBeInstanceOf(VisualizerError)
      expect((error as VisualizerError).code).toBe('invalid_options')
    }
  })
})
