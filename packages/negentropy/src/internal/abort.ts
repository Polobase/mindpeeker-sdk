import type { NegentropyError } from '../errors.js'

/**
 * How long an abort waits for upstream cleanup. `return()` on an async
 * generator only takes effect at a yield point — a source stuck in an await
 * would otherwise block cleanup (and the consumer's rejection) forever.
 */
const ABORT_CLEANUP_GRACE_MS = 100

/**
 * Pull the next item, racing the pull against the signal: an abort rejects
 * immediately with `abortError()` even while the upstream is blocked or
 * ignores the signal. The abort listener is removed once the pull settles.
 */
export function nextOrAbort<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal | undefined,
  abortError: () => NegentropyError,
): Promise<IteratorResult<T>> {
  if (!signal) return iterator.next()
  if (signal.aborted) return Promise.reject(abortError())
  const pending = iterator.next()
  return new Promise<IteratorResult<T>>((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    pending.then(
      (result) => {
        signal.removeEventListener('abort', onAbort)
        resolve(result)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

/**
 * Release an upstream iterator (`return()`), swallowing cleanup errors. After
 * an abort the wait is capped at a short grace period; on normal early exit
 * cleanup is awaited in full.
 */
export async function closeIterator(
  iterator: AsyncIterator<unknown>,
  aborted: boolean,
): Promise<void> {
  const cleanup = iterator.return?.().then(
    () => undefined,
    () => undefined,
  )
  if (!cleanup) return
  if (!aborted) {
    await cleanup
    return
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const grace = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ABORT_CLEANUP_GRACE_MS)
  })
  await Promise.race([cleanup, grace])
  clearTimeout(timer)
}
