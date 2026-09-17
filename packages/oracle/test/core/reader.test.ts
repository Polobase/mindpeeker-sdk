import { describe, expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'
import { byteReader } from '../../src/core/reader.js'
import { OracleError } from '../../src/errors.js'
import { chunkSource, countingSource, liveSource } from '../helpers/byte-sources.js'

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p
    return 'no-throw'
  } catch (err) {
    expect(err).toBeInstanceOf(OracleError)
    return (err as OracleError).code
  }
}

describe('byteReader', () => {
  test('reads a Uint8Array sequentially and tracks bytesConsumed', async () => {
    const reader = byteReader(new Uint8Array([7, 0, 255]))
    expect(reader.bytesConsumed).toBe(0)
    expect(await reader.next()).toBe(7)
    expect(await reader.next()).toBe(0)
    expect(await reader.next()).toBe(255)
    expect(reader.bytesConsumed).toBe(3)
  })

  test('accepts a plain ArrayLike<number>', async () => {
    const reader = byteReader([1, 2])
    expect(await reader.next()).toBe(1)
    expect(await reader.next()).toBe(2)
  })

  test('throws insufficient_entropy when a batch runs out', async () => {
    const reader = byteReader(new Uint8Array([1]))
    await reader.next()
    expect(await codeOf(reader.next())).toBe('insufficient_entropy')
  })

  test('rejects non-byte values in ArrayLike inputs', async () => {
    expect(await codeOf(byteReader([1.5]).next())).toBe('invalid_input')
    expect(await codeOf(byteReader([-1]).next())).toBe('invalid_input')
    expect(await codeOf(byteReader([256]).next())).toBe('invalid_input')
  })

  test('reads across chunk boundaries of an AsyncIterable', async () => {
    async function* chunks() {
      yield new Uint8Array([1, 2])
      yield new Uint8Array(0) // empty chunks are skipped
      yield new Uint8Array([3])
    }
    const reader = byteReader(chunks())
    expect(await reader.next()).toBe(1)
    expect(await reader.next()).toBe(2)
    expect(await reader.next()).toBe(3)
    expect(reader.bytesConsumed).toBe(3)
    expect(await codeOf(reader.next())).toBe('insufficient_entropy')
  })

  test('throws insufficient_entropy with the source name when a finite stream ends early', async () => {
    const reader = byteReader(chunkSource('qrng', [new Uint8Array([9])]))
    expect(await reader.next()).toBe(9)
    try {
      await reader.next()
      expect.unreachable()
    } catch (err) {
      expect((err as OracleError).code).toBe('insufficient_entropy')
      expect((err as OracleError).source).toBe('qrng')
    }
  })

  test('opens a ByteSource stream lazily, on the first byte pulled', async () => {
    const source = countingSource('lazy', 4)
    const reader = byteReader(source)
    expect(source.streamCalls).toBe(0)
    await reader.next()
    expect(source.streamCalls).toBe(1)
    expect(source.pulls).toBe(1)
  })

  test('returns an existing ByteReader unchanged when no signal is given', () => {
    const reader = byteReader(new Uint8Array([1]))
    expect(byteReader(reader)).toBe(reader)
    expect(byteReader(reader, { chunkBytes: 8 })).toBe(reader)
  })

  test('rejects unrecognized inputs', () => {
    expect(() => byteReader(42 as never)).toThrow(OracleError)
    expect(() => byteReader({} as never)).toThrow(OracleError)
  })

  test('a pre-aborted signal rejects immediately', async () => {
    const controller = new AbortController()
    controller.abort()
    const reader = byteReader(new Uint8Array([1]), { signal: controller.signal })
    expect(await codeOf(reader.next())).toBe('aborted')
  })

  test('aborting mid-await rejects a pending stream read', async () => {
    const controller = new AbortController()
    const never: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
    }
    const reader = byteReader(never, { signal: controller.signal })
    const pending = codeOf(reader.next())
    controller.abort()
    expect(await pending).toBe('aborted')
  })

  test('a rejected invalid byte is not counted as consumed', async () => {
    const reader = byteReader([7, 300, 1])
    expect(await reader.next()).toBe(7)
    expect(await codeOf(reader.next())).toBe('invalid_input')
    expect(reader.bytesConsumed).toBe(1)
    expect(reader.bytesFetched).toBe(1)
  })

  test('accepts a Uint8Array from another realm as a batch', async () => {
    const foreign = runInNewContext('new Uint8Array([9, 8, 7])') as Uint8Array
    expect(foreign instanceof Uint8Array).toBe(false)
    const reader = byteReader(foreign)
    expect([await reader.next(), await reader.next(), await reader.next()]).toEqual([9, 8, 7])
  })

  test('stream chunks: cross-realm Uint8Array and Uint8ClampedArray accepted, Int8Array rejected', async () => {
    const foreign = runInNewContext('new Uint8Array([5])') as Uint8Array
    async function* good() {
      yield foreign
      yield new Uint8ClampedArray([6]) as unknown as Uint8Array
    }
    const reader = byteReader(good())
    expect([await reader.next(), await reader.next()]).toEqual([5, 6])
    async function* bad() {
      yield new Int8Array([-1]) as unknown as Uint8Array
    }
    expect(await codeOf(byteReader(bad()).next())).toBe('invalid_input')
  })

  test('an Int8Array batch rejects its negative values', async () => {
    const reader = byteReader(new Int8Array([3, -3]) as unknown as ArrayLike<number>)
    expect(await reader.next()).toBe(3)
    expect(await codeOf(reader.next())).toBe('invalid_input')
  })

  test('a ByteSource that is also async-iterable is treated as a ByteSource', async () => {
    const source = liveSource('dual', 4)
    const dual = Object.assign(source, {
      [Symbol.asyncIterator]: () => {
        throw new Error('must not be used')
      },
    })
    const controller = new AbortController()
    const reader = byteReader(dual, { signal: controller.signal })
    await reader.next()
    expect(source.opened).toBe(1)
    expect(source.lastOpts?.signal).toBe(controller.signal)
  })

  test('rejects invalid options at the boundary', () => {
    const bytes = new Uint8Array([1])
    const bad: unknown[] = [
      null,
      { signal: {} },
      { chunkBytes: 0 },
      { chunkBytes: 1.5 },
      { chunkBytes: '32' },
    ]
    for (const opts of bad) {
      try {
        byteReader(bytes, opts as never)
        expect.unreachable()
      } catch (err) {
        expect((err as OracleError).code).toBe('invalid_input')
      }
    }
  })
})

describe('byteReader chunkBytes and bytesFetched', () => {
  test('chunkBytes is forwarded to ByteSource.stream together with the signal', async () => {
    const source = liveSource('chunked', 1024)
    const controller = new AbortController()
    const reader = byteReader(source, { signal: controller.signal, chunkBytes: 16 })
    await reader.next()
    expect(source.lastOpts).toEqual({ signal: controller.signal, chunkBytes: 16 })
    expect(reader.bytesConsumed).toBe(1)
    expect(reader.bytesFetched).toBe(16)
    await reader.close()
  })

  test('without options the source gets no options object', async () => {
    const source = liveSource('bare', 8)
    const reader = byteReader(source)
    await reader.next()
    expect(source.lastOpts).toBeUndefined()
    expect(reader.bytesFetched).toBe(8)
    await reader.close()
  })

  test('bytesFetched counts whole chunks as they arrive', async () => {
    async function* chunks() {
      yield new Uint8Array([1, 2, 3])
      yield new Uint8Array([4, 5])
    }
    const reader = byteReader(chunks())
    expect(reader.bytesFetched).toBe(0)
    await reader.next()
    expect(reader.bytesFetched).toBe(3)
    for (let i = 0; i < 3; i++) await reader.next()
    expect(reader.bytesConsumed).toBe(4)
    expect(reader.bytesFetched).toBe(5)
  })
})

describe('byteReader source errors', () => {
  test('a foreign error from the source is wrapped as source_error with cause and source', async () => {
    const cause = Object.assign(new Error('socket closed'), { code: 'network' })
    const reader = byteReader(chunkSource('qrng', [new Uint8Array([1])], { errorAfter: cause }))
    expect(await reader.next()).toBe(1)
    try {
      await reader.next()
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(OracleError)
      expect((err as OracleError).code).toBe('source_error')
      expect((err as OracleError).source).toBe('qrng')
      expect((err as OracleError).cause).toBe(cause)
    }
  })

  test('an OracleError thrown by the source passes through unchanged', async () => {
    const inner = new OracleError('insufficient_entropy', 'nested oracle ran dry')
    const reader = byteReader(chunkSource('nested', [], { errorAfter: inner }))
    try {
      await reader.next()
      expect.unreachable()
    } catch (err) {
      expect(err).toBe(inner)
    }
  })

  test('a throwing [Symbol.asyncIterator]() and a synchronously throwing stream() are source_error', async () => {
    const iterable = {
      [Symbol.asyncIterator]: () => {
        throw new TypeError('no iterator')
      },
    } as unknown as AsyncIterable<Uint8Array>
    try {
      byteReader(iterable)
      expect.unreachable()
    } catch (err) {
      expect((err as OracleError).code).toBe('source_error')
    }
    const source = {
      name: 'sync-throw',
      stream(): AsyncIterable<Uint8Array> {
        throw new RangeError('bad config')
      },
    }
    expect(await codeOf(byteReader(source).next())).toBe('source_error')
  })

  test('after abort, a source that throws its own abort error still reports aborted', async () => {
    const controller = new AbortController()
    const source = {
      name: 'honours-signal',
      stream(opts?: { signal?: AbortSignal }) {
        return (async function* () {
          await new Promise((_, reject) =>
            opts?.signal?.addEventListener('abort', () => reject(new Error('AbortError'))),
          )
          yield new Uint8Array([1])
        })()
      },
    }
    const reader = byteReader(source, { signal: controller.signal })
    const pending = codeOf(reader.next())
    await Promise.resolve()
    controller.abort()
    expect(await pending).toBe('aborted')
  })

  test('after abort, a source that returns cleanly reports aborted, not insufficient_entropy', async () => {
    const controller = new AbortController()
    const source = {
      name: 'returns-on-abort',
      stream(opts?: { signal?: AbortSignal }) {
        return (async function* () {
          yield new Uint8Array([1])
          await new Promise((resolve) => opts?.signal?.addEventListener('abort', resolve))
          // clean end instead of a throw
        })()
      },
    }
    const reader = byteReader(source, { signal: controller.signal })
    expect(await reader.next()).toBe(1)
    const pending = codeOf(reader.next())
    await Promise.resolve()
    controller.abort()
    expect(await pending).toBe('aborted')
    expect(await codeOf(reader.next())).toBe('aborted')
  })
})
