import { EntropyError } from '../errors.js'
import { base64ToBytes, concatBytes } from '../internal/bytes.js'
import { fetchJson, redactText } from '../internal/http.js'
import { type BaseUrlOptions, resolveBaseUrls, withMirrors } from '../internal/mirrors.js'
import { requireNonEmptyString } from '../internal/options.js'
import { defineProvider } from '../internal/provider.js'
import { MinIntervalGate } from '../internal/rate-limit.js'
import type { EntropyProvider, EntropySourceInfo } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({
  name: 'random.org',
  kind: 'trng',
  privacy: 'private',
})
// generateBlobs caps a request at 2^20 bits total.
const MAX_BYTES_PER_REQUEST = 131_072
const DEFAULT_BASE_URL = 'https://api.random.org/json-rpc/4/invoke'

export interface RandomOrgOptions extends BaseUrlOptions {
  /**
   * RANDOM.ORG API key. The free Developer tier allows at most 1,000 requests
   * per day and 10 requests/s (pricing page, 2026-09); no bits/day figure is
   * published — the server's `bitsLeft` is authoritative.
   */
  apiKey: string
  fetch?: typeof fetch
}

interface RpcResponse {
  result?: {
    random?: { data?: unknown }
    advisoryDelay?: number
  }
  error?: { code?: number; message?: string }
}

/** Milliseconds from `now` to the next 00:00 UTC. */
export function msUntilUtcMidnight(now: number = Date.now()): number {
  const day = 86_400_000
  return day - (((now % day) + day) % day)
}

function rpcError(error: { code?: number; message?: string }, apiKey: string): EntropyError {
  const code = error.code ?? 0
  const text = redactText(String(error.message ?? 'unknown'), [apiKey])
  const message = `RANDOM.ORG error ${code}: ${text}`
  // RANDOM.ORG's app-level codes (json-rpc/4/error-codes): 400/401 are key
  // problems, 402/403 mean the key has too few requests/bits left today.
  if (code === 400 || code === 401)
    return new EntropyError('auth', message, { provider: INFO.name })
  if (code === 402 || code === 403) {
    // The reset time is not documented; the next UTC midnight is an estimate.
    return new EntropyError('rate_limited', message, {
      provider: INFO.name,
      retryAfterMs: msUntilUtcMidnight(),
    })
  }
  return new EntropyError('bad_response', message, { provider: INFO.name })
}

/**
 * The credential must be a printable-ASCII token (U+0021–U+007E): whitespace
 * (e.g. a trailing newline read from a file), control and non-ASCII
 * characters are rejected at construction instead of failing later as a
 * network, auth or bad_response error. The value never enters the message.
 */
function requireCredential(value: unknown, name: string): string {
  const credential = requireNonEmptyString(value, name, INFO.name)
  if (!/^[!-~]+$/.test(credential)) {
    throw new EntropyError(
      'invalid_request',
      `${name} must be printable ASCII without whitespace or control characters`,
      { provider: INFO.name },
    )
  }
  return credential
}

/**
 * RANDOM.ORG (atmospheric radio noise) via the JSON-RPC 4.0 Basic API's
 * `generateBlobs`. Honors the server's `advisoryDelay` between requests. An
 * exhausted daily allowance (RPC error 402/403) throws `rate_limited` with
 * `retryAfterMs` estimated as the time to the next 00:00 UTC. Throws
 * `EntropyError('invalid_request')` at construction without a valid
 * `apiKey` (a non-empty printable-ASCII token).
 */
export function randomOrg(opts: RandomOrgOptions): EntropyProvider {
  const apiKey = requireCredential(opts?.apiKey, 'randomOrg({ apiKey })')
  const bases = resolveBaseUrls(opts, [DEFAULT_BASE_URL], INFO.name)
  const { fetch: fetchImpl } = opts
  const gate = new MinIntervalGate(0)
  let nextId = 1

  return defineProvider({
    ...INFO,
    async getBytes(length, reqOpts) {
      const chunks: Uint8Array[] = []
      for (let remaining = length; remaining > 0; ) {
        const n = Math.min(MAX_BYTES_PER_REQUEST, remaining)
        await gate.wait(reqOpts?.signal)
        const id = nextId++
        const res = await withMirrors(bases, (base) =>
          fetchJson<RpcResponse>(base, {
            provider: INFO.name,
            method: 'POST',
            body: {
              jsonrpc: '2.0',
              method: 'generateBlobs',
              params: { apiKey, n: 1, size: n * 8, format: 'base64' },
              id,
            },
            signal: reqOpts?.signal,
            fetchImpl,
            secrets: [apiKey],
          }),
        )
        if (res?.error) throw rpcError(res.error, apiKey)
        const advisoryDelay = res?.result?.advisoryDelay
        if (typeof advisoryDelay === 'number' && advisoryDelay > 0) gate.defer(advisoryDelay)
        const data = res?.result?.random?.data
        const blob = Array.isArray(data) ? data[0] : undefined
        if (typeof blob !== 'string') {
          throw new EntropyError('bad_response', 'missing blob in generateBlobs result', {
            provider: INFO.name,
          })
        }
        let bytes: Uint8Array
        try {
          bytes = base64ToBytes(blob)
        } catch (error) {
          throw new EntropyError('bad_response', 'invalid base64 blob', {
            provider: INFO.name,
            cause: error,
          })
        }
        if (bytes.length !== n) {
          throw new EntropyError('bad_response', `expected ${n} bytes, got ${bytes.length}`, {
            provider: INFO.name,
          })
        }
        chunks.push(bytes)
        remaining -= n
      }
      return { bytes: concatBytes(chunks), sources: [INFO] }
    },
  })
}
