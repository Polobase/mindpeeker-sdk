import { EntropyError } from '../errors.js'

/**
 * How long a failed or aborted pull waits for upstream cleanup. `return()` on
 * an async generator only takes effect at a yield point — a source stuck in
 * an await would otherwise block the consumer's rejection forever.
 */
const CLEANUP_GRACE_MS = 100

export interface GuardStreamOptions {
  /** Provider name attached to every mapped error. */
  provider: string
  /** Caller's signal: an abort rejects the pending pull with `aborted`. */
  signal?: AbortSignal
  /** Budget for each pull (`next()`), in ms. Omitted: no per-pull timeout. */
  timeoutMs?: number
}

/**
 * An upstream iterable, or a factory that receives the guard's composite
 * signal (caller abort OR per-pull timeout) so the upstream can release its
 * resources when either fires. Factories are called lazily on the first pull.
 */
export type GuardedSource<T> = AsyncIterable<T> | ((signal: AbortSignal) => AsyncIterable<T>)

function graceful(cleanup: Promise<unknown> | undefined, waitFully: boolean): Promise<unknown> {
  if (!cleanup) return Promise.resolve()
  const settled = cleanup.catch(() => {})
  if (waitFully) return settled
  return Promise.race([settled, new Promise((resolve) => setTimeout(resolve, CLEANUP_GRACE_MS))])
}

/** One pull, raced against the composite signal and the per-pull timer. */
function pull<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal,
  timeoutMs: number | undefined,
  onTimeout: () => void,
): Promise<IteratorResult<T>> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
      if (timer !== undefined) clearTimeout(timer)
    }
    const onAbort = () => {
      cleanup()
      reject(signal.reason)
    }
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (timeoutMs !== undefined) timer = setTimeout(onTimeout, timeoutMs)
    let pending: Promise<IteratorResult<T>>
    try {
      pending = iterator.next()
    } catch (error) {
      cleanup()
      reject(error)
      return
    }
    pending.then(
      (result) => {
        cleanup()
        resolve(result)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      },
    )
  })
}

/**
 * Give any byte stream the `EntropyError` taxonomy of `getBytes`:
 *
 * - a caller abort rejects the pending pull at once with `aborted` (also when
 *   the upstream then ends cleanly or throws its own abort error);
 * - a pull exceeding `timeoutMs` aborts the upstream's signal and rejects with
 *   `timeout`;
 * - an `EntropyError` from the upstream passes through unchanged;
 * - any other upstream failure becomes `network` with the original as `cause`.
 *
 * Lazy: nothing (not even the factory) runs before the first `next()`. The
 * upstream iterator is closed when the consumer stops early or a pull fails
 * (waiting at most 100 ms when the upstream is stuck in an await).
 */
export async function* guardStream<T>(
  source: GuardedSource<T>,
  opts: GuardStreamOptions,
): AsyncGenerator<T> {
  const { provider, signal: callerSignal, timeoutMs } = opts
  const aborted = (cause?: unknown) =>
    new EntropyError('aborted', 'stream aborted', { provider, cause })
  if (callerSignal?.aborted) throw aborted(callerSignal.reason)

  const internal = new AbortController()
  const signal = callerSignal ? AbortSignal.any([callerSignal, internal.signal]) : internal.signal
  let timedOut = false
  const onTimeout = () => {
    timedOut = true
    internal.abort(new DOMException(`stream pull exceeded ${timeoutMs}ms`, 'TimeoutError'))
  }

  const classify = (error: unknown): EntropyError => {
    if (callerSignal?.aborted) {
      return error instanceof EntropyError && error.code === 'aborted' ? error : aborted(error)
    }
    if (timedOut) {
      return new EntropyError('timeout', `stream pull exceeded ${timeoutMs}ms`, {
        provider,
        cause: error,
      })
    }
    if (error instanceof EntropyError) return error
    const message = error instanceof Error ? error.message : String(error)
    return new EntropyError('network', `stream source failed: ${message}`, {
      provider,
      cause: error,
    })
  }

  let iterator: AsyncIterator<T> | undefined
  let upstreamDone = false
  let failed = false
  try {
    try {
      const iterable = typeof source === 'function' ? source(signal) : source
      iterator = iterable[Symbol.asyncIterator]()
    } catch (error) {
      upstreamDone = true
      throw classify(error)
    }
    while (true) {
      let result: IteratorResult<T>
      try {
        result = await pull(iterator, signal, timeoutMs, onTimeout)
      } catch (error) {
        failed = true
        throw classify(error)
      }
      if (result.done) {
        upstreamDone = true
        if (callerSignal?.aborted) throw aborted(callerSignal.reason)
        if (timedOut) throw classify(undefined)
        return
      }
      yield result.value
    }
  } finally {
    if (iterator && !upstreamDone) {
      let cleanup: Promise<unknown> | undefined
      try {
        cleanup = iterator.return?.()
      } catch {
        cleanup = undefined
      }
      // A failed pull left the upstream suspended in an await: only wait briefly.
      await graceful(cleanup, !failed)
    }
  }
}
