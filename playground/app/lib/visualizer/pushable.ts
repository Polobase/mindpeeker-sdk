/**
 * A bounded, drop-oldest push queue that reads as an `AsyncIterable`.
 *
 * The visualizer's Bun server puts every producer emission into a per-channel
 * drop-oldest ring buffer so a slow consumer never exerts backpressure on a
 * producer (README, *Design invariants*). The in-browser driver has the same
 * problem in the other direction: one byte pump feeds several async consumers
 * (`windowedNegentropy`, `recordSession`), and a consumer that falls behind
 * must never grow an unbounded queue. So this queue keeps the newest
 * `capacity` items and counts what it dropped, which the UI reports.
 *
 * CLIENT-ONLY by convention: it has no SDK import of its own, but it exists
 * only to serve modules that do.
 */

export interface Pushable<T> extends AsyncIterable<T> {
  /** Offer one item; the oldest is dropped when the queue is full. */
  push(value: T): void
  /** End the iterable after the queued items are consumed. */
  close(): void
  /** Items dropped because a consumer fell behind. */
  readonly dropped: number
  /** Items waiting to be consumed. */
  readonly size: number
}

/**
 * Create a drop-oldest queue of at most `capacity` items.
 *
 * ```ts
 * const bytes = pushable<Uint8Array>(32)
 * void consume(windowedNegentropy(bytes, { windowSize: 512, hopSize: 128 }))
 * bytes.push(chunk)
 * ```
 */
export function pushable<T>(capacity = 64): Pushable<T> {
  const items: T[] = []
  let dropped = 0
  let closed = false
  let wake: (() => void) | undefined

  const notify = (): void => {
    const resume = wake
    wake = undefined
    resume?.()
  }

  return {
    push(value: T): void {
      if (closed) return
      items.push(value)
      while (items.length > capacity) {
        items.shift()
        dropped++
      }
      notify()
    },
    close(): void {
      closed = true
      notify()
    },
    get dropped(): number {
      return dropped
    },
    get size(): number {
      return items.length
    },
    async *[Symbol.asyncIterator](): AsyncGenerator<T> {
      for (;;) {
        while (items.length > 0) yield items.shift() as T
        if (closed) return
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    },
  }
}
