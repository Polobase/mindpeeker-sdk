// Keeping long computations off the main thread's back. SSR-safe.
//
// Anything that would block for more than ~200 ms must either run in a Web
// Worker (app/workers/) or yield here every few milliseconds, so the progress
// bar paints and Cancel stays clickable.

/**
 * Yield to the event loop for one macrotask. `MessageChannel` is used instead
 * of `setTimeout`, whose nested calls are clamped to ~4 ms per turn.
 */
export function nextMacrotask(): Promise<void> {
  if (typeof MessageChannel === 'undefined') {
    return new Promise((resolve) => setTimeout(resolve, 0))
  }
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      resolve()
    }
    channel.port2.postMessage(undefined)
  })
}

export interface Yielder {
  /** Yield if the budget has elapsed; throws `AbortError` when aborted. */
  (): Promise<void>
}

/**
 * A budgeted yielder for chunked loops: it returns immediately while the
 * current slice is under `budgetMs` and hands the main thread back when it is
 * not, so nothing freezes the UI.
 *
 * ```ts
 * const tick = createYielder(8, signal)
 * for (let i = 0; i < 1e7; i++) {
 *   work(i)
 *   if ((i & 1023) === 0) { setProgress(i / 1e7); await tick() }
 * }
 * ```
 */
export function createYielder(budgetMs = 8, signal?: AbortSignal): Yielder {
  let last = now()
  return async () => {
    throwIfAborted(signal)
    if (now() - last < budgetMs) return
    await nextMacrotask()
    last = now()
    throwIfAborted(signal)
  }
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

/** Throw a DOMException('AbortError') when the signal has fired. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const reason = signal.reason
  if (reason instanceof Error) throw reason
  throw new DOMException('the run was cancelled', 'AbortError')
}

/** A promise that rejects when the signal fires — for racing against I/O. */
export function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) return reject(new DOMException('the run was cancelled', 'AbortError'))
    signal.addEventListener(
      'abort',
      () => reject(new DOMException('the run was cancelled', 'AbortError')),
      { once: true },
    )
  })
}
