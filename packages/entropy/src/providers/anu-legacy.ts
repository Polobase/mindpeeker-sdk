import { EntropyError } from '../errors.js'
import { concatBytes } from '../internal/bytes.js'
import { fetchJson } from '../internal/http.js'
import { type BaseUrlOptions, resolveBaseUrls, withMirrors } from '../internal/mirrors.js'
import { requireFinite } from '../internal/options.js'
import { defineProvider } from '../internal/provider.js'
import { MinIntervalGate } from '../internal/rate-limit.js'
import { byteArrayFrom } from '../internal/validate.js'
import type { EntropyProvider, EntropySourceInfo } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({
  name: 'anu-legacy',
  kind: 'qrng',
  privacy: 'private',
})
const MAX_PER_REQUEST = 1024
const DEFAULT_BASE_URL = 'https://qrng.anu.edu.au/API/jsonI.php'
const RATE_LIMIT_SNIPPET = 'limited to 1 requests per minute'

export interface AnuLegacyOptions extends BaseUrlOptions {
  fetch?: typeof fetch
  /**
   * Client-side spacing between requests: finite, 0 ≤ ms ≤ 2³¹ − 1. ANU's
   * server limit is 1/minute (signalled as HTTP 500); default stays just
   * above it.
   */
  minIntervalMs?: number
}

interface AnuLegacyResponse {
  success?: boolean
  data?: unknown
}

/**
 * ANU's legacy free QRNG API. Zero-config but limited to one request per
 * minute and officially slated for retirement — use it as a fallback link,
 * not a primary source. A request cancelled while queued gives its slot back.
 */
export function anuLegacy(opts: AnuLegacyOptions = {}): EntropyProvider {
  const { fetch: fetchImpl } = opts
  const bases = resolveBaseUrls(opts, [DEFAULT_BASE_URL], INFO.name)
  const minIntervalMs = requireFinite(
    opts.minIntervalMs ?? 61_000,
    'minIntervalMs',
    { min: 0, max: 2 ** 31 - 1 },
    INFO.name,
  )
  const gate = new MinIntervalGate(minIntervalMs)

  return defineProvider({
    ...INFO,
    // At 1 request/minute, make every poll pull a full request's worth.
    defaultChunkBytes: MAX_PER_REQUEST,
    async getBytes(length, reqOpts) {
      const chunks: Uint8Array[] = []
      for (let remaining = length; remaining > 0; ) {
        const n = Math.min(MAX_PER_REQUEST, remaining)
        await gate.wait(reqOpts?.signal)
        const query = new URLSearchParams({ length: String(n), type: 'uint8' })
        const res = await withMirrors(bases, (base) =>
          fetchJson<AnuLegacyResponse>(`${base}?${query}`, {
            provider: INFO.name,
            signal: reqOpts?.signal,
            fetchImpl,
            onErrorResponse: (status, body) =>
              status === 500 && body.includes(RATE_LIMIT_SNIPPET)
                ? new EntropyError('rate_limited', 'ANU legacy API allows 1 request per minute', {
                    provider: INFO.name,
                    retryAfterMs: 60_000,
                  })
                : undefined,
          }),
        )
        if (res?.success !== true) {
          throw new EntropyError('bad_response', 'ANU QRNG returned an unsuccessful response', {
            provider: INFO.name,
          })
        }
        chunks.push(byteArrayFrom(res.data, n, INFO.name))
        remaining -= n
      }
      return { bytes: concatBytes(chunks), sources: [INFO] }
    },
  })
}
