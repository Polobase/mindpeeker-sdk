/**
 * Iterator plumbing shared by the dashboard pumps and the demo fan-out:
 * owning an iterator (so it can be closed), pulls that a stop/abort can
 * pre-empt without leaking listeners, and bounded `return()`.
 */

/** Sentinel a {@link cancellableNext} pull resolves to when it was cancelled. */
export const CANCELLED: unique symbol = Symbol('cancelled')

/**
 * Own an iterator over an async iterable — or a sync one, which `for await`
 * also accepts. Returns `undefined` when `src` is neither, so callers can
 * raise their own typed error.
 */
export function toAsyncIterator<T>(src: unknown): AsyncIterator<T> | undefined {
  if (typeof src !== 'object' || src === null) return undefined
  const asyncFactory = (src as Partial<AsyncIterable<T>>)[Symbol.asyncIterator]
  if (typeof asyncFactory === 'function') return asyncFactory.call(src)
  const syncFactory = (src as Partial<Iterable<T>>)[Symbol.iterator]
  if (typeof syncFactory === 'function') {
    const iterable = src as Iterable<T>
    return (async function* adapt(): AsyncGenerator<T> {
      yield* iterable
    })()
  }
  return undefined
}

/** A pending pull plus the function that pre-empts it. */
export interface CancellablePull<T> {
  /** Settles with the upstream result, or {@link CANCELLED} once `cancel()` ran first. */
  readonly result: Promise<IteratorResult<T> | typeof CANCELLED>
  /** Resolve `result` with {@link CANCELLED} now (no-op once it settled). */
  cancel(): void
}

/**
 * Start `iterator.next()` and return it together with a `cancel` hook. Unlike
 * `Promise.race` against a long-lived stop promise, nothing is registered on a
 * shared promise per pull, so millions of pulls retain nothing. A rejection
 * of the abandoned upstream pull after cancellation is observed (no unhandled
 * rejection).
 */
export function cancellableNext<T>(iterator: AsyncIterator<T>): CancellablePull<T> {
  let cancel: () => void = () => {}
  const result = new Promise<IteratorResult<T> | typeof CANCELLED>((resolve, reject) => {
    cancel = () => resolve(CANCELLED)
    iterator.next().then(resolve, reject)
  })
  return { result, cancel }
}

/**
 * Pull the next item unless `signal` aborts first, in which case the pull
 * resolves to {@link CANCELLED}. The abort listener is removed as soon as the
 * pull settles.
 */
export async function nextUnlessAborted<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal | undefined,
): Promise<IteratorResult<T> | typeof CANCELLED> {
  if (!signal) return iterator.next()
  if (signal.aborted) return CANCELLED
  const pull = cancellableNext(iterator)
  const onAbort = () => pull.cancel()
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await pull.result
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * Release an iterator with `return()`, swallowing cleanup errors and waiting at
 * most `graceMs`: `return()` on an async generator that is suspended inside an
 * `await` only runs once that await settles, which may be never.
 */
export async function closeIterator(
  iterator: AsyncIterator<unknown>,
  graceMs: number,
): Promise<void> {
  let cleanup: Promise<unknown> | undefined
  try {
    cleanup = iterator.return?.()
  } catch {
    return
  }
  if (!cleanup) return
  const settled = cleanup.then(
    () => undefined,
    () => undefined,
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  const grace = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, graceMs)
  })
  await Promise.race([settled, grace])
  clearTimeout(timer)
}

/** Resolve after `ms`, or immediately once `signal` aborts (listener removed either way). */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}
