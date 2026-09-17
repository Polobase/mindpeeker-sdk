import { VdfError } from '../errors.js'
import type { ProgressFn } from '../types.js'

/** Work units (squarings or modular multiplications) between progress reports. */
export const PROGRESS_INTERVAL = 1024

/** Work units between cooperative yields to the macrotask queue. */
export const YIELD_INTERVAL = 16 * PROGRESS_INTERVAL

interface YieldGlobals {
  scheduler?: { yield?: () => Promise<void> }
  setImmediate?: (callback: () => void) => unknown
}

/**
 * Yield to the macrotask queue so timers and event handlers — the places
 * `AbortController.abort()` is typically called from — get to run.
 *
 * Preference order, each avoiding the ≥ 4 ms nested-timer clamp browsers apply
 * to `setTimeout` (HTML Living Standard, timer initialisation steps):
 * `scheduler.yield()` (Prioritized Task Scheduling API, where available);
 * `setImmediate` (Node, Bun); a `MessageChannel` round trip (browsers, where a
 * posted message is an ordinary task); finally `setTimeout(0)`. `setImmediate`
 * deliberately precedes `MessageChannel`: under Bun 1.3 a chain of
 * `MessageChannel` yields starves timers entirely (a 5 ms timer never fired in
 * 2 s of yielding), which would make timer-driven aborts unobservable.
 */
export function yieldToEventLoop(): Promise<void> {
  const globals = globalThis as YieldGlobals
  const { scheduler, setImmediate } = globals
  if (typeof scheduler?.yield === 'function') return scheduler.yield()
  if (typeof setImmediate === 'function') {
    return new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
  }
  if (typeof MessageChannel === 'function') {
    return new Promise<void>((resolve) => {
      const channel = new MessageChannel()
      channel.port1.onmessage = () => {
        channel.port1.close()
        channel.port2.close()
        resolve()
      }
      channel.port2.postMessage(null)
    })
  }
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

/**
 * Accounting for one long computation: counts finished work units, checks the
 * abort signal, reports progress roughly every {@link PROGRESS_INTERVAL} units
 * and exactly once with `done === total`, and yields every
 * {@link YIELD_INTERVAL} units.
 */
export class Work {
  readonly #total: number
  readonly #signal: AbortSignal | undefined
  readonly #onProgress: ProgressFn | undefined
  #done = 0
  #reported = -1
  #sinceYield = 0

  constructor(total: number, signal?: AbortSignal, onProgress?: ProgressFn) {
    this.#total = total
    this.#signal = signal
    this.#onProgress = onProgress
  }

  /** Units finished so far. */
  get done(): number {
    return this.#done
  }

  /** Throw `VdfError('aborted')` if the signal has fired. */
  throwIfAborted(): void {
    if (this.#signal?.aborted) {
      throw new VdfError('aborted', `aborted after ${this.#done} of ${this.#total} work units`, {
        cause: this.#signal.reason,
      })
    }
  }

  /** Record `units` of finished work; abort check, progress, and yield as due. */
  async advance(units: number): Promise<void> {
    this.#done += units
    this.#sinceYield += units
    this.throwIfAborted()
    const onProgress = this.#onProgress
    if (
      onProgress !== undefined &&
      (this.#done - Math.max(this.#reported, 0) >= PROGRESS_INTERVAL || this.#done >= this.#total)
    ) {
      this.#reported = this.#done
      onProgress(this.#done, this.#total)
    }
    if (this.#sinceYield >= YIELD_INTERVAL && this.#done < this.#total) {
      this.#sinceYield = 0
      await yieldToEventLoop()
      this.throwIfAborted()
    }
  }

  /** Emit the completion event `(total, total)` unless it was already reported. */
  finish(): void {
    if (this.#onProgress !== undefined && this.#reported !== this.#total) {
      this.#reported = this.#total
      this.#onProgress(this.#total, this.#total)
    }
  }
}
