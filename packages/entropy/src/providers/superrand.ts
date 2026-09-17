import { EntropyError } from '../errors.js'
import { concatBytes } from '../internal/bytes.js'
import { guardStream } from '../internal/guard-stream.js'
import { fetchJson } from '../internal/http.js'
import { type BaseUrlOptions, resolveBaseUrls, withMirrors } from '../internal/mirrors.js'
import { requireFinite, requireNonEmptyString, requireTimeoutMs } from '../internal/options.js'
import { defineProvider } from '../internal/provider.js'
import { sleep } from '../internal/rate-limit.js'
import { byteArrayFrom } from '../internal/validate.js'
import type { EntropyProvider, EntropySourceInfo } from '../types.js'
import {
  type Connection,
  integerRequest,
  normalizeRes,
  openConnection,
  superRandError,
  type WebSocketConstructor,
} from './superrand-ws.js'

export type { WebSocketConstructor, WebSocketLike } from './superrand-ws.js'

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
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000

export interface SuperRandOptions extends BaseUrlOptions {
  /**
   * SuperRand API key (goes into the query string per their API design;
   * error messages mask it).
   */
  apiKey: string
  fetch?: typeof fetch
  /**
   * Injectable WebSocket constructor — needed where there is no global
   * `WebSocket` (Node < 22).
   */
  WebSocketCtor?: WebSocketConstructor | typeof WebSocket
  wsUrl?: string
  /** Base delay for exponential reconnect backoff: finite, 0 ≤ ms ≤ 2³¹ − 1. Default 500. */
  reconnectBaseDelayMs?: number
  /** Budget for opening the WebSocket: finite, 0 < ms ≤ 2³¹ − 1. Default 10 000. */
  connectTimeoutMs?: number
}

interface SuperRandErrorBody {
  status?: unknown
  error?: { code?: unknown; message?: unknown }
}

/** Only transport-level failures are worth a reconnect; everything else ends the stream. */
function retryable(error: unknown): boolean {
  return error instanceof EntropyError && (error.code === 'network' || error.code === 'timeout')
}

/**
 * SuperRand (Spence Technologies) — electromagnetic background-noise TRNG.
 * REST for `getBytes`; the only public entropy API with WebSocket delivery,
 * used for `stream()`. The stream keeps exactly one request in flight per
 * connection (the protocol has no correlation id — responses are FIFO),
 * reconnects up to 3 times with exponential backoff after transport failures
 * only, honours the caller's signal while connecting and backing off, and maps
 * SuperRand error codes to `rate_limited` / `auth` / `bad_response` on both
 * transports. Throws `EntropyError('invalid_request')` at construction without
 * an `apiKey`, and on the first pull when no WebSocket implementation exists.
 */
export function superRand(opts: SuperRandOptions): EntropyProvider {
  const apiKey = requireNonEmptyString(opts?.apiKey, 'superRand({ apiKey })', INFO.name)
  const bases = resolveBaseUrls(opts, [DEFAULT_BASE_URL], INFO.name)
  const wsUrl = requireNonEmptyString(opts.wsUrl ?? DEFAULT_WS_URL, 'wsUrl', INFO.name)
  const reconnectBaseDelayMs = requireFinite(
    opts.reconnectBaseDelayMs ?? 500,
    'reconnectBaseDelayMs',
    { min: 0, max: 2 ** 31 - 1 },
    INFO.name,
  )
  const connectTimeoutMs = requireTimeoutMs(
    opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    'connectTimeoutMs',
    INFO.name,
  )
  const { fetch: fetchImpl } = opts
  const WebSocketCtor = (opts.WebSocketCtor ??
    (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket) as
    | WebSocketConstructor
    | undefined

  async function* wsStream(
    chunkBytes: number,
    timeoutMs: number | undefined,
    signal: AbortSignal,
  ): AsyncGenerator<Uint8Array> {
    if (!WebSocketCtor) {
      throw new EntropyError(
        'invalid_request',
        'superRand stream() needs a WebSocket implementation — pass WebSocketCtor (Node < 22 has no global WebSocket)',
        { provider: INFO.name },
      )
    }
    const url = `${wsUrl}?key=${encodeURIComponent(apiKey)}`
    let connection: Connection | null = null
    let failures = 0
    const giveUp = (cause: unknown) =>
      new EntropyError(
        'network',
        `SuperRand WebSocket failed after ${MAX_RECONNECTS} reconnect attempts`,
        { provider: INFO.name, cause },
      )
    try {
      while (true) {
        if (signal.aborted) {
          throw new EntropyError('aborted', 'stream aborted', { provider: INFO.name })
        }
        if (!connection || connection.dead) {
          try {
            connection = await openConnection(WebSocketCtor, url, signal, connectTimeoutMs)
          } catch (error) {
            if (!retryable(error)) throw error
            failures++
            if (failures > MAX_RECONNECTS) throw giveUp(error)
            await sleep(reconnectBaseDelayMs * 2 ** (failures - 1), signal)
            continue
          }
        }
        try {
          const bytes = await connection.request(chunkBytes, signal, timeoutMs)
          failures = 0
          yield bytes
        } catch (error) {
          if (!retryable(error)) throw error
          connection.close()
          connection = null
          failures++
          if (failures > MAX_RECONNECTS) throw giveUp(error)
          await sleep(reconnectBaseDelayMs * 2 ** (failures - 1), signal)
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
        const res = await withMirrors(bases, (base) =>
          fetchJson<{ res?: unknown } & SuperRandErrorBody>(
            `${base}?key=${encodeURIComponent(apiKey)}`,
            {
              provider: INFO.name,
              method: 'POST',
              body: integerRequest(n),
              signal: reqOpts?.signal,
              fetchImpl,
              secrets: [apiKey],
              onErrorResponse: (_status, body) => {
                try {
                  const parsed = JSON.parse(body) as SuperRandErrorBody
                  return typeof parsed?.error?.code === 'string'
                    ? superRandError(parsed.error)
                    : undefined
                } catch {
                  return undefined
                }
              },
            },
          ),
        )
        if (res?.status === 'error') throw superRandError(res.error)
        chunks.push(byteArrayFrom(normalizeRes(res?.res), n, INFO.name))
        remaining -= n
      }
      return { bytes: concatBytes(chunks), sources: [INFO] }
    },

    stream(streamOpts = {}) {
      const chunkBytes = streamOpts.chunkBytes ?? DEFAULT_STREAM_CHUNK
      return {
        [Symbol.asyncIterator]: () =>
          guardStream((signal) => wsStream(chunkBytes, streamOpts.timeoutMs, signal), {
            provider: INFO.name,
            signal: streamOpts.signal,
          }),
      }
    },
  })
}
