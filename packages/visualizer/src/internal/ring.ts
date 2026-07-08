import { VisualizerError } from '../errors.js'

/**
 * Fixed-capacity drop-oldest ring buffer. When full, `push` overwrites the
 * oldest element instead of blocking or growing — the mechanism that keeps
 * slow dashboard clients from ever exerting backpressure on a producer:
 * a channel retains at most `capacity` frames and simply forgets history.
 *
 * $O(1)$ push, $O(n)$ snapshot; indices wrap with a head pointer, so no
 * element is ever shifted.
 */
export class RingBuffer<T> {
  readonly capacity: number
  #items: (T | undefined)[]
  #head = 0
  #size = 0
  #dropped = 0

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new VisualizerError('server', `ring capacity must be an integer ≥ 1, got ${capacity}`)
    }
    this.capacity = capacity
    this.#items = new Array(capacity)
  }

  /** Elements currently retained. */
  get size(): number {
    return this.#size
  }

  /** Total elements evicted so far (monotonic; a health signal for slow UIs). */
  get dropped(): number {
    return this.#dropped
  }

  /** Append, evicting the oldest element when at capacity. */
  push(item: T): void {
    const tail = (this.#head + this.#size) % this.capacity
    this.#items[tail] = item
    if (this.#size === this.capacity) {
      this.#head = (this.#head + 1) % this.capacity
      this.#dropped++
    } else {
      this.#size++
    }
  }

  /** Snapshot in arrival order, oldest first. */
  snapshot(): T[] {
    const out: T[] = new Array(this.#size)
    for (let i = 0; i < this.#size; i++) {
      out[i] = this.#items[(this.#head + i) % this.capacity] as T
    }
    return out
  }
}
