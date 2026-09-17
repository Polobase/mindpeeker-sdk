import { describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import { defineProvider } from '../../src/internal/provider.js'
import {
  type BeaconPoll,
  beaconStream,
  compareBeaconIds,
  pollStream,
  rechunk,
} from '../../src/internal/stream.js'
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

  test('rejects a size that is not an integer >= 1 instead of looping on empty chunks', async () => {
    for (const bad of [0, -2, 1.5, Number.NaN]) {
      const err = (await rechunk(chunks([1, 2, 3]), bad)
        .next()
        .catch((e) => e)) as EntropyError
      expect(err).toBeInstanceOf(EntropyError)
      expect(err.code).toBe('invalid_request')
    }
  })
})

describe('pollStream error taxonomy', () => {
  test('a caller abort rejects the pending pull at once with aborted', async () => {
    const slow = defineProvider({
      name: 'slow',
      kind: 'csprng',
      privacy: 'private',
      getBytes: () => new Promise(() => {}), // ignores its signal on purpose
    })
    const controller = new AbortController()
    const iterator = slow.stream({ signal: controller.signal })[Symbol.asyncIterator]()
    const pending = iterator.next()
    setTimeout(() => controller.abort(), 5)
    const err = (await pending.catch((e) => e)) as EntropyError
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.code).toBe('aborted')
    expect(err.provider).toBe('slow')
  })
})

describe('compareBeaconIds', () => {
  test('orders numbers and tuples lexicographically', () => {
    expect(compareBeaconIds(2, 1)).toBe(1)
    expect(compareBeaconIds(1, 1)).toBe(0)
    expect(compareBeaconIds([2, 1], [1, 900])).toBe(1)
    expect(compareBeaconIds([1, 900], [2, 1])).toBe(-1)
    expect(compareBeaconIds([2, 5], [2, 5])).toBe(0)
    expect(compareBeaconIds([2], [2, 0])).toBe(-1)
    expect(compareBeaconIds(3, [3, 1])).toBe(-1)
  })
})

describe('beaconStream', () => {
  function script(polls: BeaconPoll[]) {
    let i = 0
    const calls: AbortSignal[] = []
    const fetchLatest = async (signal: AbortSignal) => {
      calls.push(signal)
      const poll = polls[Math.min(i, polls.length - 1)] as BeaconPoll
      i++
      return poll
    }
    return { fetchLatest, calls }
  }
  const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill)

  test('is lazy and yields only when the id advances', async () => {
    const { fetchLatest, calls } = script([
      { id: 1, bytes: bytes(4, 1) },
      { id: 1, bytes: bytes(4, 1) },
      { id: 0, bytes: bytes(4, 0) },
      { id: 2, bytes: bytes(4, 2) },
    ])
    const iterator = beaconStream(fetchLatest, 1, 'b')[Symbol.asyncIterator]()
    expect(calls).toHaveLength(0)
    expect((await iterator.next()).value).toEqual(bytes(4, 1))
    expect((await iterator.next()).value).toEqual(bytes(4, 2))
    expect(calls).toHaveLength(4)
    await iterator.return?.()
  })

  test('composite ids survive a chain reset', async () => {
    const { fetchLatest } = script([
      { id: [1, 900], bytes: bytes(2, 9) },
      { id: [2, 1], bytes: bytes(2, 1) },
      { id: [2, 2], bytes: bytes(2, 2) },
    ])
    const out: Uint8Array[] = []
    for await (const chunk of beaconStream(fetchLatest, 1, 'b')) {
      out.push(chunk)
      if (out.length === 3) break
    }
    expect(out.map((c) => c[0])).toEqual([9, 1, 2])
  })

  test('a poll exceeding timeoutMs rejects with EntropyError timeout', async () => {
    const hanging = () => new Promise<BeaconPoll>(() => {}) // ignores the signal
    const err = (await beaconStream(hanging, 1, 'b', { timeoutMs: 20 })
      [Symbol.asyncIterator]()
      .next()
      .catch((e) => e)) as EntropyError
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.code).toBe('timeout')
    expect(err.provider).toBe('b')
  })

  test('an abort while waiting between polls rejects at once with aborted', async () => {
    const { fetchLatest } = script([{ id: 1, bytes: bytes(1, 1) }])
    const controller = new AbortController()
    const iterator = beaconStream(fetchLatest, 60_000, 'b', {
      signal: controller.signal,
    })[Symbol.asyncIterator]()
    await iterator.next()
    const pending = iterator.next() // now sleeping 60 s before the next poll
    setTimeout(() => controller.abort(), 5)
    const started = Date.now()
    const err = (await pending.catch((e) => e)) as EntropyError
    expect(err.code).toBe('aborted')
    expect(Date.now() - started).toBeLessThan(1000)
  })

  test('a pre-aborted signal rejects the first pull without polling', async () => {
    const { fetchLatest, calls } = script([{ id: 1, bytes: bytes(1, 1) }])
    const err = (await beaconStream(fetchLatest, 1, 'b', { signal: AbortSignal.abort() })
      [Symbol.asyncIterator]()
      .next()
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('aborted')
    expect(calls).toHaveLength(0)
  })

  test('foreign poll failures become network; EntropyErrors keep their code', async () => {
    const foreign = async () => {
      throw new TypeError('boom')
    }
    const typed = async () => {
      throw new EntropyError('bad_response', 'bad')
    }
    for (const [fetchLatest, code] of [
      [foreign, 'network'],
      [typed, 'bad_response'],
    ] as const) {
      const err = (await beaconStream(fetchLatest, 1, 'b')
        [Symbol.asyncIterator]()
        .next()
        .catch((e) => e)) as EntropyError
      expect(err.code).toBe(code)
    }
  })

  test('chunkBytes always re-slices, even when it equals the payload size', async () => {
    const { fetchLatest } = script([
      { id: 1, bytes: bytes(64, 1) },
      { id: 2, bytes: bytes(64, 2) },
    ])
    const sizes: number[] = []
    for await (const chunk of beaconStream(fetchLatest, 1, 'b', { chunkBytes: 32 })) {
      sizes.push(chunk.length)
      if (sizes.length === 3) break
    }
    expect(sizes).toEqual([32, 32, 32])
  })
})
