import { describe, expect, test } from 'bun:test'
import { pollStream, rechunk } from '../../src/internal/stream.js'
import type { EntropyRequestOptions, EntropyResult } from '../../src/types.js'

function countingSource(byte = 7) {
  const calls: number[] = []
  return {
    calls,
    async getBytes(length: number, _opts?: EntropyRequestOptions): Promise<EntropyResult> {
      calls.push(length)
      return {
        bytes: new Uint8Array(length).fill(byte),
        sources: [{ name: 'stub', kind: 'csprng', privacy: 'private' }] as const,
      }
    },
  }
}

describe('pollStream', () => {
  test('is lazy: no getBytes call before the first next()', async () => {
    const source = countingSource()
    const stream = pollStream(source, {}, 16)
    expect(source.calls).toHaveLength(0)
    const iter = stream[Symbol.asyncIterator]()
    expect(source.calls).toHaveLength(0)
    await iter.next()
    expect(source.calls).toHaveLength(1)
    await iter.return?.()
  })

  test('pulls exactly one chunk per next() (backpressure)', async () => {
    const source = countingSource()
    const iter = pollStream(source, {}, 8)[Symbol.asyncIterator]()
    const a = await iter.next()
    const b = await iter.next()
    expect(a.value).toEqual(new Uint8Array(8).fill(7))
    expect(b.value).toEqual(new Uint8Array(8).fill(7))
    expect(source.calls).toEqual([8, 8])
    await iter.return?.()
  })

  test('honors chunkBytes option over the provider default', async () => {
    const source = countingSource()
    const iter = pollStream(source, { chunkBytes: 3 }, 64)[Symbol.asyncIterator]()
    const { value } = await iter.next()
    expect(value).toEqual(new Uint8Array([7, 7, 7]))
    expect(source.calls).toEqual([3])
    await iter.return?.()
  })

  test('stops cleanly when the consumer breaks out', async () => {
    const source = countingSource()
    let seen = 0
    for await (const chunk of pollStream(source, {}, 4)) {
      expect(chunk).toHaveLength(4)
      seen++
      if (seen === 2) break
    }
    expect(source.calls).toEqual([4, 4])
  })
})

describe('rechunk', () => {
  async function* chunks(...parts: number[][]) {
    for (const part of parts) yield new Uint8Array(part)
  }

  test('re-slices into fixed-size chunks across boundaries', async () => {
    const out: Uint8Array[] = []
    for await (const chunk of rechunk(chunks([1, 2, 3], [4, 5, 6, 7, 8]), 4)) {
      out.push(chunk)
    }
    expect(out).toEqual([new Uint8Array([1, 2, 3, 4]), new Uint8Array([5, 6, 7, 8])])
  })

  test('flushes a short tail when the source ends', async () => {
    const out: Uint8Array[] = []
    for await (const chunk of rechunk(chunks([1, 2], [3]), 2)) {
      out.push(chunk)
    }
    expect(out).toEqual([new Uint8Array([1, 2]), new Uint8Array([3])])
  })

  test('splits one large chunk into many', async () => {
    const out: Uint8Array[] = []
    for await (const chunk of rechunk(chunks([1, 2, 3, 4, 5]), 2)) {
      out.push(chunk)
    }
    expect(out).toEqual([new Uint8Array([1, 2]), new Uint8Array([3, 4]), new Uint8Array([5])])
  })
})
