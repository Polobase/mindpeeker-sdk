/** Deterministic xorshift32 byte stream (the SDK-wide seeded-test idiom). */
export function prngBytes(n: number, seed = 0xabcdef01): Uint8Array {
  let state = seed
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    out[i] = state & 0xff
  }
  return out
}

/** Finite async source yielding the given items in order. */
export async function* fromItems<T>(...items: readonly T[]): AsyncGenerator<T> {
  for (const item of items) yield item
}

/** An async source that yields `items` then blocks until `release` resolves. */
export function gatedSource<T>(items: readonly T[]): {
  src: AsyncGenerator<T>
  release: () => void
} {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  async function* src(): AsyncGenerator<T> {
    for (const item of items) yield item
    await gate
  }
  return { src: src(), release }
}

/**
 * Ordered inbox over a WebSocket: buffers every message so tests can await
 * them one at a time without racing the `message` events.
 */
export class WsInbox {
  readonly #messages: (string | Uint8Array)[] = []
  readonly #waiters: ((msg: string | Uint8Array) => void)[] = []
  #closed = false
  closeCode: number | undefined

  constructor(ws: WebSocket) {
    ws.addEventListener('message', (event) => {
      const data =
        typeof event.data === 'string' ? event.data : new Uint8Array(event.data as ArrayBuffer)
      const waiter = this.#waiters.shift()
      if (waiter) waiter(data)
      else this.#messages.push(data)
    })
    ws.addEventListener('close', (event) => {
      this.#closed = true
      this.closeCode = (event as CloseEvent).code
    })
  }

  get closed(): boolean {
    return this.#closed
  }

  /** Next message in arrival order; rejects after `timeoutMs`. */
  next(timeoutMs = 2000): Promise<string | Uint8Array> {
    const queued = this.#messages.shift()
    if (queued !== undefined) return Promise.resolve(queued)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for message')), timeoutMs)
      this.#waiters.push((msg) => {
        clearTimeout(timer)
        resolve(msg)
      })
    })
  }
}

/** Open a WebSocket and resolve once connected (rejects on error/timeout). */
export function openSocket(url: string, timeoutMs = 2000): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    const timer = setTimeout(() => reject(new Error('websocket open timed out')), timeoutMs)
    ws.addEventListener('open', () => {
      clearTimeout(timer)
      resolve(ws)
    })
    ws.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('websocket failed to open'))
    })
  })
}

/** Wait until `predicate` holds, polling; rejects after `timeoutMs`. */
export async function until(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not met in time')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
