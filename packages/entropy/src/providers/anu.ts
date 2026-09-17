import { EntropyError } from '../errors.js'
import { concatBytes } from '../internal/bytes.js'
import { fetchJson } from '../internal/http.js'
import { type BaseUrlOptions, resolveBaseUrls, withMirrors } from '../internal/mirrors.js'
import { requireNonEmptyString } from '../internal/options.js'
import { defineProvider } from '../internal/provider.js'
import { byteArrayFrom } from '../internal/validate.js'
import type { EntropyProvider, EntropySourceInfo } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({ name: 'anu', kind: 'qrng', privacy: 'private' })
const MAX_PER_REQUEST = 1024
const DEFAULT_BASE_URL = 'https://api.quantumnumbers.anu.edu.au'

export interface AnuOptions extends BaseUrlOptions {
  /** ANU Quantum Numbers API key (AWS Marketplace subscription). */
  apiKey: string
  fetch?: typeof fetch
}

interface AnuResponse {
  success?: boolean
  data?: unknown
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
 * ANU Quantum Numbers (quantum-vacuum fluctuations), keyed API.
 * https://quantumnumbers.anu.edu.au — up to 1024 numbers per request.
 * `baseUrl` points it at a server-side proxy that hides the key. Throws
 * `EntropyError('invalid_request')` at construction without a valid
 * `apiKey` (a non-empty printable-ASCII token).
 */
export function anu(opts: AnuOptions): EntropyProvider {
  const apiKey = requireCredential(opts?.apiKey, 'anu({ apiKey })')
  const bases = resolveBaseUrls(opts, [DEFAULT_BASE_URL], INFO.name)
  const { fetch: fetchImpl } = opts

  return defineProvider({
    ...INFO,
    async getBytes(length, reqOpts) {
      const chunks: Uint8Array[] = []
      for (let remaining = length; remaining > 0; ) {
        const n = Math.min(MAX_PER_REQUEST, remaining)
        const query = new URLSearchParams({ length: String(n), type: 'uint8' })
        const res = await withMirrors(bases, (base) =>
          fetchJson<AnuResponse>(`${base}?${query}`, {
            provider: INFO.name,
            headers: { 'x-api-key': apiKey },
            signal: reqOpts?.signal,
            fetchImpl,
            secrets: [apiKey],
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
