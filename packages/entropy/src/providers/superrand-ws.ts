import { EntropyError, type EntropyErrorCode } from '../errors.js'
import { byteArrayFrom } from '../internal/validate.js'

export const SUPERRAND_PROVIDER = 'superrand'
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000

/** The subset of the WebSocket surface this provider uses (injectable in tests). */
export interface WebSocketLike {
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: (() => void) | null
  onmessage: ((event: { data: string }) => void) | null
  onerror: (() => void) | null
  onclose: ((event: { code: number; wasClean: boolean }) => void) | null
}

export type WebSocketConstructor = new (url: string | URL) => WebSocketLike

// Wire format LIVE-VERIFIED 2026-07-07 against api.super-rand.io:
// - Request (REST body and WS frame, strict schema — extra fields rejected):
//     {request:'integer', min:0, max:255, count:n}   with n ≤ 256
// - REST response: {res: number | number[], jobType, length, ...}
//   (`res` is a bare number when count is 1/omitted)
// - WS response:   {status:'success', data:{res,...}, signature}
//                | {status:'error', error:{code,message}}
//   No tag/id field exists; responses arrive in request (FIFO) order.
export function integerRequest(count: number): Record<string, unknown> {
  return { request: 'integer', min: 0, max: 255, count }
}

/** `res` is a bare number for single-value requests — normalize to an array. */
export function normalizeRes(res: unknown): unknown {
  return typeof res === 'number' ? [res] : res
}

/**
 * Map a SuperRand error code to the library taxonomy. Only INVALID_SCHEMA and
 * INVALID_COUNT_RANGE are live-verified; quota and key codes are matched by
 * name (`QUOTA`, `RATE_LIMIT`, `ALLOWANCE`, `CREDIT`, `TOO_MANY` →
 * `rate_limited`; `API_KEY`, `AUTH`, `TOKEN`, `FORBIDDEN`, `UNAUTHORI…` →
 * `auth`); everything else is `bad_response`.
 */
export function superRandErrorCode(code: unknown): EntropyErrorCode {
  const name = typeof code === 'string' ? code.toUpperCase() : ''
  if (/QUOTA|RATE_?LIMIT|ALLOWANCE|CREDIT|TOO_MANY/.test(name)) return 'rate_limited'
  if (/API_?KEY|AUTH|TOKEN|FORBIDDEN|UNAUTHORI/.test(name)) return 'auth'
  return 'bad_response'
}

/** An `EntropyError` for a SuperRand `{ error: { code, message } }` payload. */
export function superRandError(
  error: { code?: unknown; message?: unknown } | undefined,
): EntropyError {
  const code = error?.code
  return new EntropyError(
    superRandErrorCode(code),
    `SuperRand error ${typeof code === 'string' ? code : 'unknown'}: ${typeof error?.message === 'string' ? error.message : ''}`,
    { provider: SUPERRAND_PROVIDER },
  )
}

interface Pending {
  expected: number
  settle: (error: EntropyError | null, bytes?: Uint8Array) => void
}

export interface Connection {
  dead: boolean
  request(n: number, signal?: AbortSignal, timeoutMs?: number): Promise<Uint8Array>
  close(): void
}

function entropyError(code: EntropyErrorCode, message: string, cause?: unknown): EntropyError {
  return new EntropyError(code, message, { provider: SUPERRAND_PROVIDER, cause })
}

/**
 * Open one SuperRand WebSocket connection. Rejects with `aborted` (closing the
 * socket) when `signal` fires while connecting, with `timeout` after
 * `connectTimeoutMs`, with `invalid_request` when the constructor rejects the
 * URL, and with `network` when the socket errors or closes before opening.
 */
export function openConnection(
  WebSocketCtor: WebSocketConstructor,
  url: string,
  signal: AbortSignal,
  connectTimeoutMs: number,
): Promise<Connection> {
  const connect = (
    resolve: (connection: Connection) => void,
    reject: (error: EntropyError) => void,
  ): void => {
    if (signal.aborted) {
      reject(entropyError('aborted', 'stream aborted', signal.reason))
      return
    }
    let socket: WebSocketLike
    try {
      socket = new WebSocketCtor(url)
    } catch (error) {
      reject(entropyError('invalid_request', 'SuperRand WebSocket URL was rejected', error))
      return
    }
    let pending: Pending | null = null
    let opened = false
    let closedByUs = false
    let connectTimer: ReturnType<typeof setTimeout> | undefined

    const stopConnecting = () => {
      if (connectTimer !== undefined) clearTimeout(connectTimer)
      connectTimer = undefined
      signal.removeEventListener('abort', onConnectAbort)
    }
    const abandon = (error: EntropyError) => {
      stopConnecting()
      connection.dead = true
      closedByUs = true
      socket.close()
      reject(error)
    }
    const onConnectAbort = () => abandon(entropyError('aborted', 'stream aborted', signal.reason))

    const connection: Connection = {
      dead: false,
      request(n, requestSignal, timeoutMs) {
        return new Promise<Uint8Array>((resolveReq, rejectReq) => {
          if (connection.dead) {
            rejectReq(entropyError('network', 'connection is closed'))
            return
          }
          const budget = timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
          const timer = setTimeout(() => {
            settle(entropyError('timeout', `no response within ${budget}ms`))
          }, budget)
          const onAbort = () => settle(entropyError('aborted', 'request aborted'))
          const settle = (error: EntropyError | null, bytes?: Uint8Array) => {
            pending = null
            clearTimeout(timer)
            requestSignal?.removeEventListener('abort', onAbort)
            if (error) rejectReq(error)
            else resolveReq(bytes as Uint8Array)
          }
          if (requestSignal?.aborted) {
            settle(entropyError('aborted', 'request aborted'))
            return
          }
          requestSignal?.addEventListener('abort', onAbort, { once: true })
          pending = { expected: n, settle }
          socket.send(JSON.stringify(integerRequest(n)))
        })
      },
      close() {
        closedByUs = true
        connection.dead = true
        socket.close()
      },
    }

    const fail = () => {
      if (connection.dead && !pending) return
      connection.dead = true
      const error = entropyError('network', 'SuperRand WebSocket connection lost')
      pending?.settle(error)
      pending = null
      if (!opened && !closedByUs) {
        stopConnecting()
        reject(error)
      }
    }

    signal.addEventListener('abort', onConnectAbort, { once: true })
    connectTimer = setTimeout(
      () => abandon(entropyError('timeout', `WebSocket connect exceeded ${connectTimeoutMs}ms`)),
      connectTimeoutMs,
    )
    socket.onopen = () => {
      if (closedByUs) return
      opened = true
      stopConnecting()
      resolve(connection)
    }
    socket.onerror = fail
    socket.onclose = fail
    socket.onmessage = (event) => {
      let message: {
        status?: unknown
        data?: { res?: unknown }
        error?: { code?: unknown; message?: unknown }
      }
      try {
        message = JSON.parse(String(event.data)) as typeof message
      } catch {
        return // ignore unparseable frames
      }
      const entry = pending
      if (!entry) return // nothing in flight — late or unsolicited frame
      if (message.status === 'error') {
        entry.settle(superRandError(message.error))
        return
      }
      try {
        entry.settle(
          null,
          byteArrayFrom(normalizeRes(message.data?.res), entry.expected, SUPERRAND_PROVIDER),
        )
      } catch (error) {
        entry.settle(
          error instanceof EntropyError
            ? error
            : entropyError('bad_response', 'malformed frame', error),
        )
      }
    }
  }
  return new Promise<Connection>(connect)
}
