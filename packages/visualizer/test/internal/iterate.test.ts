import { describe, expect, test } from 'bun:test'
import { describeError } from '../../src/internal/describe-error.js'
import {
  abortableSleep,
  CANCELLED,
  cancellableNext,
  closeIterator,
  nextUnlessAborted,
  toAsyncIterator,
} from '../../src/internal/iterate.js'

/** An iterator whose next() never settles; records return() calls. */
function stuckIterator(): AsyncIterator<number> & { returns: number } {
  const it = {
    returns: 0,
    next: () => new Promise<IteratorResult<number>>(() => {}),
    return: async () => {
      it.returns++
      return { done: true as const, value: undefined }
    },
  }
  return it
}

describe('toAsyncIterator', () => {
  test('owns async iterables and adapts sync iterables', async () => {
    async function* gen() {
      yield 1
    }
    expect(await toAsyncIterator<number>(gen())?.next()).toEqual({ done: false, value: 1 })
    const fromArray = toAsyncIterator<number>([7, 8]) as AsyncIterator<number>
    expect(await fromArray.next()).toEqual({ done: false, value: 7 })
    expect(await fromArray.next()).toEqual({ done: false, value: 8 })
    expect((await fromArray.next()).done).toBe(true)
  })

  test('returns undefined for non-iterables', () => {
    for (const value of [undefined, null, 42, 'abc', {}, { [Symbol.asyncIterator]: 1 }]) {
      expect(toAsyncIterator(value)).toBeUndefined()
    }
  })
})

describe('cancellableNext / nextUnlessAborted', () => {
  test('cancel resolves a stuck pull with CANCELLED', async () => {
    const pull = cancellableNext(stuckIterator())
    pull.cancel()
    expect(await pull.result).toBe(CANCELLED)
  })

  test('a pull that settles first ignores a later cancel', async () => {
    const pull = cancellableNext(toAsyncIterator<number>([5]) as AsyncIterator<number>)
    expect(await pull.result).toEqual({ done: false, value: 5 })
    pull.cancel()
  })

  test('an abandoned pull that later rejects raises no unhandled rejection', async () => {
    let rejectPull: (error: Error) => void = () => {}
    const iterator: AsyncIterator<number> = {
      next: () =>
        new Promise((_, reject) => {
          rejectPull = reject
        }),
    }
    const pull = cancellableNext(iterator)
    pull.cancel()
    expect(await pull.result).toBe(CANCELLED)
    rejectPull(new Error('late failure'))
    await new Promise((resolve) => setTimeout(resolve, 5))
  })

  test('nextUnlessAborted pre-empts a blocked pull on abort', async () => {
    const controller = new AbortController()
    const pending = nextUnlessAborted(stuckIterator(), controller.signal)
    controller.abort()
    expect(await pending).toBe(CANCELLED)
    expect(await nextUnlessAborted(stuckIterator(), controller.signal)).toBe(CANCELLED)
  })
})

describe('closeIterator', () => {
  test('calls return() and resolves', async () => {
    const it = stuckIterator()
    await closeIterator(it, 50)
    expect(it.returns).toBe(1)
  })

  test('bounds a return() that never settles', async () => {
    const it: AsyncIterator<number> = {
      next: async () => ({ done: true, value: undefined }),
      return: () => new Promise(() => {}),
    }
    const started = performance.now()
    await closeIterator(it, 30)
    expect(performance.now() - started).toBeLessThan(500)
  })

  test('swallows throwing and rejecting return()', async () => {
    const throwing: AsyncIterator<number> = {
      next: async () => ({ done: true, value: undefined }),
      return: () => {
        throw new Error('sync')
      },
    }
    const rejecting: AsyncIterator<number> = {
      next: async () => ({ done: true, value: undefined }),
      return: () => Promise.reject(new Error('async')),
    }
    await closeIterator(throwing, 10)
    await closeIterator(rejecting, 10)
    await closeIterator({ next: async () => ({ done: true, value: undefined }) }, 10)
  })
})

describe('abortableSleep', () => {
  test('resolves early on abort and immediately when pre-aborted', async () => {
    const controller = new AbortController()
    const started = performance.now()
    const sleeping = abortableSleep(10_000, controller.signal)
    controller.abort()
    await sleeping
    await abortableSleep(10_000, controller.signal)
    expect(performance.now() - started).toBeLessThan(500)
  })
})

describe('describeError', () => {
  test('joins the cause chain and skips repeated messages', () => {
    const root = new Error('ENOENT: no such file')
    const mid = new Error('opening /dev/ttyUSB0 failed: ENOENT: no such file', { cause: root })
    const top = new Error('esp32 stream failed', { cause: mid })
    expect(describeError(top)).toBe(
      'esp32 stream failed: opening /dev/ttyUSB0 failed: ENOENT: no such file',
    )
  })

  test('handles non-errors and truncates', () => {
    expect(describeError('plain')).toBe('plain')
    expect(describeError(undefined)).toBe('unknown error')
    expect(describeError(Object.create(null))).toBe('object')
    const long = describeError(new Error('x'.repeat(1000)), 20)
    expect(long).toHaveLength(20)
    expect(long.endsWith('…')).toBe(true)
  })
})
