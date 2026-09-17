function abortError(signal: AbortSignal): Error {
  const reason = signal.reason
  if (reason instanceof Error) return reason
  return new DOMException('The operation was aborted.', 'AbortError')
}

/**
 * Resolve after `ms`, or reject with the signal's abort reason as soon as the
 * signal fires — immediately when it has already fired (a pre-aborted signal
 * used to wait out the whole delay).
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError(signal))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal ? abortError(signal) : new DOMException('aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Client-side throttle: guarantees at least `intervalMs` between the moments
 * consecutive `wait()` calls resolve. Callers reserve their slot at call time,
 * so concurrent waiters are served FIFO, one interval apart. A waiter whose
 * signal aborts gives its slot back when no later waiter has reserved behind
 * it, so a cancelled request never delays the next one. `defer(ms)` pushes
 * the next free slot into the future — used for server-directed backoff like
 * RANDOM.ORG's `advisoryDelay`.
 */
export class MinIntervalGate {
  #nextAt = 0
  readonly #intervalMs: number

  constructor(intervalMs: number) {
    this.#intervalMs = intervalMs
  }

  async wait(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw abortError(signal)
    const now = Date.now()
    const previous = this.#nextAt
    const startAt = Math.max(now, previous)
    const reservedUntil = startAt + this.#intervalMs
    this.#nextAt = reservedUntil
    const delay = startAt - now
    if (delay <= 0) return
    try {
      await sleep(delay, signal)
    } catch (error) {
      // Release the unused slot unless someone queued (or deferred) behind it.
      if (this.#nextAt === reservedUntil) this.#nextAt = previous
      throw error
    }
  }

  defer(ms: number): void {
    this.#nextAt = Math.max(this.#nextAt, Date.now() + ms)
  }
}
