import { describe, expect, test } from 'bun:test'
import { type ByteReader, byteReader } from '../../src/core/reader.js'
import { OracleError } from '../../src/errors.js'
import { liveSource, stalledIterable } from '../helpers/byte-sources.js'

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p
    return 'no-throw'
  } catch (err) {
    expect(err).toBeInstanceOf(OracleError)
    return (err as OracleError).code
  }
}

/** A 0.1.x-style reader: next() + bytesConsumed, no close(). */
function foreignReader(values: readonly unknown[]): ByteReader {
  let i = 0
  return {
    get bytesConsumed() {
      return i
    },
    next: async () => values[i++] as number,
  } as unknown as ByteReader
}

describe('byteReader(existingReader, { signal })', () => {
  test('returns an abortable view with delegated accounting', async () => {
    const shared = byteReader(new Uint8Array([1, 2, 3]))
    await shared.next()
    const controller = new AbortController()
    const view = byteReader(shared, { signal: controller.signal })
    expect(view).not.toBe(shared)
    expect(view.bytesConsumed).toBe(1)
    expect(await view.next()).toBe(2)
    expect(shared.bytesConsumed).toBe(2)
    expect(view.bytesFetched).toBe(2)
  })

  test('aborting the signal rejects a pending read on a shared stalled reader', async () => {
    const shared = byteReader(stalledIterable())
    const controller = new AbortController()
    const view = byteReader(shared, { signal: controller.signal })
    const pending = codeOf(view.next())
    controller.abort()
    expect(await pending).toBe('aborted')
  })

  test('an already-aborted signal fails fast without touching the inner reader', async () => {
    const shared = byteReader(new Uint8Array([1]))
    const view = byteReader(shared, { signal: AbortSignal.abort() })
    expect(await codeOf(view.next())).toBe('aborted')
    expect(shared.bytesConsumed).toBe(0)
  })

  test("the inner reader's own signal keeps governing reads through the view", async () => {
    const own = new AbortController()
    const shared = byteReader(stalledIterable(), { signal: own.signal })
    const view = byteReader(shared, { signal: new AbortController().signal })
    const pending = codeOf(view.next())
    own.abort()
    expect(await pending).toBe('aborted')
  })

  test('closing the view does not close the shared reader', async () => {
    const source = liveSource('shared', 8)
    const shared = byteReader(source)
    const view = byteReader(shared, { signal: new AbortController().signal })
    await view.next()
    await view.close()
    expect(await codeOf(view.next())).toBe('closed')
    expect(source.finalized).toBe(0)
    expect(typeof (await shared.next())).toBe('number')
    await shared.close()
    expect(source.finalized).toBe(1)
  })

  test('closing a view rejects its pending read with closed; the shared reader keeps the pull', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    async function* gated() {
      await gate
      yield new Uint8Array([7])
    }
    const shared = byteReader(gated())
    const view = byteReader(shared, { signal: new AbortController().signal })
    const pending = codeOf(view.next())
    await view.close()
    expect(await pending).toBe('closed')
    release?.()
    expect(await shared.next()).toBe(7)
  })

  test('views nest: both signals govern', async () => {
    const shared = byteReader(stalledIterable())
    const outer = new AbortController()
    const inner = byteReader(shared, { signal: new AbortController().signal })
    const view = byteReader(inner, { signal: outer.signal })
    const pending = codeOf(view.next())
    outer.abort()
    expect(await pending).toBe('aborted')
  })
})

describe('views over foreign readers', () => {
  test('bytes are validated and foreign failures wrapped as source_error', async () => {
    const signal = new AbortController().signal
    const ok = byteReader(foreignReader([7]), { signal })
    expect(await ok.next()).toBe(7)
    expect(ok.bytesFetched).toBeUndefined()

    const badByte = byteReader(foreignReader([256]), { signal })
    expect(await codeOf(badByte.next())).toBe('invalid_input')

    const cause = new TypeError('driver failed')
    const throwing = {
      bytesConsumed: 0,
      next: async () => {
        throw cause
      },
    } as unknown as ByteReader
    try {
      await byteReader(throwing, { signal }).next()
      expect.unreachable()
    } catch (err) {
      expect((err as OracleError).code).toBe('source_error')
      expect((err as OracleError).cause).toBe(cause)
    }
  })

  test('a foreign reader without close() is returned unchanged without a signal', () => {
    const foreign = foreignReader([1])
    expect(byteReader(foreign)).toBe(foreign)
  })

  test('closing a view over a stalled foreign reader rejects the pending read with closed', async () => {
    const stalled = {
      bytesConsumed: 0,
      next: () => new Promise<number>(() => {}),
    } as unknown as ByteReader
    const view = byteReader(stalled, { signal: new AbortController().signal })
    const pending = codeOf(view.next())
    await view.close()
    expect(await pending).toBe('closed')
  })

  test('concurrent reads through one view of a foreign reader: the second throws invalid_input', async () => {
    let release: ((v: number) => void) | undefined
    const slow = {
      bytesConsumed: 0,
      next: () =>
        new Promise<number>((resolve) => {
          release = resolve
        }),
    } as unknown as ByteReader
    const view = byteReader(slow, { signal: new AbortController().signal })
    const first = view.next()
    expect(await codeOf(view.next())).toBe('invalid_input')
    release?.(5)
    expect(await first).toBe(5)
  })
})
