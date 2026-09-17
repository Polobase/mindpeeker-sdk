import { describe, expect, test } from 'bun:test'
import { FlowError } from '../src/errors.js'
import { pairStreams, windowedTransferEntropy } from '../src/streaming.js'
import {
  countingByteSource,
  delay,
  failingSource,
  returningSource,
  signalHonouringSource,
  stalledSource,
} from './helpers/streams.js'

/** Await a promise that must reject; return the rejection. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected a rejection')
}

function expectFlowError(error: unknown, code: FlowError['code']): FlowError {
  expect(error).toBeInstanceOf(FlowError)
  expect((error as FlowError).code).toBe(code)
  return error as FlowError
}

describe('abort contract (upstream honours the signal)', () => {
  test('pairStreams: abort during a pending pull → FlowError aborted with the upstream cause', async () => {
    const controller = new AbortController()
    const a = signalHonouringSource('a', 20)
    const b = signalHonouringSource('b', 20)
    const gen = pairStreams(a, b, { signal: controller.signal })
    const pending = gen.next()
    setTimeout(() => controller.abort(), 5)
    const error = expectFlowError(await rejection(pending), 'aborted')
    expect((error.cause as { name?: string }).name).toBe('AbortError')
    expect((await gen.next()).done).toBe(true)
    await delay(30)
    expect(a.closed).toBe(true) // upstream released
  })

  test('pairStreams: custom abort reason becomes the cause, never leaks raw', async () => {
    const controller = new AbortController()
    const gen = pairStreams(signalHonouringSource('a', 20), signalHonouringSource('b', 20), {
      signal: controller.signal,
    })
    const pending = gen.next()
    const reason = new Error('user cancel')
    setTimeout(() => controller.abort(reason), 5)
    const error = expectFlowError(await rejection(pending), 'aborted')
    expect(error.cause).toBe(reason)
  })

  test('windowedTransferEntropy over pairStreams: abort mid-pull → aborted', async () => {
    const controller = new AbortController()
    const pairs = pairStreams(signalHonouringSource('a', 2), signalHonouringSource('b', 2), {
      signal: controller.signal,
    })
    const gen = windowedTransferEntropy(pairs, { windowSize: 1024, signal: controller.signal })
    const pending = gen.next()
    setTimeout(() => controller.abort(), 15)
    expectFlowError(await rejection(pending), 'aborted')
  })

  test('windowedTransferEntropy: a pair iterable rejecting with its own abort error → aborted', async () => {
    const controller = new AbortController()
    const { signal } = controller
    class EntropyLikeError extends Error {
      readonly code = 'aborted'
    }
    const iterable: AsyncIterable<readonly [number, number]> = {
      [Symbol.asyncIterator]: () => ({
        next: () =>
          new Promise<IteratorResult<readonly [number, number]>>((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => reject(new EntropyLikeError('request aborted')),
              {
                once: true,
              },
            )
          }),
      }),
    }
    const gen = windowedTransferEntropy(iterable, { windowSize: 8, signal })
    const pending = gen.next()
    setTimeout(() => controller.abort(), 5)
    const error = expectFlowError(await rejection(pending), 'aborted')
    expect(error).not.toBeInstanceOf(EntropyLikeError)
  })
})

describe('abort pre-empts stalled upstreams', () => {
  test('pairStreams rejects promptly although the source ignores the signal', async () => {
    const controller = new AbortController()
    const gen = pairStreams(stalledSource('camera'), countingByteSource('mic', 1), {
      signal: controller.signal,
    })
    for (let i = 0; i < 3; i++) await gen.next()
    const pending = gen.next() // the stalled side blocks here
    const started = performance.now()
    setTimeout(() => controller.abort(), 10)
    expectFlowError(await rejection(pending), 'aborted')
    expect(performance.now() - started).toBeLessThan(1000)
  })

  test('windowedTransferEntropy over a stalled pair iterable rejects promptly', async () => {
    const controller = new AbortController()
    async function* stalled(): AsyncGenerator<readonly [number, number]> {
      yield [0, 1] as const
      await new Promise<never>(() => {})
    }
    const gen = windowedTransferEntropy(stalled(), { windowSize: 16, signal: controller.signal })
    const pending = gen.next()
    const started = performance.now()
    setTimeout(() => controller.abort(), 10)
    expectFlowError(await rejection(pending), 'aborted')
    expect(performance.now() - started).toBeLessThan(1000)
  })
})

describe('post-abort clean end', () => {
  test('a source that returns on abort yields aborted, not a normal end', async () => {
    const controller = new AbortController()
    const gen = pairStreams(returningSource('a', 20), returningSource('b', 20), {
      signal: controller.signal,
    })
    const pending = gen.next()
    setTimeout(() => controller.abort(), 5)
    expectFlowError(await rejection(pending), 'aborted')
  })

  test('a pair iterable that ends after the abort is reported as aborted', async () => {
    const controller = new AbortController()
    const signal = controller.signal
    async function* endsOnAbort(): AsyncGenerator<readonly [number, number]> {
      while (!signal.aborted) {
        await delay(2)
        yield [1, 0] as const
      }
    }
    const iterable = endsOnAbort()
    // the pull pending at abort time resolves `done` instead of throwing
    const wrapped: AsyncIterable<readonly [number, number]> = {
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<readonly [number, number]>> => {
          const r = await iterable.next()
          return signal.aborted ? { done: true, value: undefined } : r
        },
      }),
    }
    const gen = windowedTransferEntropy(wrapped, { windowSize: 1_000_000, signal })
    setTimeout(() => controller.abort(), 10)
    expectFlowError(await rejection(gen.next()), 'aborted')
  })
})

describe('source failures', () => {
  test('pairStreams wraps a failing provider as source_error with cause and source name', async () => {
    const boom = new Error('socket closed')
    const gen = pairStreams(failingSource('anu', boom), countingByteSource('b', 4))
    const error = expectFlowError(
      await rejection(
        (async () => {
          for await (const _ of gen) {
            // drain
          }
        })(),
      ),
      'source_error',
    )
    expect(error.cause).toBe(boom)
    expect(error.source).toBe('anu')
  })

  test('a FlowError from pairStreams passes through windowedTransferEntropy unchanged', async () => {
    const gen = windowedTransferEntropy(
      pairStreams(failingSource('qrng', new TypeError('bad')), countingByteSource('b', 4)),
      { windowSize: 64 },
    )
    const error = expectFlowError(await rejection(gen.next()), 'source_error')
    expect(error.source).toBe('qrng')
  })

  test('a throwing pair iterable becomes source_error', async () => {
    async function* broken(): AsyncGenerator<readonly [number, number]> {
      yield [0, 0] as const
      throw new RangeError('device unplugged')
    }
    const error = expectFlowError(
      await rejection(windowedTransferEntropy(broken(), { windowSize: 8 }).next()),
      'source_error',
    )
    expect(error.cause).toBeInstanceOf(RangeError)
  })

  test('stream() throwing synchronously is a source_error', async () => {
    const source = {
      name: 'serial',
      stream(): AsyncIterable<Uint8Array> {
        throw new Error('port busy')
      },
    }
    const error = expectFlowError(
      await rejection(pairStreams(source, countingByteSource('b')).next()),
      'source_error',
    )
    expect(error.source).toBe('serial')
  })
})
