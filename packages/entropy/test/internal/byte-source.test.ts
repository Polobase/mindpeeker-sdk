import { describe, expect, test } from 'bun:test'
import { iterateBytes, persistentBytes } from '../../src/internal/byte-source.js'

async function* chunks(...parts: number[][]) {
  for (const part of parts) yield new Uint8Array(part)
}

describe('iterateBytes', () => {
  test('passes through an AsyncIterable unchanged', async () => {
    const out: Uint8Array[] = []
    for await (const chunk of iterateBytes(chunks([1, 2], [3]))) out.push(chunk)
    expect(out).toEqual([new Uint8Array([1, 2]), new Uint8Array([3])])
  })

  test('skips empty chunks', async () => {
    const out: Uint8Array[] = []
    for await (const chunk of iterateBytes(chunks([1], [], [2]))) out.push(chunk)
    expect(out).toEqual([new Uint8Array([1]), new Uint8Array([2])])
  })

  test('adapts a ReadableStream', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([9, 8]))
        controller.enqueue(new Uint8Array([7]))
        controller.close()
      },
    })
    const out: Uint8Array[] = []
    for await (const chunk of iterateBytes(stream)) out.push(chunk)
    expect(out).toEqual([new Uint8Array([9, 8]), new Uint8Array([7])])
  })

  test('cancels the ReadableStream reader on early break', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array([1]))
      },
      cancel() {
        cancelled = true
      },
    })
    for await (const _chunk of iterateBytes(stream)) break
    expect(cancelled).toBe(true)
  })

  test('calls return() on the inner iterator on early break', async () => {
    let returned = false
    const source: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => ({ done: false, value: new Uint8Array([1]) }),
          return: async () => {
            returned = true
            return { done: true, value: undefined }
          },
        }
      },
    }
    for await (const _chunk of iterateBytes(source)) break
    expect(returned).toBe(true)
  })

  test('rejects when the signal aborts during a pending read', async () => {
    const controller = new AbortController()
    const hanging = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) })
    const iter = iterateBytes(hanging, controller.signal)[Symbol.asyncIterator]()
    const pending = iter.next()
    controller.abort()
    const err = await pending.catch((e) => e)
    expect(err).toBeDefined()
    expect((err as Error).name).toMatch(/AbortError/)
  })

  test('throws immediately for a pre-aborted signal', async () => {
    const iter = iterateBytes(chunks([1]), AbortSignal.abort())[Symbol.asyncIterator]()
    const err = await iter.next().catch((e) => e)
    expect((err as Error).name).toMatch(/AbortError/)
  })
})

describe('iterateBytes with a pathological source', () => {
  test('does not hang when aborting a source that never yields', async () => {
    // suspended at awaits forever, never reaches a yield — return() can
    // never take effect, so cleanup must not be awaited unboundedly
    async function* starving(): AsyncGenerator<Uint8Array> {
      while (true) await new Promise((r) => setTimeout(r, 1))
    }
    const start = Date.now()
    const iter = iterateBytes(starving(), AbortSignal.timeout(40))[Symbol.asyncIterator]()
    const err = await iter.next().catch((e) => e)
    expect((err as Error).name).toMatch(/TimeoutError|AbortError/)
    expect(Date.now() - start).toBeLessThan(500)
  })
})

describe('persistentBytes', () => {
  async function* counting() {
    let n = 0
    while (true) yield new Uint8Array([n++, n++])
  }

  test('later views continue where earlier views stopped', async () => {
    const view = persistentBytes(counting())
    const first = view()
    expect((await first.next()).value).toEqual(new Uint8Array([0, 1]))
    await first.return?.(undefined)
    const second = view()
    expect((await second.next()).value).toEqual(new Uint8Array([2, 3]))
    await second.return?.(undefined)
  })

  test('closing a view does not close the shared source', async () => {
    let closed = false
    async function* source() {
      try {
        let n = 0
        while (true) yield new Uint8Array([n++])
      } finally {
        closed = true
      }
    }
    const view = persistentBytes(source())
    for await (const _chunk of view()) break
    expect(closed).toBe(false)
    expect((await view()[Symbol.asyncIterator]().next()).done).toBe(false)
  })

  test('a view aborts on its own signal without killing the source', async () => {
    const view = persistentBytes(counting())
    const controller = new AbortController()
    const aborting = view(controller.signal)[Symbol.asyncIterator]()
    controller.abort()
    const err = await aborting.next().catch((e) => e)
    expect((err as Error).name).toMatch(/AbortError/)
    expect((await view()[Symbol.asyncIterator]().next()).done).toBe(false)
  })
})
