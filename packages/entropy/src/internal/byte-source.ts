import { sleep } from './rate-limit.js'

/** Any pull-able byte producer a local provider can consume. */
export type ByteSource = AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>

/**
 * How long an abort waits for generator cleanup. return() on an async
 * generator only takes effect at a yield point — a source stuck in awaits
 * without yielding would otherwise block cleanup forever.
 */
const ABORT_CLEANUP_GRACE_MS = 100

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}

/** Race a pending read against signal abort, cleaning the listener up either way. */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

/**
 * Share one underlying byte iterator across many short-lived consumer views.
 * A view's early termination or abort never closes the shared source — its
 * lifetime belongs to whoever created it. Used for injected sources that
 * must survive repeated getBytes sessions.
 */
export function persistentBytes(
  source: ByteSource,
): (signal?: AbortSignal) => AsyncGenerator<Uint8Array> {
  const shared = iterateBytes(source)[Symbol.asyncIterator]()
  return async function* view(signal?: AbortSignal) {
    while (true) {
      if (signal?.aborted) throw abortError(signal)
      const { done, value } = await abortable(shared.next(), signal)
      if (done) return
      yield value
    }
  }
}

/**
 * Uniform pull adapter over both ByteSource shapes. Skips empty chunks,
 * releases the ReadableStream reader (or calls the inner iterator's
 * return()) on early termination, and rejects promptly on signal abort.
 */
export async function* iterateBytes(
  source: ByteSource,
  signal?: AbortSignal,
): AsyncGenerator<Uint8Array> {
  if (typeof (source as ReadableStream<Uint8Array>).getReader === 'function') {
    const reader = (source as ReadableStream<Uint8Array>).getReader()
    try {
      while (true) {
        if (signal?.aborted) throw abortError(signal)
        const { done, value } = await abortable(reader.read(), signal)
        if (done) return
        if (value && value.length > 0) yield value
      }
    } finally {
      reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  } else {
    const iterator = (source as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]()
    try {
      while (true) {
        if (signal?.aborted) throw abortError(signal)
        const { done, value } = await abortable(iterator.next(), signal)
        if (done) return
        if (value && value.length > 0) yield value
      }
    } finally {
      const cleanup = iterator.return?.().catch(() => {})
      if (cleanup) {
        // On abort, wait only briefly — a source that never yields would
        // block return() forever. Normal termination waits for full cleanup.
        if (signal?.aborted) await Promise.race([cleanup, sleep(ABORT_CLEANUP_GRACE_MS)])
        else await cleanup
      }
    }
  }
}
