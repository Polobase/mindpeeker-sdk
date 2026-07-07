import { EntropyError } from '../errors.js'
import { base64ToBytes, concatBytes } from '../internal/bytes.js'
import { fetchJson } from '../internal/http.js'
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

export interface RandomOrgOptions {
  /** RANDOM.ORG API key (free Developer tier: 1000 req/day, 250k bits/day). */
  apiKey: string
  fetch?: typeof fetch
  baseUrl?: string
}

interface RpcResponse {
  result?: {
    random?: { data?: unknown }
    advisoryDelay?: number
  }
  error?: { code?: number; message?: string }
}

function rpcError(error: { code?: number; message?: string }): EntropyError {
  const code = error.code ?? 0
  const message = `RANDOM.ORG error ${code}: ${error.message ?? 'unknown'}`
  // Best-effort mapping of RANDOM.ORG's app-level codes: 400/401 are key
  // problems, 402/403 are exhausted daily allowances.
  if (code === 400 || code === 401)
    return new EntropyError('auth', message, { provider: INFO.name })
  if (code === 402 || code === 403) {
    return new EntropyError('rate_limited', message, { provider: INFO.name })
  }
  return new EntropyError('bad_response', message, { provider: INFO.name })
}

/**
 * RANDOM.ORG (atmospheric radio noise) via the JSON-RPC 4.0 Basic API's
 * `generateBlobs`. Honors the server's `advisoryDelay` between requests.
 */
export function randomOrg(opts: RandomOrgOptions): EntropyProvider {
  if (!opts?.apiKey) throw new TypeError('randomOrg({ apiKey }) requires a non-empty apiKey')
  const { apiKey, baseUrl = DEFAULT_BASE_URL, fetch: fetchImpl } = opts
  const gate = new MinIntervalGate(0)
  let nextId = 1

  return defineProvider({
    ...INFO,
    async getBytes(length, reqOpts) {
      const chunks: Uint8Array[] = []
      for (let remaining = length; remaining > 0; ) {
        const n = Math.min(MAX_BYTES_PER_REQUEST, remaining)
        await gate.wait(reqOpts?.signal)
        const res = await fetchJson<RpcResponse>(baseUrl, {
          provider: INFO.name,
          method: 'POST',
          body: {
            jsonrpc: '2.0',
            method: 'generateBlobs',
            params: { apiKey, n: 1, size: n * 8, format: 'base64' },
            id: nextId++,
          },
          signal: reqOpts?.signal,
          fetchImpl,
        })
        if (res?.error) throw rpcError(res.error)
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
