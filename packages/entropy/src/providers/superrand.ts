import { EntropyError } from '../errors.js'
import { concatBytes } from '../internal/bytes.js'
import { fetchJson } from '../internal/http.js'
import { defineProvider } from '../internal/provider.js'
import { sleep } from '../internal/rate-limit.js'
import { byteArrayFrom } from '../internal/validate.js'
import type { EntropyProvider, EntropySourceInfo, EntropyStreamOptions } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({
  name: 'superrand',
  kind: 'trng',
  privacy: 'private',
})
// Live-verified: the API rejects count > 256 with INVALID_COUNT_RANGE.
const MAX_PER_REQUEST = 256
const DEFAULT_BASE_URL = 'https://api.super-rand.io/v1/'
const DEFAULT_WS_URL = 'wss://api.super-rand.io/v1/'
const DEFAULT_STREAM_CHUNK = 32
const MAX_RECONNECTS = 3
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

export interface SuperRandOptions {
  /** SuperRand API key (goes into the query string per their API design). */
  apiKey: string
  fetch?: typeof fetch
  /** Injectable WebSocket constructor — also the Node 20 escape hatch. */
  WebSocketCtor?: WebSocketConstructor | typeof WebSocket
  baseUrl?: string
  wsUrl?: string
  /** Base delay for exponential reconnect backoff. Default 500. */
  reconnectBaseDelayMs?: number
}

// Wire format LIVE-VERIFIED 2026-07-07 against api.super-rand.io:
// - Request (REST body and WS frame, strict schema — extra fields rejected):
//     {request:'integer', min:0, max:255, count:n}   with n ≤ 256
// - REST response: {res: number | number[], jobType, length, ...}
//   (`res` is a bare number when count is 1/omitted)
// - WS response:   {status:'success', data:{res,...}, signature}
//                | {status:'error', error:{code,message}}
//   No tag/id field exists; responses arrive in request (FIFO) order.
function integerRequest(count: number): Record<string, unknown> {
  return { request: 'integer', min: 0, max: 255, count }
}

/** `res` is a bare number for single-value requests — normalize to an array. */
function normalizeRes(res: unknown): unknown {
  return typeof res === 'number' ? [res] : res
}

interface Pending {
  expected: number
  settle: (error: EntropyError | null, bytes?: Uint8Array) => void
}

interface Connection {
  dead: boolean
  request(n: number, signal?: AbortSignal, timeoutMs?: number): Promise<Uint8Array>
  close(): void
}

/**
 * SuperRand (Spence Technologies) — electromagnetic background-noise TRNG.
 * REST for `getBytes`; the only public entropy API with WebSocket delivery,
 * used for `stream()`. The stream keeps exactly one request in flight per
 * connection (the protocol has no correlation id — responses are FIFO).
 */
export function superRand(opts: SuperRandOptions): EntropyProvider {
  if (!opts?.apiKey) throw new TypeError('superRand({ apiKey }) requires a non-empty apiKey')
  const {
    apiKey,
    baseUrl = DEFAULT_BASE_URL,
    wsUrl = DEFAULT_WS_URL,
    reconnectBaseDelayMs = 500,
    fetch: fetchImpl,
  } = opts
  const WebSocketCtor = (opts.WebSocketCtor ??
    (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket) as
    | WebSocketConstructor
    | undefined

  function openConnection(): Promise<Connection> {
    return new Promise((resolve, reject) => {
      if (!WebSocketCtor) {
        reject(
          new TypeError(
            'superRand stream() needs a WebSocket implementation — pass WebSocketCtor (Node 20 has no global WebSocket)',
          ),
        )
        return
      }
      const socket = new WebSocketCtor(`${wsUrl}?key=${encodeURIComponent(apiKey)}`)
      let pending: Pending | null = null
      let opened = false
      let closedByUs = false

      const connection: Connection = {
        dead: false,
        request(n, signal, timeoutMs) {
          return new Promise<Uint8Array>((resolveReq, rejectReq) => {
            if (connection.dead) {
              rejectReq(
                new EntropyError('network', 'connection is closed', { provider: INFO.name }),
              )
              return
            }
            const timer = setTimeout(() => {
              settle(
                new EntropyError(
                  'timeout',
                  `no response within ${timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS}ms`,
                  { provider: INFO.name },
                ),
              )
            }, timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS)
            const onAbort = () =>
              settle(new EntropyError('aborted', 'request aborted', { provider: INFO.name }))
            const settle = (error: EntropyError | null, bytes?: Uint8Array) => {
              pending = null
              clearTimeout(timer)
              signal?.removeEventListener('abort', onAbort)
              if (error) rejectReq(error)
              else resolveReq(bytes as Uint8Array)
            }
            if (signal?.aborted) {
              settle(new EntropyError('aborted', 'request aborted', { provider: INFO.name }))
              return
            }
            signal?.addEventListener('abort', onAbort, { once: true })
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
        const error = new EntropyError('network', 'SuperRand WebSocket connection lost', {
          provider: INFO.name,
        })
        pending?.settle(error)
        pending = null
        if (!opened && !closedByUs) reject(error)
      }

      socket.onopen = () => {
        opened = true
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
          entry.settle(
            new EntropyError(
              'bad_response',
              `SuperRand error ${message.error?.code ?? 'unknown'}: ${message.error?.message ?? ''}`,
              { provider: INFO.name },
            ),
          )
          return
        }
        try {
          entry.settle(
            null,
            byteArrayFrom(normalizeRes(message.data?.res), entry.expected, INFO.name),
          )
        } catch (error) {
          entry.settle(
            error instanceof EntropyError
              ? error
              : new EntropyError('bad_response', 'malformed frame', {
                  provider: INFO.name,
                  cause: error,
                }),
          )
        }
      }
    })
  }

  async function* wsStream(opts: EntropyStreamOptions): AsyncGenerator<Uint8Array> {
    const chunkBytes = opts.chunkBytes ?? DEFAULT_STREAM_CHUNK
    let connection: Connection | null = null
    let failures = 0
    try {
      while (true) {
        if (opts.signal?.aborted) {
          throw new EntropyError('aborted', 'stream aborted', { provider: INFO.name })
        }
        if (!connection || connection.dead) {
          try {
            connection = await openConnection()
          } catch (error) {
            failures++
            if (failures > MAX_RECONNECTS) {
              throw error instanceof TypeError
                ? error
                : new EntropyError(
                    'network',
                    `SuperRand WebSocket failed after ${MAX_RECONNECTS} reconnect attempts`,
                    { provider: INFO.name, cause: error },
                  )
            }
            await sleep(reconnectBaseDelayMs * 2 ** (failures - 1), opts.signal)
            continue
          }
        }
        try {
          const bytes = await connection.request(chunkBytes, opts.signal, opts.timeoutMs)
          failures = 0
          yield bytes
        } catch (error) {
          if (
            error instanceof EntropyError &&
            (error.code === 'aborted' ||
              error.code === 'bad_response' ||
              error.code === 'invalid_request')
          ) {
            throw error
          }
          connection.close()
          connection = null
          failures++
          if (failures > MAX_RECONNECTS) {
            throw new EntropyError(
              'network',
              `SuperRand WebSocket failed after ${MAX_RECONNECTS} reconnect attempts`,
              { provider: INFO.name, cause: error },
            )
          }
          await sleep(reconnectBaseDelayMs * 2 ** (failures - 1), opts.signal)
        }
      }
    } finally {
      // TS narrows `connection` to never after the infinite loop; widen it.
      ;(connection as Connection | null)?.close()
    }
  }

  return defineProvider({
    ...INFO,
    defaultChunkBytes: DEFAULT_STREAM_CHUNK,

    async getBytes(length, reqOpts) {
      const chunks: Uint8Array[] = []
      for (let remaining = length; remaining > 0; ) {
        const n = Math.min(MAX_PER_REQUEST, remaining)
        const res = await fetchJson<{ res?: unknown }>(
          `${baseUrl}?key=${encodeURIComponent(apiKey)}`,
          {
            provider: INFO.name,
            method: 'POST',
            body: integerRequest(n),
            signal: reqOpts?.signal,
            fetchImpl,
          },
        )
        chunks.push(byteArrayFrom(normalizeRes(res?.res), n, INFO.name))
        remaining -= n
      }
      return { bytes: concatBytes(chunks), sources: [INFO] }
    },

    stream(opts = {}) {
      return wsStream(opts)
    },
  })
}
