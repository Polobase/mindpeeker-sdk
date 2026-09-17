import { describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import { guardStream } from '../../src/internal/guard-stream.js'

const bytes = (...values: number[]) => new Uint8Array(values)

async function firstError(iterable: AsyncIterable<Uint8Array>): Promise<EntropyError | undefined> {
  try {
    for await (const _chunk of iterable) {
      /* drain */
    }
    return undefined
  } catch (e) {
    return e as EntropyError
  }
}

/** Upstream that yields one chunk, then blocks until its signal aborts. */
function blockingSource(record: { opened: number; closed: number; sawAbort: boolean }) {
  return (signal: AbortSignal) =>
    (async function* () {
      record.opened++
      try {
        yield bytes(1)
        await new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              record.sawAbort = true
              reject(signal.reason)
            },
            { once: true },
          )
        })
      } finally {
        record.closed++
      }
    })()
}

describe('guardStream', () => {
  test('is lazy: the factory runs on the first pull, not before', async () => {
    const record = { opened: 0, closed: 0, sawAbort: false }
    const guarded = guardStream(blockingSource(record), { provider: 'p' })
    expect(record.opened).toBe(0)
    const first = await guarded.next()
    expect(first.value).toEqual(bytes(1))
    expect(record.opened).toBe(1)
    await guarded.return(undefined)
    expect(record.closed).toBe(1)
  })

  test('passes values through and ends when the upstream ends', async () => {
    async function* finite() {
      yield bytes(1)
      yield bytes(2)
    }
    const out: Uint8Array[] = []
    for await (const chunk of guardStream(finite(), { provider: 'p' })) out.push(chunk)
    expect(out).toEqual([bytes(1), bytes(2)])
  })

  test('a caller abort rejects the blocked pull with aborted and aborts the upstream', async () => {
    const record = { opened: 0, closed: 0, sawAbort: false }
    const controller = new AbortController()
    const guarded = guardStream(blockingSource(record), {
      provider: 'p',
      signal: controller.signal,
    })
    await guarded.next()
    const pending = guarded.next()
    controller.abort()
    const err = (await pending.catch((e) => e)) as EntropyError
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.code).toBe('aborted')
    expect(err.provider).toBe('p')
    expect(record.sawAbort).toBe(true)
    expect(record.closed).toBe(1)
  })

  test('a pre-aborted signal rejects before opening the upstream', async () => {
    const record = { opened: 0, closed: 0, sawAbort: false }
    const err = await firstError(
      guardStream(blockingSource(record), { provider: 'p', signal: AbortSignal.abort() }),
    )
    expect(err?.code).toBe('aborted')
    expect(record.opened).toBe(0)
  })

  test('an upstream that stops ignoring the signal still yields aborted promptly', async () => {
    const controller = new AbortController()
    async function* deaf() {
      yield bytes(1)
      await new Promise(() => {}) // never settles, ignores every signal
    }
    const guarded = guardStream(deaf(), { provider: 'p', signal: controller.signal })
    await guarded.next()
    const pending = guarded.next()
    setTimeout(() => controller.abort(), 5)
    const started = Date.now()
    const err = (await pending.catch((e) => e)) as EntropyError
    expect(err.code).toBe('aborted')
    await guarded.return(undefined) // cleanup waits at most the grace period
    expect(Date.now() - started).toBeLessThan(1000)
  })

  test('an upstream that ends cleanly after the caller aborted is reported as aborted', async () => {
    const controller = new AbortController()
    async function* endsOnAbort() {
      yield bytes(1)
      controller.abort()
    }
    const err = await firstError(
      guardStream(endsOnAbort(), { provider: 'p', signal: controller.signal }),
    )
    expect(err?.code).toBe('aborted')
  })

  test('a pull exceeding timeoutMs rejects with timeout and aborts the upstream', async () => {
    const record = { opened: 0, closed: 0, sawAbort: false }
    const guarded = guardStream(blockingSource(record), { provider: 'p', timeoutMs: 30 })
    await guarded.next()
    const err = (await guarded.next().catch((e) => e)) as EntropyError
    expect(err.code).toBe('timeout')
    expect(err.message).toContain('30ms')
    expect(record.sawAbort).toBe(true)
  })

  test('the timeout applies per pull, not to the stream lifetime', async () => {
    async function* slowButSteady() {
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 15))
        yield bytes(i)
      }
    }
    const out: Uint8Array[] = []
    for await (const chunk of guardStream(slowButSteady(), { provider: 'p', timeoutMs: 60 })) {
      out.push(chunk)
    }
    expect(out).toHaveLength(5) // 75 ms total > 60 ms budget, but each pull is 15 ms
  })

  test('foreign upstream errors become network with the original as cause', async () => {
    const boom = new Error('EIO: device unplugged')
    async function* failing() {
      yield bytes(1)
      throw boom
    }
    const err = await firstError(guardStream(failing(), { provider: 'serial' }))
    expect(err?.code).toBe('network')
    expect(err?.cause).toBe(boom)
    expect(err?.message).toContain('EIO')
    expect(err?.provider).toBe('serial')
  })

  test('EntropyErrors from the upstream pass through unchanged', async () => {
    const original = new EntropyError('health_test', 'rct', { provider: 'camera' })
    async function* failing() {
      yield bytes(1)
      throw original
    }
    expect(await firstError(guardStream(failing(), { provider: 'camera' }))).toBe(original)
  })

  test('a factory that throws synchronously surfaces as a mapped error on the first pull', async () => {
    const err = await firstError(
      guardStream(
        () => {
          throw new TypeError('bad upstream')
        },
        { provider: 'p' },
      ),
    )
    expect(err?.code).toBe('network')
  })
})
