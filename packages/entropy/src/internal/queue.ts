import { EntropyError } from '../errors.js'
import { requireInteger } from './options.js'
import { sleep } from './rate-limit.js'

/** Default capacity of the browser producer queues (mic chunks, sensor readings). */
export const DEFAULT_QUEUE_LIMIT = 8

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}

/**
 * Bounded hand-off between an event-driven producer (ScriptProcessor
 * callbacks, sensor events) and a pull-based consumer. When the consumer
 * falls behind, the OLDEST item is dropped: raw noise samples lost this way
 * cost throughput only, never correctness, while an unbounded queue would
 * grow without limit in a long-lived page.
 */
export class DropOldestQueue<T> {
  readonly limit: number
  readonly #items: T[] = []
  #waiter: (() => void) | null = null
  #dropped = 0

  constructor(limit: number = DEFAULT_QUEUE_LIMIT, provider?: string) {
    this.limit = requireInteger(limit, 'queueLimit', 1, provider)
  }

  /** Items currently buffered. */
  get size(): number {
    return this.#items.length
  }

  /** Items discarded so far because the queue was full. */
  get dropped(): number {
    return this.#dropped
  }

  push(item: T): void {
    this.#items.push(item)
    if (this.#items.length > this.limit) {
      this.#items.shift()
      this.#dropped++
    }
    const waiter = this.#waiter
    this.#waiter = null
    waiter?.()
  }

  /** Resolve with the oldest buffered item, waiting for one if needed; rejects on abort. */
  async take(signal?: AbortSignal): Promise<T> {
    while (true) {
      if (signal?.aborted) throw abortReason(signal)
      if (this.#items.length > 0) return this.#items.shift() as T
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          this.#waiter = null
          reject(abortReason(signal as AbortSignal))
        }
        this.#waiter = () => {
          signal?.removeEventListener('abort', onAbort)
          resolve()
        }
        signal?.addEventListener('abort', onAbort, { once: true })
      })
    }
  }
}

/** Consecutive product-less iterations after which a sample loop yields a macrotask tick. */
export const STARVATION_YIELD_EVERY = 64

/**
 * Cooperative starvation guard for sample loops: an in-memory or replayed
 * source that keeps producing frames/chunks without extractable bits never
 * leaves the microtask queue, so timers (timeouts) and abort listeners could
 * never run. Call `tick(produced)` once per iteration; after
 * `STARVATION_YIELD_EVERY` product-less iterations it awaits a macrotask.
 */
export function starvationGuard(signal?: AbortSignal): (produced: boolean) => Promise<void> {
  let idle = 0
  return async (produced) => {
    if (produced) {
      idle = 0
      return
    }
    idle++
    if (idle < STARVATION_YIELD_EVERY) return
    idle = 0
    await sleep(0)
    if (signal?.aborted) throw abortReason(signal)
  }
}

/** Map a `getUserMedia`/permission rejection to `EntropyError('permission')` when it is one. */
export function permissionError(error: unknown, provider: string, what: string): unknown {
  const name = (error as { name?: unknown } | null)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return new EntropyError('permission', `${what} permission denied`, { provider, cause: error })
  }
  return error
}
