function abortError(signal: AbortSignal): Error {
  const reason = signal.reason
  if (reason instanceof Error) return reason
  return new DOMException('The operation was aborted.', 'AbortError')
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
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
 * so concurrent waiters are served FIFO, one interval apart. `defer(ms)`
 * pushes the next free slot into the future — used for server-directed
 * backoff like RANDOM.ORG's `advisoryDelay`.
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
    const startAt = Math.max(now, this.#nextAt)
    this.#nextAt = startAt + this.#intervalMs
    const delay = startAt - now
    if (delay > 0) await sleep(delay, signal)
  }

  defer(ms: number): void {
    this.#nextAt = Math.max(this.#nextAt, Date.now() + ms)
  }
}
