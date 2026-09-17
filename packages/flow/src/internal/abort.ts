/**
 * Abort-aware iteration for the streaming layer, mirroring
 * `@mindpeeker/entropy`'s `abortable()` and negentropy's `nextOrAbort()`: a
 * pending upstream pull is raced against the signal, every failure seen while
 * aborted becomes `FlowError('aborted')`, and cleanup after an abort is bounded.
 */

import { FlowError } from '../errors.js'

/**
 * How long an abort waits for upstream cleanup. `return()` on an async
 * generator only takes effect at a yield point — a source stuck in an await
 * would otherwise block cleanup (and the consumer's rejection) forever.
 */
export const ABORT_CLEANUP_GRACE_MS = 100

export function abortedError(what: string, cause?: unknown): FlowError {
  return new FlowError('aborted', `${what} aborted`, cause !== undefined ? { cause } : {})
}

export function throwIfAborted(signal: AbortSignal | undefined, what: string): void {
  if (signal?.aborted) throw abortedError(what, signal.reason)
}

/**
 * Map an upstream failure to the package contract: while the signal is
 * aborted anything becomes `aborted` (an upstream `FlowError('aborted')` passes
 * through); otherwise a `FlowError` passes through and anything else becomes
 * `source_error` with the original as `cause`.
 */
export function toFlowError(
  error: unknown,
  signal: AbortSignal | undefined,
  what: string,
  source: string,
): FlowError {
  if (signal?.aborted) {
    if (error instanceof FlowError && error.code === 'aborted') return error
    return abortedError(what, error)
  }
  if (error instanceof FlowError) return error
  const detail = error instanceof Error ? error.message : String(error)
  return new FlowError('source_error', `${what}: ${source} failed: ${detail}`, {
    cause: error,
    source,
  })
}

/**
 * Pull the next item, racing the pull against the signal: an abort rejects
 * immediately (with `signal.reason` as the cause) even while the upstream is
 * blocked or ignores the signal. The listener is removed once the pull
 * settles; a pull that settles after the abort is observed but ignored.
 */
export function nextOrAbort<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal | undefined,
  what: string,
): Promise<IteratorResult<T>> {
  if (signal?.aborted) return Promise.reject(abortedError(what, signal.reason))
  let pending: Promise<IteratorResult<T>>
  try {
    pending = Promise.resolve(iterator.next())
  } catch (error) {
    return Promise.reject(error)
  }
  if (signal === undefined) return pending
  return new Promise<IteratorResult<T>>((resolve, reject) => {
    const onAbort = () => reject(abortedError(what, signal.reason))
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
 * an abort the wait is capped at {@link ABORT_CLEANUP_GRACE_MS}; on normal
 * completion or early exit cleanup is awaited in full.
 */
export async function closeIterator(
  iterator: AsyncIterator<unknown>,
  aborted: boolean,
): Promise<void> {
  let cleanup: Promise<void> | undefined
  try {
    const ret = iterator.return?.()
    if (ret !== undefined) {
      cleanup = Promise.resolve(ret).then(
        () => undefined,
        () => undefined,
      )
    }
  } catch {
    return
  }
  if (cleanup === undefined) return
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
