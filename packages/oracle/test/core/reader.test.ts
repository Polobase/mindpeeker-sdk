import { describe, expect, test } from 'bun:test'
import { byteReader } from '../../src/core/reader.js'
import { OracleError } from '../../src/errors.js'
import { chunkSource, countingSource } from '../helpers/byte-sources.js'

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

  test('returns an existing ByteReader unchanged', () => {
    const reader = byteReader(new Uint8Array([1]))
    expect(byteReader(reader)).toBe(reader)
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
})
