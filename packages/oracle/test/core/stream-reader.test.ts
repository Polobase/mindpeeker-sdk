import { describe, expect, test } from 'bun:test'
import { CLOSE_TIMEOUT_MS } from '../../src/core/internal.js'
import { byteReader } from '../../src/core/reader.js'
import { OracleError } from '../../src/errors.js'
import { liveSource, prngBytes, stalledIterable } from '../helpers/byte-sources.js'

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p
    return 'no-throw'
  } catch (err) {
    expect(err).toBeInstanceOf(OracleError)
    return (err as OracleError).code
  }
}

/** Generator-backed iterable that counts return() calls and finally blocks. */
function countedIterable(chunks = 1_000) {
  const stats = { returns: 0, finalized: 0 }
  async function* gen() {
    try {
      for (let i = 0; i < chunks; i++) yield prngBytes(4, i + 1)
    } finally {
      stats.finalized++
    }
  }
  const iterable: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]() {
      const it = gen()
      return {
        next: () => it.next(),
        return: (value?: unknown) => {
          stats.returns++
          return it.return(value as undefined)
        },
      }
    },
  }
  return { iterable, stats }
}

describe('StreamReader lifecycle', () => {
  test('close() releases a ByteSource stream: the generator finally runs', async () => {
    const source = liveSource('ws', 16)
    const reader = byteReader(source)
    await reader.next()
    expect(source.opened).toBe(1)
    expect(source.finalized).toBe(0)
    await reader.close()
    expect(source.finalized).toBe(1)
  })

  test('return() is called exactly once, however often close() is called', async () => {
    const { iterable, stats } = countedIterable()
    const reader = byteReader(iterable)
    await reader.next()
    const first = reader.close()
    const second = reader.close()
    expect(second).toBe(first)
    await Promise.all([first, second, reader.close()])
    expect(stats.returns).toBe(1)
    expect(stats.finalized).toBe(1)
  })

  test('closing a ByteSource reader before the first read never opens the stream', async () => {
    const source = liveSource('lazy', 8)
    const reader = byteReader(source)
    await reader.close()
    expect(source.opened).toBe(0)
  })

  test('next() after close() throws closed (stream and batch readers)', async () => {
    const stream = byteReader(liveSource('s', 8))
    await stream.next()
    await stream.close()
    expect(await codeOf(stream.next())).toBe('closed')

    const batch = byteReader(new Uint8Array([1, 2]))
    await batch.next()
    await batch.close()
    expect(await codeOf(batch.next())).toBe('closed')
    expect(batch.bytesConsumed).toBe(1)
  })

  test('a pending read rejects with closed, and close() does not wait on a stalled pull', async () => {
    const stalled = stalledIterable()
    const reader = byteReader(stalled)
    const pending = codeOf(reader.next())
    const started = performance.now()
    await reader.close()
    expect(performance.now() - started).toBeLessThan(CLOSE_TIMEOUT_MS / 2)
    expect(await pending).toBe('closed')
    expect(stalled.returns).toBe(1)
  })

  test('close() waits at most CLOSE_TIMEOUT_MS for a return() that never settles', async () => {
    const hanging: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false, value: new Uint8Array([1]) }),
        return: () => new Promise<IteratorResult<Uint8Array>>(() => {}),
      }),
    }
    const reader = byteReader(hanging)
    await reader.next()
    const started = performance.now()
    await reader.close()
    const elapsed = performance.now() - started
    expect(elapsed).toBeGreaterThanOrEqual(CLOSE_TIMEOUT_MS - 20)
    expect(elapsed).toBeLessThan(CLOSE_TIMEOUT_MS + 500)
  })

  test('close() swallows errors from return() (sync throw and rejection)', async () => {
    for (const bad of [
      () => {
        throw new Error('sync')
      },
      async () => {
        throw new Error('async')
      },
    ]) {
      const iterable: AsyncIterable<Uint8Array> = {
        [Symbol.asyncIterator]: () => ({
          next: async () => ({ done: false, value: new Uint8Array([1]) }),
          return: bad as () => Promise<IteratorResult<Uint8Array>>,
        }),
      }
      const reader = byteReader(iterable)
      await reader.next()
      await reader.close()
    }
  })

  test('an iterator that already ended or threw is not return()ed again', async () => {
    let returns = 0
    const make = (fail: boolean): AsyncIterable<Uint8Array> => ({
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          if (fail) throw new Error('boom')
          return { done: true, value: undefined }
        },
        return: async () => {
          returns++
          return { done: true, value: undefined }
        },
      }),
    })
    const ended = byteReader(make(false))
    expect(await codeOf(ended.next())).toBe('insufficient_entropy')
    await ended.close()
    const failed = byteReader(make(true))
    expect(await codeOf(failed.next())).toBe('source_error')
    await failed.close()
    expect(returns).toBe(0)
  })

  test('await using disposes the reader at scope exit', async () => {
    const source = liveSource('scoped', 8)
    {
      await using reader = byteReader(source)
      await reader.next()
    }
    expect(source.finalized).toBe(1)
  })

  test('concurrent next() calls on one stream reader: the second throws invalid_input', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    async function* slow() {
      await gate
      yield new Uint8Array([1, 2])
    }
    const reader = byteReader(slow())
    const first = reader.next()
    expect(await codeOf(reader.next())).toBe('invalid_input')
    release?.()
    expect(await first).toBe(1)
    expect(await reader.next()).toBe(2)
    expect(reader.bytesConsumed).toBe(2)
  })

  test('an aborted pending pull is kept: the next read gets its chunk, no bytes lost', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    async function* gated() {
      await gate
      yield new Uint8Array([42, 43])
    }
    const shared = byteReader(gated())
    const controller = new AbortController()
    const view = byteReader(shared, { signal: controller.signal })
    const pending = codeOf(view.next())
    controller.abort()
    expect(await pending).toBe('aborted')
    release?.()
    expect(await shared.next()).toBe(42)
    expect(await shared.next()).toBe(43)
    expect(shared.bytesConsumed).toBe(2)
  })
})
