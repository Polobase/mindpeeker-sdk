import type { WebSocketLike } from '../../src/providers/superrand.js'

type Script = (socket: MockWebSocket, sent: string) => void

/**
 * Scriptable stand-in for the browser WebSocket. Tests drive it explicitly:
 * `open()` fires onopen, `message(data)` fires onmessage, `fail()` simulates
 * an unclean drop. A `script` can auto-respond to sent frames.
 */
export class MockWebSocket implements WebSocketLike {
  static instances: MockWebSocket[] = []
  static script: Script | null = null
  /** When true, sockets fire onopen on the microtask after construction. */
  static autoOpen = false

  static reset(script: Script | null = null): void {
    MockWebSocket.instances = []
    MockWebSocket.script = script
    MockWebSocket.autoOpen = false
  }

  static latest(): MockWebSocket {
    const socket = MockWebSocket.instances.at(-1)
    if (!socket) throw new Error('no MockWebSocket instantiated yet')
    return socket
  }

  readonly url: string
  sent: string[] = []
  closed = false
  closeCode: number | undefined

  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event: { code: number; wasClean: boolean }) => void) | null = null

  constructor(url: string | URL) {
    this.url = String(url)
    MockWebSocket.instances.push(this)
    queueMicrotask(() => {
      if (MockWebSocket.autoOpen && !this.closed) this.onopen?.()
    })
  }

  send(data: string): void {
    this.sent.push(data)
    MockWebSocket.script?.(this, data)
  }

  close(code = 1000): void {
    if (this.closed) return
    this.closed = true
    this.closeCode = code
    this.onclose?.({ code, wasClean: true })
  }

  // --- test controls ---

  open(): void {
    this.onopen?.()
  }

  message(data: unknown): void {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) })
  }

  /** Simulate an unclean connection drop. */
  fail(): void {
    if (this.closed) return
    this.closed = true
    this.onerror?.()
    this.onclose?.({ code: 1006, wasClean: false })
  }
}

/** Script that opens sockets immediately and answers every request in order. */
export function echoScript(byte = 7): void {
  MockWebSocket.reset((socket, sent) => {
    const req = JSON.parse(sent) as { count: number }
    queueMicrotask(() =>
      socket.message({
        status: 'success',
        data: { res: new Array(req.count).fill(byte), jobType: 'integer', length: req.count },
      }),
    )
  })
  MockWebSocket.autoOpen = true
}
